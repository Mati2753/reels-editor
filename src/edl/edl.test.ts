import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Probe, TimedWord } from "../pipeline/schemas";
import { overlays as overlayRegistry, type OverlayRegistry } from "../remotion/overlays";
import { boldStyle } from "../remotion/captions/styles";
import { breakPages, isClitic, type CaptionWord } from "./captions";
import { cropRect, ease, framingAt, placeSource } from "./framing";
import type { TextMeasurer } from "./measure";
import { FPS, resolveEdl, segmentTimings, toFrame, TRUNCATION_TOLERANCE, type Facts } from "./resolve";
import type { ResolvedSegment } from "./resolved";
import { EdlSchema, type Edl, type Overlay, type Segment } from "./schema";
import { fitText } from "./textfit";
import { defineOverlay, type LayoutContext } from "../remotion/overlays/types";
import { validateEdl } from "./validate";

// ---------------------------------------------------------------- fixtures

/** Monospaced stand-in for the font: 0.6 em per character. */
const measure: TextMeasurer = (text, _font, size) => [...text].length * 0.6 * size;

function clipProbe(id: string, duration: number, width = 1080, height = 1920): Probe["clips"][number] {
  return {
    id,
    file: `${id}.mp4`,
    sha256: "x",
    raw: { codec: "h264", width, height, rotation: 0, fps: 30, nominalFps: 30, variableFrameRate: false, frameInterval: { min: 0.033, max: 0.034 }, duration, audio: null },
    normalized: { video: `${id}/source.mp4`, audio: `${id}/audio.wav`, width, height, fps: 30, frames: Math.round(duration * 30), duration, audioSampleRate: 48000 },
  };
}

/** Words of clip c1, spaced like speech: [text, start, end]. */
const C1: [string, number, number][] = [
  ["Bonjour", 1.0, 1.4],
  ["à", 1.45, 1.55],
  ["tous.", 1.6, 1.95],
  ["Euh,", 3.0, 3.2],
  ["la", 3.6, 3.7],
  ["première", 3.7, 4.1],
  ["astuce,", 4.1, 4.6],
  ["c'est", 4.7, 4.9],
  ["la", 4.9, 5.0],
  ["lumière.", 5.0, 5.6],
  ["Mettez-vous", 7.0, 7.5],
  ["face", 7.5, 7.8],
  ["à", 7.8, 7.9],
  ["une", 7.9, 8.0],
  ["fenêtre.", 8.0, 8.6],
];

function words(clip: string, spec: [string, number, number][]): TimedWord[] {
  return spec.map(([text, start, end], i) => ({ id: `${clip}-w${i + 1}`, clip, text, start, end }));
}

const facts: Facts = {
  probe: { version: 1, clips: [clipProbe("c1", 12), clipProbe("c2", 10, 1920, 1080)] },
  analysis: { words: [...words("c1", C1), ...words("c2", [["Et", 1.0, 1.2], ["voilà.", 1.2, 1.7]])] },
};

const frame = (scale = 1) => ({ scale, origin: { x: 0.5, y: 0.4 } });

function clip(id: string, c: string, inS: number, outS: number, extra: Partial<Extract<Segment, { type: "clip" }>> = {}): Segment {
  return { id, type: "clip", clip: c, in: inS, out: outS, framing: frame(), ...extra };
}

function edl(over: Partial<Edl> = {}): Edl {
  return {
    version: 1,
    meta: { title: "Test", fps: 30, width: 1080, height: 1920, brand: "default", language: "fr" },
    segments: [clip("s1", "c1", 0.94, 1.99), clip("s2", "c1", 3.55, 5.68, { framing: frame(1.15) }), clip("s3", "c1", 6.94, 10.5)],
    transitions: [],
    overlays: [],
    captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "lower-third", emphasis: [], overrides: [], hide: [] },
    audio: { voice: { targetLufs: -14, denoise: false }, sfx: [] },
    ...over,
  };
}

const env = { measure };
const rules = (r: { issues: { rule: string; severity: string }[] }, severity = "error") => r.issues.filter((i) => i.severity === severity).map((i) => i.rule);

// A registry with one overlay whose layout is the whole zone, to exercise the overlay rules
// independently of the real components (they are tested below with the real fonts).
const registry: OverlayRegistry = {
  Tag: defineOverlay<{ text: string }, null>({
    description: "test",
    props: z.object({ text: z.string() }),
    zones: ["top", "center", "bottom", "full"],
    enter: { kind: "pop", duration: 0.3, direction: "up" },
    exit: { kind: "fade", duration: 0.15, direction: "up" },
    text: (p) => p.text,
    cueCount: () => 2,
    layout: (p, ctx) => {
      const fit = fitText(p.text, { font: ctx.brand.fonts.display, maxWidth: ctx.area.width, maxLines: 1, maxSize: 80, minSize: 60, lineHeight: 1.2, language: "fr" }, ctx.measure);
      return { layout: null, box: ctx.area, texts: [{ field: "text", fit, preferred: 80 }] };
    },
    render: () => null,
  }),
};
const tag = (id: string, at: Overlay["at"], extra: Partial<Overlay> = {}): Overlay => ({ id, component: "Tag", props: { text: "abc" }, at, duration: 1.5, layer: "front", zone: "top", ...extra });

// ---------------------------------------------------------------- schema

describe("EdlSchema", () => {
  it("accepts the full contract, including the parts rendered in later phases", () => {
    const full = edl({
      segments: [clip("s1", "c1", 0.94, 1.99, { framing: { scale: 1, origin: { x: 0.5, y: 0.4 }, move: { toScale: 1.08, ease: "easeInOut" } }, speed: 1.2 }), { id: "sc", type: "scene", duration: 2, background: { kind: "gradient", value: "linear-gradient(#000, #333)" } }],
      transitions: [{ between: ["s1", "sc"], type: "whip", duration: 0.25, direction: "left" }],
      overlays: [{ id: "o1", component: "HookTitle", props: { text: "Trois astuces" }, at: { word: "c1-w1", offset: -0.1 }, duration: 2, layer: "front", zone: "top", enter: { kind: "pop", duration: 0.3 } }],
      audio: { voice: { targetLufs: -14, denoise: true }, music: { file: "music/a.mp3", gainDb: -24, duck: true, fadeOut: 0.8 }, sfx: [{ file: "sfx/pop.wav", at: { segment: "sc", offset: 0 }, gainDb: -14 }] },
      notes: "test",
    });
    expect(EdlSchema.safeParse(full).success).toBe(true);
  });

  it("rejects a scale below 1, an unknown key, a move without ease and a malformed anchor", () => {
    const bad = (patch: (e: Record<string, unknown>) => void) => {
      const e = structuredClone(edl()) as unknown as Record<string, unknown>;
      patch(e);
      return EdlSchema.safeParse(e).success;
    };
    expect(bad((e) => ((e.segments as Record<string, Record<string, unknown>>[])[0]!.framing!.scale = 0.9))).toBe(false);
    expect(bad((e) => (e.extra = 1))).toBe(false);
    expect(bad((e) => ((e.segments as Record<string, Record<string, unknown>>[])[0]!.framing!.move = { toScale: 1.1 }))).toBe(false);
    expect(bad((e) => (e.overlays = [{ id: "o", component: "X", props: {}, at: { word: "c1-w1", segment: "s1" }, duration: 1, layer: "front", zone: "top" }]))).toBe(false);
    expect(bad(() => {})).toBe(true);
  });
});

// ---------------------------------------------------------------- frames

describe("segmentTimings", () => {
  it("places every boundary within half a frame of its exact time: no cumulative drift", () => {
    const segs: Segment[] = Array.from({ length: 200 }, (_, i) => clip(`s${i}`, "c1", 0.1, 0.1 + 0.1234 + (i % 7) * 0.0111));
    const t = segmentTimings(segs);
    let exact = 0;
    let naive = 0;
    segs.forEach((s, i) => {
      const seg = s as Extract<Segment, { type: "clip" }>;
      expect(Math.abs(t[i]!.fromFrame - exact * FPS)).toBeLessThanOrEqual(0.5 + 1e-9);
      naive += Math.round((seg.out - seg.in) * FPS);
      exact += seg.out - seg.in;
    });
    const total = t[t.length - 1]!.fromFrame + t[t.length - 1]!.durationInFrames;
    expect(total).toBe(Math.round(exact * FPS));
    // Summing rounded durations would have drifted by more than a frame.
    expect(Math.abs(naive - exact * FPS)).toBeGreaterThan(1);
  });

  it("frames are contiguous and the source span played follows the speed", () => {
    const t = segmentTimings([clip("a", "c1", 1, 4, { speed: 1.5 }), clip("b", "c1", 5, 6)]);
    expect(t[0]).toMatchObject({ fromFrame: 0, durationInFrames: 60, trimBefore: 30, rate: 1.5 });
    expect(t[0]!.srcEnd).toBeCloseTo(4, 9);
    expect(t[1]).toMatchObject({ fromFrame: 60, durationInFrames: 30, trimBefore: 150 });
  });

  it("continues the source without a gap when a segment only changes the framing", () => {
    // 1.93 → 3.35 is 42.6 frames, rounded to 43; a plain round(3.35 × 30) = 101 would skip a frame.
    const t = segmentTimings([clip("a", "c1", 1.93, 3.35), clip("b", "c1", 3.35, 5)]);
    expect(t[0]).toMatchObject({ trimBefore: 58, durationInFrames: 43 });
    expect(t[1]!.trimBefore).toBe(101);
    const t2 = segmentTimings([clip("a", "c1", 1.93, 3.36), clip("b", "c1", 3.36, 5)]);
    expect(t2[1]!.trimBefore).toBe(t2[0]!.trimBefore + t2[0]!.durationInFrames);
    // A real cut keeps its own in point.
    expect(segmentTimings([clip("a", "c1", 1.93, 3.35), clip("b", "c1", 4, 5)])[1]!.trimBefore).toBe(120);
  });

  it("converts seconds to the nearest frame", () => {
    expect(toFrame(1)).toBe(30);
    expect(toFrame(0.016)).toBe(0);
    expect(toFrame(0.017)).toBe(1);
  });
});

// ---------------------------------------------------------------- resolve

describe("resolveEdl", () => {
  it("resolves word and segment anchors to output frames", () => {
    const r = resolveEdl(
      edl({ audio: { voice: { targetLufs: -14, denoise: false }, sfx: [{ file: "a.wav", at: { word: "c1-w6" }, gainDb: -12 }, { file: "b.wav", at: { word: "c1-w6", edge: "end", offset: -0.1 }, gainDb: -12 }, { file: "c.wav", at: { segment: "s3", offset: 0.5 }, gainDb: -12 }] } }),
      facts,
      env,
    );
    expect(rules(r)).toEqual([]);
    // s1 lasts 1.05 s (frames 0-31.5 → 0-32); s2 starts at 1.05 s; "première" is at 3.7 s, 0.15 s into s2.
    const sfx = r.resolved!.audio.sfx.map((s) => s.fromFrame);
    expect(sfx[0]).toBe(toFrame(1.05 + (3.7 - 3.55)));
    expect(sfx[1]).toBe(toFrame(1.05 + (4.1 - 3.55) - 0.1));
    expect(sfx[2]).toBe(toFrame(1.05 + 2.13) + 15);
  });

  it("anchors relative to the frame-aligned source span", () => {
    const r = resolveEdl(edl(), facts, env);
    const s2 = r.resolved!.segments[1]!;
    expect(s2).toMatchObject({ type: "clip", fromFrame: 32, trimBefore: toFrame(3.55) });
    // trimBefore = 107 → source 3.5667 s: the word at 3.7 s plays 0.1333 s after the segment's first frame.
    expect(r.kept.get("c1-w6")!.start).toBeCloseTo(32 / 30 + (3.7 - 107 / 30), 9);
  });

  it("rejects an anchor on a word removed by the cuts, and on an unknown word or segment", () => {
    const anchors = [{ word: "c1-w4" }, { word: "c9-w1" }, { segment: "nope" }];
    const r = resolveEdl(edl({ audio: { voice: { targetLufs: -14, denoise: false }, sfx: anchors.map((at) => ({ file: "a.wav", at, gainDb: 0 })) } }), facts, env);
    expect(rules(r)).toEqual(["anchor-cut-word", "anchor-unknown-word", "anchor-unknown-segment"]);
  });

  it("reports a segment edge inside a word, keeps the word when most of it is played", () => {
    // s2 starts inside "la" (3.6-3.7): in 3.64 s is source frame 109 (3.633 s); s3 ends 0.2 s inside "fenêtre." (8.0-8.6).
    const r = resolveEdl(edl({ segments: [clip("s1", "c1", 0.94, 1.99), clip("s2", "c1", 3.64, 5.68), clip("s3", "c1", 6.94, 8.4)] }), facts, env);
    expect(rules(r)).toEqual(["cut-inside-word", "cut-inside-word"]);
    expect(r.issues[0]!.message).toContain("c1-w5");
    expect(r.kept.has("c1-w5")).toBe(true); // 0.067 of 0.1 s played: kept, clipped at the cut
    expect(r.kept.get("c1-w5")!.start).toBeCloseTo(r.resolved!.segments[1]!.fromFrame / FPS, 9);
    expect(r.kept.has("c1-w15")).toBe(true); // 0.4 of 0.6 s played
    const r2 = resolveEdl(edl({ segments: [clip("s1", "c1", 0.94, 1.99), clip("s2", "c1", 3.55, 5.68), clip("s3", "c1", 6.94, 8.1)] }), facts, env);
    expect(r2.kept.has("c1-w15")).toBe(false); // 0.1 of 0.6 s played: dropped
    expect(rules(r2)).toEqual(["cut-inside-word"]);
  });

  it("tolerates an edge that touches a word by less than the tolerance", () => {
    const inS = 3.6 + TRUNCATION_TOLERANCE / 2;
    // Aligned on a frame so that rounding does not move the edge.
    const r = resolveEdl(edl({ segments: [clip("s1", "c1", 0.94, 1.99), clip("s2", "c1", Math.round(inS * 30) / 30, 5.68), clip("s3", "c1", 6.94, 10.5)] }), facts, env);
    expect(rules(r)).toEqual([]);
  });

  it("maps word times through the speed of the segment", () => {
    const r = resolveEdl(edl({ segments: [clip("s1", "c1", 0.9, 2.1, { speed: 2 }), clip("s2", "c1", 6.9, 8.7)] }), facts, env);
    expect(r.kept.get("c1-w2")!.start).toBeCloseTo((1.45 - 0.9) / 2, 9);
    expect(r.resolved!.segments[0]).toMatchObject({ durationInFrames: 18, playbackRate: 2, trimBefore: 27 });
  });

  it("warns when a punch-in near an edge has to shift its crop to stay inside the source", () => {
    const r = resolveEdl(edl({ segments: [clip("s1", "c1", 0.94, 1.99, { framing: { scale: 1.3, origin: { x: 0.95, y: 0.05 } } }), clip("s2", "c1", 3.55, 5.68), clip("s3", "c1", 6.94, 10.5)] }), facts, env);
    expect(rules(r, "warning")).toContain("framing-shifted");
    expect(rules(r)).toEqual([]);
  });

  it("derives caption pages from the kept words, with active word frames", () => {
    const r = resolveEdl(edl(), facts, env);
    const pages = r.resolved!.captions.pages;
    const text = pages.map((p) => p.lines.flat().map((t) => t.text).join(" "));
    // "Euh," is cut; sentence ends break pages; "la" does not end a page; max 3 words.
    expect(text).toEqual(["BONJOUR À TOUS", "LA PREMIÈRE ASTUCE", "C'EST LA LUMIÈRE", "METTEZ-VOUS FACE", "À UNE FENÊTRE"]);
    const p = pages[1]!;
    const toks = p.lines.flat();
    expect(p.fromFrame).toBe(toks[0]!.fromFrame);
    expect(toks[0]!.toFrame).toBe(toks[1]!.fromFrame);
    expect(toks[2]!.toFrame).toBe(p.fromFrame + p.durationInFrames);
    expect(toks[1]!.fromFrame).toBe(toFrame(r.kept.get("c1-w6")!.start));
    // Pages never overlap.
    for (let i = 1; i < pages.length; i++) expect(pages[i]!.fromFrame).toBeGreaterThanOrEqual(pages[i - 1]!.fromFrame + pages[i - 1]!.durationInFrames);
  });

  it("applies emphasis, overrides (empty text removes the word) and hide", () => {
    const r = resolveEdl(
      edl({
        captions: {
          enabled: true,
          style: "bold",
          maxWordsPerPage: 3,
          position: "center",
          emphasis: [{ word: "c1-w10", style: "box" }],
          overrides: [{ word: "c1-w7", text: "astuce n°1" }, { word: "c1-w2", text: "" }],
          hide: [{ from: { word: "c1-w11" }, to: { segment: "s3", offset: 0.9 } }],
        },
      }),
      facts,
      env,
    );
    expect(rules(r)).toEqual([]);
    const toks = r.resolved!.captions.pages.flatMap((p) => p.lines.flat());
    expect(toks.find((t) => t.word === "c1-w10")).toMatchObject({ text: "LUMIÈRE", emphasis: "box" });
    expect(toks.find((t) => t.word === "c1-w7")!.text).toBe("ASTUCE N°1");
    expect(toks.some((t) => t.word === "c1-w2")).toBe(false);
    // s3 starts at 3.18 s of output; the hidden span ends 0.9 s later: w11 to w13 are hidden.
    expect(toks.some((t) => ["c1-w11", "c1-w12", "c1-w13"].includes(t.word))).toBe(false);
    expect(toks.some((t) => t.word === "c1-w14")).toBe(true);
    expect(r.resolved!.captions.pages.every((p) => p.position === "center")).toBe(true);
  });

  it("clips a page so it is not shown inside a hidden span", () => {
    const r = resolveEdl(edl({ captions: { enabled: true, style: "bold", maxWordsPerPage: 4, position: "lower-third", emphasis: [], overrides: [], hide: [{ from: { word: "c1-w3", edge: "end" }, to: { segment: "s2" } }] } }), facts, env);
    const first = r.resolved!.captions.pages[0]!;
    expect(first.fromFrame + first.durationInFrames).toBeLessThanOrEqual(toFrame(r.kept.get("c1-w3")!.end));
  });

  it("shrinks a page whose single word is wider than the safe width, and refuses one that never fits", () => {
    const wide = { words: [...facts.analysis.words, { id: "c2-w3", clip: "c2", text: "anticonstitutionnels", start: 3, end: 4 }] };
    const r = resolveEdl(edl({ segments: [clip("s1", "c2", 2.9, 4.1), clip("s2", "c1", 0.94, 5.68)] }), { ...facts, analysis: wide }, env);
    expect(rules(r, "warning")).toContain("caption-shrunk");
    const huge = { words: [...facts.analysis.words, { id: "c2-w3", clip: "c2", text: "anticonstitutionnellementissimes", start: 3, end: 4 }] };
    const r2 = resolveEdl(edl({ segments: [clip("s1", "c2", 2.9, 4.1), clip("s2", "c1", 0.94, 5.68)] }), { ...facts, analysis: huge }, env);
    expect(rules(r2)).toContain("caption-overflow");
  });

  it("centres a transition window on the cut and extends each side with its own source frames", () => {
    const r = resolveEdl(edl({ transitions: [{ between: ["s1", "s2"], type: "whip", duration: 0.25, direction: "left" }] }), facts, env);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const t = r.resolved!.transitions[0]!;
    const [a, b] = r.resolved!.segments as Extract<ResolvedSegment, { type: "clip" }>[];
    expect(t.atFrame).toBe(b!.fromFrame);
    expect(t.durationInFrames).toBe(8);
    expect(t.fromFrame).toBe(t.atFrame - 4);
    // The total duration does not change.
    expect(r.resolved!.durationInFrames).toBe(resolveEdl(edl(), facts, env).resolved!.durationInFrames);
    if (t.outgoing.kind !== "clip" || t.incoming.kind !== "clip") throw new Error("clip sides expected");
    // Outgoing: on the window's first frame, the frame the segment itself shows; after the cut, its handle.
    expect(t.outgoing.firstSourceFrame).toBe(a!.trimBefore + (t.fromFrame - a!.fromFrame));
    expect(t.outgoing.firstSourceFrame + 8).toBeGreaterThan(a!.trimBefore + a!.durationInFrames);
    // Incoming: 4 source frames before its first frame.
    expect(t.incoming.firstSourceFrame).toBe(b!.trimBefore - 4);
    expect(t.incoming.firstSegmentFrame).toBe(-4);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(resolveEdl(edl(), facts, env).resolved)).toBe(JSON.stringify(resolveEdl(edl(), facts, env).resolved));
  });
});

// ---------------------------------------------------------------- caption grouping

describe("breakPages", () => {
  const w = (text: string, start: number): CaptionWord => ({ word: text, text, source: text, start, end: start + 0.2 });
  const opts = { maxWords: 3, gap: 0.45, language: "fr", barriers: [], fits: () => true };

  it("does not end a page on an article or a number", () => {
    const pages = breakPages([w("prenez", 0), w("toujours", 0.2), w("un", 0.4), w("micro", 0.6)], opts);
    expect(pages.map((p) => p.map((x) => x.text).join(" "))).toEqual(["prenez toujours", "un micro"]);
    const n = breakPages([w("il", 0), w("faut", 0.2), w("30", 0.4), w("secondes", 0.6)], opts);
    expect(n.map((p) => p.map((x) => x.text).join(" "))).toEqual(["il faut", "30 secondes"]);
  });

  it("breaks after a sentence, after a pause and across a barrier", () => {
    const pages = breakPages([w("Oui.", 0), w("Alors", 0.2), w("voilà", 1.2), w("tout", 1.4)], { ...opts, barriers: [1.39] });
    expect(pages.map((p) => p.length)).toEqual([1, 1, 1, 1]);
  });

  it("knows French clitics", () => {
    expect(["la", "L'", "de", "Vous", "12"].every((x) => isClitic(x, "fr"))).toBe(true);
    expect(["micro", "astuce,", "la."].some((x) => isClitic(x, "fr"))).toBe(false);
  });
});

// ---------------------------------------------------------------- framing

describe("framing", () => {
  const out = { width: 1080, height: 1920 };

  it("takes the whole picture of a 9:16 source at scale 1", () => {
    expect(cropRect({ width: 1080, height: 1920 }, out, 1, { x: 0.5, y: 0.4 })).toMatchObject({ x: 0, y: 0, width: 1080, height: 1920, shifted: false });
  });

  it("crops a landscape source to 9:16 around the origin", () => {
    const c = cropRect({ width: 1920, height: 1080 }, out, 1, { x: 0.5, y: 0.5 });
    expect(c.width).toBeCloseTo(607.5, 6);
    expect(c.height).toBe(1080);
    expect(c.x).toBeCloseTo((1920 - 607.5) / 2, 6);
  });

  it("centres a punch-in on the origin, and shifts it near an edge instead of leaving the source", () => {
    const src = { width: 1080, height: 1920 };
    const c = cropRect(src, out, 1.3, { x: 0.4, y: 0.55 });
    expect(c.x + c.width / 2).toBeCloseTo(0.4 * 1080, 6);
    expect(c.y + c.height / 2).toBeCloseTo(0.55 * 1920, 6);
    expect(c.shifted).toBe(false);
    // At 1.25 the crop is 1536 px tall: its centre cannot go above 768 px (0.4).
    expect(cropRect(src, out, 1.25, { x: 0.5, y: 0.32 })).toMatchObject({ y: 0, shifted: true });
    const e = cropRect(src, out, 1.25, { x: 0.88, y: 0.12 });
    expect(e).toMatchObject({ x: 1080 - 864, y: 0, shifted: true });
    const p = placeSource(src, out, e);
    expect(p.width).toBeCloseTo(1350, 6);
    expect(p.x + p.width).toBeCloseTo(1080, 6); // right edge of the source on the right edge of the frame
  });

  it("moves from the start framing on the first frame to the target on the last", () => {
    const f = { scale: 1, origin: { x: 0.5, y: 0.4 }, move: { toScale: 1.1, toOrigin: { x: 0.5, y: 0.3 }, ease: "easeInOut" as const } };
    expect(framingAt(f, 0, 90)).toEqual({ scale: 1, origin: { x: 0.5, y: 0.4 } });
    const end = framingAt(f, 89, 90);
    expect(end.scale).toBeCloseTo(1.1, 9);
    expect(end.origin.y).toBeCloseTo(0.3, 9);
    expect(ease("easeInOut", 0.5)).toBeCloseTo(0.5, 9);
    expect(ease("easeOut", 0.5)).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------- validate: one faulty EDL per rule

describe("validateEdl", () => {
  const run = (e: unknown, reg: OverlayRegistry = {}) => validateEdl(e, facts, { measure, overlays: reg });

  it("accepts the reference fixture", () => {
    const r = run(edl());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("reports schema errors with their path", () => {
    const r = run({ ...edl(), version: 2 });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ rule: "schema", path: "version" });
  });

  const cases: [string, Partial<Edl>, OverlayRegistry?][] = [
    ["segment-in-out", { segments: [clip("s1", "c1", 2, 1), clip("s2", "c1", 3.55, 9)] }],
    ["segment-out-of-clip", { segments: [clip("s1", "c1", 6.94, 12.5)] }],
    ["unknown-clip", { segments: [clip("s1", "c7", 0, 6)] }],
    ["duplicate-id", { segments: [clip("s1", "c1", 0.94, 1.99), clip("s1", "c1", 3.55, 8.7)] }],
    ["cut-inside-word", { segments: [clip("s1", "c1", 0.94, 1.99), clip("s2", "c1", 3.65, 5.68), clip("s3", "c1", 6.94, 10.5)] }],
    ["anchor-cut-word", { audio: { voice: { targetLufs: -14, denoise: false }, sfx: [] }, captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "center", emphasis: [], overrides: [], hide: [{ from: { word: "c1-w4" }, to: { segment: "s3" } }] } }],
    ["anchor-unknown-word", { captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "center", emphasis: [], overrides: [], hide: [{ from: { word: "w4" }, to: { segment: "s3" } }] } }],
    ["caption-unknown-word", { captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "center", emphasis: [{ word: "c1-w99", style: "color" }], overrides: [], hide: [] } }],
    ["unknown-caption-style", { captions: { enabled: true, style: "neon", maxWordsPerPage: 3, position: "center", emphasis: [], overrides: [], hide: [] } }],
    ["unknown-brand", { meta: { title: "x", fps: 30, width: 1080, height: 1920, brand: "acme", language: "fr" } }],
    ["transition-not-consecutive", { transitions: [{ between: ["s1", "s3"], type: "cut", duration: 0 }] }],
    ["transition-unknown-segment", { transitions: [{ between: ["s1", "zz"], type: "cut", duration: 0 }] }],
    ["transition-too-long", { transitions: [{ between: ["s1", "s2"], type: "fade", duration: 1.2 }] }],
    ["transition-too-long", { segments: [clip("s1", "c1", 0.94, 1.99), clip("s2", "c1", 3.55, 5.68), clip("s3", "c1", 6.94, 10.5)], transitions: [{ between: ["s2", "s3"], type: "fade", duration: 1.1 }] }],
    ["transition-direction", { transitions: [{ between: ["s1", "s2"], type: "fade", duration: 0.3, direction: "left" }] }],
    ["transition-duration", { transitions: [{ between: ["s1", "s2"], type: "whip", duration: 0 }] }],
    ["not-rendered-yet", { audio: { voice: { targetLufs: -14, denoise: false }, music: { file: "m.mp3", gainDb: -24, duck: true, fadeOut: 1 }, sfx: [] } }],
    ["not-rendered-yet", { audio: { voice: { targetLufs: -14, denoise: false }, sfx: [{ file: "pop.wav", at: { segment: "s2" }, gainDb: -14 }] } }],
    ["overlay-zone", { overlays: [{ id: "o1", component: "HookTitle", props: { text: "Trois astuces" }, at: { word: "c1-w1" }, duration: 2, layer: "front", zone: "bottom" }] }, overlayRegistry],
    ["overlay-props", { overlays: [{ id: "o1", component: "BigNumber", props: { value: "87" }, at: { word: "c1-w1" }, duration: 2, layer: "front", zone: "top" }] }, overlayRegistry],
    ["overlay-text-overflow", { overlays: [tag("o1", { word: "c1-w1" }, { props: { text: "un texte beaucoup trop long pour tenir sur une seule ligne" } })] }, registry],
    ["overlay-motion", { overlays: [tag("o1", { word: "c1-w1" }, { duration: 0.3, enter: { duration: 0.3 }, exit: { duration: 0.2 } })] }, registry],
    ["overlay-cues", { overlays: [tag("o1", { word: "c1-w1" }, { cues: [{ word: "c1-w1" }, { word: "c1-w2" }, { word: "c1-w3" }] })] }, registry],
    ["overlay-cue-range", { overlays: [tag("o1", { word: "c1-w1" }, { cues: [{ segment: "s3" }] })] }, registry],
    ["caption-overlay-overlap", { overlays: [tag("o1", { word: "c1-w1" }, { zone: "bottom" })] }, registry],
    ["overlay-zone-overflow", { overlays: [tag("o1", { word: "c1-w1" })] }, { Tag: { ...registry.Tag!, layout: (_p: unknown, ctx: LayoutContext) => ({ layout: null, box: { ...ctx.area, height: ctx.area.height + 50 }, texts: [] }) } }],
    ["overlay-safe-zone", { overlays: [tag("o1", { word: "c1-w1" })] }, { Tag: { ...registry.Tag!, layout: (_p: unknown, ctx: LayoutContext) => ({ layout: null, box: { ...ctx.area, x: 20 }, texts: [] }) } }],
    ["caption-overlay-overlap", { captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "center", emphasis: [], overrides: [], hide: [] }, overlays: [tag("o1", { word: "c1-w1" }, { zone: "center" })] }, registry],
    ["unknown-overlay", { overlays: [{ id: "o1", component: "HookTitle", props: {}, at: { word: "c1-w1" }, duration: 2, layer: "front", zone: "top" }] }],
    ["overlay-props", { overlays: [{ id: "o1", component: "Tag", props: { text: 3 }, at: { word: "c1-w1" }, duration: 2, layer: "front", zone: "top" }] }, registry],
    [
      "overlay-overlap",
      {
        overlays: [
          { id: "o1", component: "Tag", props: { text: "a" }, at: { word: "c1-w1" }, duration: 2, layer: "front", zone: "top" },
          { id: "o2", component: "Tag", props: { text: "b" }, at: { word: "c1-w3" }, duration: 1, layer: "front", zone: "top" },
        ],
      },
      registry,
    ],
    ["duration", { segments: [clip("s1", "c1", 0.94, 1.99)] }],
    ["hide-empty", { captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "center", emphasis: [], overrides: [], hide: [{ from: { segment: "s2" }, to: { segment: "s1" } }] } }],
  ];

  for (const [rule, patch, reg] of cases) {
    it(`rejects: ${rule}`, () => {
      const r = run(edl(patch), reg);
      expect(r.ok).toBe(false);
      expect(rules(r)).toContain(rule);
    });
  }

  it("accepts two overlays that share a zone on different layers, or follow each other", () => {
    const r = run(
      edl({
        overlays: [
          { id: "o1", component: "Tag", props: { text: "a" }, at: { word: "c1-w1" }, duration: 1, layer: "front", zone: "top" },
          { id: "o2", component: "Tag", props: { text: "b" }, at: { word: "c1-w3" }, duration: 1, layer: "background", zone: "top" },
          { id: "o3", component: "Tag", props: { text: "c" }, at: { segment: "s2" }, duration: 1, layer: "front", zone: "top" },
        ],
      }),
      registry,
    );
    expect(rules(r)).toEqual([]);
  });

  it("accepts the transitions and the overlays the renderer draws, and moves captions above a bottom overlay", () => {
    const r = run(
      edl({
        transitions: [
          { between: ["s1", "s2"], type: "whip", duration: 0.25, direction: "up" },
          { between: ["s2", "s3"], type: "fade", duration: 0.4 },
        ],
        captions: { enabled: true, style: "bold", maxWordsPerPage: 3, position: "auto", emphasis: [], overrides: [], hide: [] },
        overlays: [tag("o1", { word: "c1-w1" }, { zone: "bottom" }), tag("o2", { segment: "s2" }, { zone: "top", cues: [{ word: "c1-w6" }] })],
      }),
      registry,
    );
    expect(rules(r)).toEqual([]);
    const pages = r.resolved!.captions.pages;
    expect(pages[0]!.position).toBe("center");
    expect(pages[pages.length - 1]!.position).toBe("lower-third");
  });

  it("warns outside the director's ranges: transition duration, words and seconds of an overlay, an exit longer than the entrance", () => {
    const r = run(
      edl({
        transitions: [{ between: ["s1", "s2"], type: "flash", duration: 0.4 }],
        overlays: [tag("o1", { word: "c1-w1" }, { props: { text: "un deux trois quatre cinq six sept" }, duration: 5, exit: { duration: 0.5 } })],
      }),
      { ...registry, Tag: { ...registry.Tag!, layout: (_p: unknown, ctx: { area: { x: number; y: number; width: number; height: number } }) => ({ layout: null, box: ctx.area, texts: [] }) } },
    );
    expect(rules(r)).toEqual([]);
    expect(rules(r, "warning")).toEqual(expect.arrayContaining(["transition-range", "overlay-word-count", "overlay-duration", "overlay-motion"]));
  });

  it("rejects captions outside the safe zone", () => {
    const styles = { bold: { ...boldStyle, positions: { center: 960, "lower-third": 1600 } } };
    const r = validateEdl(edl(), facts, { measure, overlays: {}, styles });
    expect(rules(r)).toContain("caption-safe-zone");
  });
});
