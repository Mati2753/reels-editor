import { brands as defaultBrands, type BrandKit } from "../brand";
import type { Analysis, Probe } from "../pipeline/schemas";
import { captionStyles as defaultStyles, type CaptionStyle } from "../remotion/captions/styles";
import { activeGrowth, breakPages, displayText, layoutPage, type CaptionWord, type LayoutEnv } from "./captions";
import { cropRect, framingAt, maxAdvisedScale } from "./framing";
import { IssueList, type Issue } from "./issues";
import type { TextMeasurer } from "./measure";
import type { ResolvedCaptionPage, ResolvedClipSegment, ResolvedEdl, ResolvedOverlay, ResolvedSegment, ResolvedToken, ResolvedTransition } from "./resolved";
import { isWordAnchor, type Anchor, type Edl, type Motion } from "./schema";

/**
 * resolve(edl, facts) ──► the resolved EDL the Remotion composition renders.
 *
 * The only place where seconds become frames. Segment boundaries are placed on the
 * cumulative output time (frame = round(seconds × fps)), so rounding never accumulates:
 * every boundary is within half a frame of its exact time however many segments precede
 * it. Word times come from analysis.words (bounds re-aligned on the audio energy).
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** A segment edge more than this far inside a word truncates it (seconds). */
export const TRUNCATION_TOLERANCE = 0.02;

/**
 * Folder of the render's public directory that mirrors the project's work/ folder; a
 * clip's normalized video is served at media/<path in work/> ("media/c1/source.mp4").
 */
export const MEDIA_DIR = "media";

export function mediaPath(normalizedVideo: string): string {
  return `${MEDIA_DIR}/${normalizedVideo}`;
}

export interface Facts {
  probe: Probe;
  analysis: Pick<Analysis, "words">;
}

export interface ResolveEnv {
  measure: TextMeasurer;
  brands?: Readonly<Record<string, BrandKit>>;
  styles?: Readonly<Record<string, CaptionStyle>>;
}

export interface ResolveResult {
  /** Null when the EDL names an unknown brand or caption style or clip: nothing to render. */
  resolved: ResolvedEdl | null;
  issues: Issue[];
  /** Output time (seconds) of every kept word, by word id (first occurrence). */
  kept: Map<string, KeptWord>;
}

export interface KeptWord {
  word: string;
  clip: string;
  text: string;
  segment: string;
  /** Output seconds (clipped to the segment when the word straddles an edge). */
  start: number;
  end: number;
}

export function toFrame(seconds: number): number {
  return Math.round(seconds * FPS);
}

interface SegmentTiming {
  fromFrame: number;
  durationInFrames: number;
  /** Clip segments: first source frame, rate, and the source span really played (seconds). */
  trimBefore: number;
  rate: number;
  srcStart: number;
  srcEnd: number;
}

/**
 * Output frames of each segment. Boundaries come from the cumulative exact duration, never
 * from a sum of rounded durations.
 */
export function segmentTimings(segments: Edl["segments"]): SegmentTiming[] {
  let cumulative = 0;
  const out: SegmentTiming[] = [];
  segments.forEach((seg, i) => {
    out.push(timing(seg, segments[i - 1], out[i - 1]));
  });
  return out;

  function timing(seg: Edl["segments"][number], prevSeg: Edl["segments"][number] | undefined, prev: SegmentTiming | undefined): SegmentTiming {
    const fromFrame = toFrame(cumulative);
    if (seg.type === "clip") {
      const rate = seg.speed ?? 1;
      cumulative += (seg.out - seg.in) / rate;
      const durationInFrames = toFrame(cumulative) - fromFrame;
      // A segment that continues the previous one in the source (a change of framing
      // without a cut) starts on the source frame right after it: no frame repeated or
      // skipped, so no click in the voice.
      const continues = prevSeg?.type === "clip" && prev && prevSeg.clip === seg.clip && Math.abs(prevSeg.out - seg.in) < 1e-6 && prev.rate === rate && rate === 1;
      const trimBefore = continues ? prev.trimBefore + prev.durationInFrames : toFrame(seg.in);
      const srcStart = trimBefore / FPS;
      return { fromFrame, durationInFrames, trimBefore, rate, srcStart, srcEnd: srcStart + (durationInFrames * rate) / FPS };
    }
    cumulative += seg.duration;
    return { fromFrame, durationInFrames: toFrame(cumulative) - fromFrame, trimBefore: 0, rate: 1, srcStart: 0, srcEnd: 0 };
  }
}

/** Output seconds of source time `t` inside a clip segment. */
function sourceToOutput(timing: SegmentTiming, t: number): number {
  return timing.fromFrame / FPS + (t - timing.srcStart) / timing.rate;
}

export function resolveEdl(edl: Edl, facts: Facts, env: ResolveEnv): ResolveResult {
  const issues = new IssueList();
  const kept = new Map<string, KeptWord>();
  const brand = (env.brands ?? defaultBrands)[edl.meta.brand];
  const style = (env.styles ?? defaultStyles)[edl.captions.style];
  if (!brand) issues.error("unknown-brand", "meta.brand", `brand "${edl.meta.brand}" is not in src/brand/index.ts`);
  if (!style) issues.error("unknown-caption-style", "captions.style", `caption style "${edl.captions.style}" is not in src/remotion/captions/styles.ts`);

  const clips = new Map(facts.probe.clips.map((c) => [c.id, c]));
  const wordsById = new Map(facts.analysis.words.map((w) => [w.id, w]));
  const timings = segmentTimings(edl.segments);
  const durationInFrames = timings.length > 0 ? timings[timings.length - 1]!.fromFrame + timings[timings.length - 1]!.durationInFrames : 0;
  const segIndex = new Map(edl.segments.map((s, i) => [s.id, i]));

  // ---- segments and kept words
  const segments: ResolvedSegment[] = [];
  const occurrences: KeptWord[] = [];
  let missingClip = false;
  edl.segments.forEach((seg, i) => {
    const t = timings[i]!;
    const path = `segments[${i}]`;
    if (t.durationInFrames < 1) issues.error("segment-too-short", path, `segment "${seg.id}" lasts less than one frame`);
    if (seg.type === "scene") {
      segments.push({ type: "scene", id: seg.id, fromFrame: t.fromFrame, durationInFrames: t.durationInFrames, background: seg.background });
      return;
    }
    const clip = clips.get(seg.clip);
    if (!clip) {
      issues.error("unknown-clip", `${path}.clip`, `clip "${seg.clip}" is not in probe.json`);
      missingClip = true;
      return;
    }
    const source = { width: clip.normalized.width, height: clip.normalized.height };
    const resolvedSeg: ResolvedClipSegment = {
      type: "clip",
      id: seg.id,
      clip: seg.clip,
      src: mediaPath(clip.normalized.video),
      sourceWidth: source.width,
      sourceHeight: source.height,
      fromFrame: t.fromFrame,
      durationInFrames: t.durationInFrames,
      trimBefore: t.trimBefore,
      playbackRate: t.rate,
      framing: seg.framing,
    };
    segments.push(resolvedSeg);

    // Framing: report crops shifted away from their origin, and scales past the advised maximum.
    const output = { width: WIDTH, height: HEIGHT };
    for (const [label, state] of [
      ["start", framingAt(seg.framing, 0, t.durationInFrames)],
      ["end", framingAt(seg.framing, Math.max(0, t.durationInFrames - 1), t.durationInFrames)],
    ] as const) {
      if (label === "end" && !seg.framing.move) break;
      const crop = cropRect(source, output, state.scale, state.origin);
      if (crop.shifted) {
        const cx = (crop.x + crop.width / 2) / source.width;
        const cy = (crop.y + crop.height / 2) / source.height;
        issues.warn(
          "framing-shifted",
          `${path}.framing`,
          `segment "${seg.id}" (${label}): origin (${state.origin.x}, ${state.origin.y}) at scale ${round3(state.scale)} would leave the source picture; the crop is shifted to centre (${round3(cx)}, ${round3(cy)})`,
        );
      }
    }
    const maxScale = maxAdvisedScale(source);
    const top = Math.max(seg.framing.scale, seg.framing.move?.toScale ?? 0);
    if (top > maxScale + 1e-9) issues.warn("framing-scale", `${path}.framing`, `segment "${seg.id}" zooms to ${top}, above ${maxScale} advised for a ${source.width}x${source.height} source: the picture gets soft`);

    for (const w of facts.analysis.words) {
      if (w.clip !== seg.clip) continue;
      const dur = w.end - w.start;
      const overlap = Math.min(w.end, t.srcEnd) - Math.max(w.start, t.srcStart);
      if (overlap <= 0 && !(dur === 0 && w.start >= t.srcStart && w.start < t.srcEnd)) continue;
      const head = t.srcStart - w.start;
      const tail = w.end - t.srcEnd;
      const isKept = dur <= 0 ? true : overlap >= dur / 2;
      if (overlap > TRUNCATION_TOLERANCE && (head > TRUNCATION_TOLERANCE || tail > TRUNCATION_TOLERANCE)) {
        const where = head > TRUNCATION_TOLERANCE ? `starts ${round3(head)} s after` : `ends ${round3(tail)} s before`;
        issues.error(
          "cut-inside-word",
          path,
          `segment "${seg.id}" ${where} the edge of word ${w.id} "${w.text}" (${w.start}-${w.end}): ${round3(overlap)} s of ${round3(dur)} s played. ` +
            `Cut in the silence before or after the word (the source span really played is ${round3(t.srcStart)}-${round3(t.srcEnd)} s).`,
        );
      }
      if (!isKept) continue;
      occurrences.push({
        word: w.id,
        clip: w.clip,
        text: w.text,
        segment: seg.id,
        start: sourceToOutput(t, Math.max(w.start, t.srcStart)),
        end: sourceToOutput(t, Math.min(w.end, t.srcEnd)),
      });
    }
  });
  occurrences.sort((a, b) => a.start - b.start);
  const seenTwice = new Set<string>();
  for (const o of occurrences) {
    if (kept.has(o.word)) seenTwice.add(o.word);
    else kept.set(o.word, o);
  }
  for (const w of seenTwice) issues.warn("word-kept-twice", "segments", `word ${w} is played by more than one segment; anchors use its first occurrence`);

  // ---- anchors
  const anchorTime = (anchor: Anchor, path: string): number | null => {
    if (isWordAnchor(anchor)) {
      const k = kept.get(anchor.word);
      if (!k) {
        if (wordsById.has(anchor.word)) issues.error("anchor-cut-word", path, `anchor on word ${anchor.word} "${wordsById.get(anchor.word)?.text}", which no segment keeps`);
        else issues.error("anchor-unknown-word", path, `anchor on word "${anchor.word}", which is not in analysis.json`);
        return null;
      }
      return (anchor.edge === "end" ? k.end : k.start) + (anchor.offset ?? 0);
    }
    const i = segIndex.get(anchor.segment);
    if (i === undefined) {
      issues.error("anchor-unknown-segment", path, `anchor on segment "${anchor.segment}", which does not exist`);
      return null;
    }
    return timings[i]!.fromFrame / FPS + (anchor.offset ?? 0);
  };
  const anchorFrame = (anchor: Anchor, path: string): number | null => {
    const t = anchorTime(anchor, path);
    if (t === null) return null;
    const f = toFrame(t);
    if (f < 0 || f > durationInFrames) issues.error("anchor-out-of-range", path, `anchor resolves to ${round3(t)} s, outside the Reel (0-${round3(durationInFrames / FPS)} s)`);
    return f;
  };
  const motion = (m: Motion | undefined) => (m ? { kind: m.kind, durationInFrames: Math.max(1, toFrame(m.duration)), ...(m.direction ? { direction: m.direction } : {}) } : undefined);

  // ---- transitions
  const transitions: ResolvedTransition[] = [];
  edl.transitions.forEach((tr) => {
    const b = segIndex.get(tr.between[1]);
    if (b === undefined) return; // reported by validate
    transitions.push({
      between: tr.between,
      type: tr.type,
      atFrame: timings[b]!.fromFrame,
      durationInFrames: toFrame(tr.duration),
      ...(tr.direction ? { direction: tr.direction } : {}),
    });
  });

  // ---- overlays
  const overlays: ResolvedOverlay[] = [];
  edl.overlays.forEach((ov, i) => {
    const f = anchorFrame(ov.at, `overlays[${i}].at`);
    if (f === null) return;
    const enter = motion(ov.enter);
    const exit = motion(ov.exit);
    overlays.push({
      id: ov.id,
      component: ov.component,
      props: ov.props,
      fromFrame: f,
      durationInFrames: Math.max(1, toFrame(ov.duration)),
      layer: ov.layer,
      zone: ov.zone,
      ...(enter ? { enter } : {}),
      ...(exit ? { exit } : {}),
    });
  });

  // ---- audio
  const sfx: ResolvedEdl["audio"]["sfx"] = [];
  edl.audio.sfx.forEach((s, i) => {
    const f = anchorFrame(s.at, `audio.sfx[${i}].at`);
    if (f !== null) sfx.push({ file: s.file, fromFrame: f, gainDb: s.gainDb });
  });
  const music = edl.audio.music;

  // ---- captions
  const pages: ResolvedCaptionPage[] = [];
  const emphasis = new Map<string, "color" | "scale" | "box">();
  const overrides = new Map<string, string>();
  edl.captions.emphasis.forEach((e, i) => {
    checkCaptionWord(e.word, `captions.emphasis[${i}]`);
    emphasis.set(e.word, e.style);
  });
  edl.captions.overrides.forEach((o, i) => {
    checkCaptionWord(o.word, `captions.overrides[${i}]`);
    overrides.set(o.word, o.text);
  });
  function checkCaptionWord(word: string, path: string): void {
    if (!wordsById.has(word)) issues.error("caption-unknown-word", path, `word "${word}" is not in analysis.json`);
    else if (!kept.has(word)) issues.warn("caption-cut-word", path, `word ${word} "${wordsById.get(word)?.text}" is cut by the segments: this entry has no effect`);
  }
  const hidden: { from: number; to: number }[] = [];
  edl.captions.hide.forEach((h, i) => {
    const from = anchorTime(h.from, `captions.hide[${i}].from`);
    const to = anchorTime(h.to, `captions.hide[${i}].to`);
    if (from === null || to === null) return;
    if (to <= from) issues.error("hide-empty", `captions.hide[${i}]`, `hide ends (${round3(to)} s) before it starts (${round3(from)} s)`);
    else hidden.push({ from, to });
  });

  if (style && brand && edl.captions.enabled) {
    const language = edl.meta.language;
    const safe = brand.safeZone;
    const centerX = WIDTH / 2;
    const halfWidth = Math.min(centerX - safe.left, WIDTH - safe.right - centerX);
    const env2: LayoutEnv = { style, brand, measure: env.measure, language, maxWidth: 2 * halfWidth - 2 * style.outlineWidth };
    const tokens: CaptionWord[] = [];
    for (const o of occurrences) {
      const source = overrides.get(o.word) ?? o.text;
      if (source.trim() === "") continue;
      if (hidden.some((h) => o.start >= h.from && o.start < h.to)) continue;
      const e = emphasis.get(o.word);
      tokens.push({ word: o.word, text: displayText(source, style, language), source, start: o.start, end: o.end, ...(e ? { emphasis: e } : {}) });
    }
    const groups = breakPages(tokens, {
      maxWords: edl.captions.maxWordsPerPage,
      gap: style.pageBreakGapSeconds,
      language,
      barriers: hidden.flatMap((h) => [h.from, h.to]),
      fits: (run) => layoutPage(run, env2, false) !== null,
    });
    groups.forEach((group, g) => {
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const next = groups[g + 1]?.[0];
      const fromFrame = toFrame(first.start);
      let endFrame = toFrame(last.end + style.lingerSeconds);
      if (next) endFrame = Math.min(endFrame, toFrame(next.start));
      for (const h of hidden) if (h.from >= first.start) endFrame = Math.min(endFrame, toFrame(h.from));
      endFrame = Math.min(endFrame, durationInFrames);
      if (endFrame <= fromFrame) endFrame = fromFrame + 1;
      const layout = layoutPage(group, env2, true)!;
      const starts = group.map((t) => toFrame(t.start));
      const toks: ResolvedToken[] = group.map((t, k) => ({
        word: t.word,
        text: t.text,
        fromFrame: starts[k]!,
        toFrame: k + 1 < group.length ? starts[k + 1]! : endFrame,
        ...(t.emphasis ? { emphasis: t.emphasis } : {}),
        width: round3(layout.widths[k] ?? 0),
      }));
      const overlapsBottom = overlays.some((ov) => (ov.zone === "bottom" || ov.zone === "full") && ov.fromFrame < endFrame && ov.fromFrame + ov.durationInFrames > fromFrame);
      const position = edl.captions.position === "auto" ? (overlapsBottom ? "center" : "lower-third") : edl.captions.position;
      const height = layout.lines.length * layout.fontSize * style.lineHeight + 2 * style.outlineWidth;
      const width = Math.max(...layout.lineWidths) + activeGrowth(layout.widths, style) + 2 * style.outlineWidth;
      const centerY = style.positions[position];
      const page: ResolvedCaptionPage = {
        fromFrame,
        durationInFrames: endFrame - fromFrame,
        position,
        fontSize: layout.fontSize,
        lines: layout.lines.map((l) => l.map((k) => toks[k]!)),
        box: { x: round3(centerX - width / 2), y: round3(centerY - height / 2), width: round3(width), height: round3(height) },
      };
      pages.push(page);
      const text = group.map((t) => t.text).join(" ");
      if (layout.overflow) issues.error("caption-overflow", "captions", `page "${text}" does not fit the safe width even at ${style.minFontSize} px`);
      else if (layout.fontSize < style.fontSize) issues.warn("caption-shrunk", "captions", `page "${text}" is set at ${layout.fontSize} px instead of ${style.fontSize} px to fit the safe width`);
    });
  }

  if (!brand || !style || missingClip) return { resolved: null, issues: issues.items, kept };

  return {
    resolved: {
      version: 1,
      title: edl.meta.title,
      fps: FPS,
      width: WIDTH,
      height: HEIGHT,
      durationInFrames,
      brand,
      captionStyle: style,
      segments,
      transitions,
      overlays,
      captions: { enabled: edl.captions.enabled, pages },
      audio: {
        voice: edl.audio.voice,
        ...(music ? { music: { file: music.file, gainDb: music.gainDb, duck: music.duck, startFrame: toFrame(music.startAt ?? 0), fadeOutFrames: toFrame(music.fadeOut) } } : {}),
        sfx,
      },
    },
    issues: issues.items,
    kept,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
