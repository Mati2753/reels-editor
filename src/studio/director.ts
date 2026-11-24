import { FPS, toFrame, MAX_DURATION, MIN_DURATION, ms } from "../edl/time";
import type { ClipSegment, Edl } from "../edl/schema";
import type { Analysis, Probe, TimedWord } from "../pipeline/schemas";
import { subtract, type Interval } from "../pipeline/analysis/intervals";
import type { Format } from "./formats";

export { SettingsSchema, type Settings } from "./settings";
import type { Settings } from "./settings";
export interface Beat extends Interval {
  id: string;
  clip: string;
  text: string;
  score: number;
  shot: boolean;
  firstSentence?: string;
  lastSentence?: string;
}
export interface Decision {
  title: string;
  detail: string;
}
export interface Selection {
  ids: string[];
  title?: string;
  reason?: string;
}
const onFrame = (s: number) => toFrame(s) / FPS;

function boundary(time: number, words: TimedWord[], low: number, high: number): number | undefined {
  const edges = [time, ...words.flatMap((w) => [w.start, w.end])]
    .map(onFrame)
    .filter((t) => t >= low && t <= high)
    .sort((a, b) => Math.abs(a - time) - Math.abs(b - time));
  return edges.find((t) => words.every((w) => t <= w.start + 0.018 || t >= w.end - 0.018));
}

function strength(text: string): number {
  return (
    (/\d/.test(text) ? 2 : 0) +
    (/[?!]/.test(text) ? 1.5 : 0) +
    (/\b(how|why|secret|first|best|because|voici|comment|pourquoi|astuce|premier)\b/i.test(text) ? 2 : 0)
  );
}

export function findBeats(probe: Probe, facts: Analysis, format: Format, settings: Settings): Beat[] {
  const beats: Beat[] = [];
  for (const clip of probe.clips) {
    const length = Math.min(clip.normalized.duration, clip.normalized.frames / FPS);
    const words = facts.words.filter((w) => w.clip === clip.id);
    const silences = facts.silences.filter((s) => s.clip === clip.id && s.duration >= format.pauseSeconds);
    const remove: Interval[] = [];
    if (settings.cuts && words.length) {
      for (const s of silences) {
        const start = s.start < 0.04 ? 0 : boundary(s.start + 0.12, words, s.start, s.end);
        const end = s.end >= length - 0.04 ? length : boundary(s.end - 0.1, words, s.start, s.end);
        if (start !== undefined && end !== undefined && end > start) remove.push({ start, end });
      }
      for (const r of facts.retakes.filter((r) => r.clip === clip.id)) {
        const start = boundary(r.attempt.start, words, r.attempt.start - 0.08, r.attempt.start + 0.03);
        const end = boundary(r.restart.start, words, r.restart.start - 0.08, r.restart.start + 0.015);
        if (start !== undefined && end !== undefined && start < end) remove.push({ start, end });
      }
    }
    const full = [{ start: 0, end: length }];
    let spans = subtract(full, remove).filter((s) => s.end - s.start >= 0.32);
    if (spans.reduce((sum, s) => sum + s.end - s.start, 0) < Math.min(MIN_DURATION, length)) spans = full;
    const shots = facts.shots.filter((s) => s.clip === clip.id);
    const sentences = facts.sentences.filter((s) => s.clip === clip.id);
    const levels = facts.loudness.find((l) => l.clip === clip.id)?.rms;
    for (const { start, end } of spans) {
      let cursor = start;
      while (cursor + 0.015 < end) {
        let next = end;
        const cadence = format.shotSeconds;
        if (settings.cuts && end - cursor > cadence * 1.35) {
          const ideal = cursor + cadence;
          const lo = cursor + cadence * 0.58;
          const hi = Math.min(end - Math.min(0.55, cadence / 3), cursor + cadence * 1.47);
          const landmarks = [...shots.slice(1).map((s) => s.start), ...sentences.map((s) => s.end + 0.055)]
            .filter((t) => t >= lo && t <= hi)
            .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
          next = boundary(landmarks[0] ?? ideal, words, lo, hi) ?? end;
        }
        const text = words
          .filter((w) => (w.start + w.end) / 2 >= cursor && (w.start + w.end) / 2 < next)
          .map((w) => w.text)
          .join(" ");
        const shot = shots.some((s) => s.cutScore !== null && Math.abs(s.start - cursor) < 0.15);
        const energy = levels?.db.slice(Math.floor(cursor / levels.step), Math.ceil(next / levels.step)) ?? [];
        const meanDb = energy.length ? energy.reduce((a, b) => a + b, 0) / energy.length : -90;
        const spoken = sentences.filter((s) => s.start < next - 0.02 && s.end > cursor + 0.02);
        beats.push({
          firstSentence: spoken[0]?.id,
          lastSentence: spoken.at(-1)?.id,
          id: `b${beats.length + 1}`,
          clip: clip.id,
          start: cursor,
          end: next,
          text,
          shot,
          score: strength(text) + (text ? 1 : 0) + (shot ? 0.7 : 0) + Math.max(0, (meanDb + 55) / 55),
        });
        cursor = next;
      }
    }
  }
  return beats;
}

export function localSelection(beats: Beat[], settings: Settings): Selection {
  const total = beats.reduce((sum, b) => sum + b.end - b.start, 0);
  if (total <= settings.target + 0.01) return { ids: beats.map((b) => b.id) };
  // Keep complete beats. A long speech with no safe internal boundary can still be
  // trimmed by buildEdit at a real word edge.
  if (!settings.cuts) return { ids: beats.map((b) => b.id) };
  const groups: Beat[][] = [];
  for (const b of beats) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && b.firstSentence && previous?.lastSentence === b.firstSentence && previous.clip === b.clip)
      group.push(b);
    else groups.push([b]);
  }
  const candidates = groups
    .map((items) => ({
      items,
      seconds: items.reduce((sum, b) => sum + b.end - b.start, 0),
      score: Math.max(...items.map((b) => b.score)) + strength(items.map((b) => b.text).join(" ")),
    }))
    .sort((a, b) => b.score - a.score);
  let remaining: number = settings.target;
  const chosen = new Set<string>();
  for (const group of candidates) {
    if (group.seconds > remaining + 0.001) continue;
    group.items.forEach((b) => chosen.add(b.id));
    remaining -= group.seconds;
  }
  // A single uninterrupted sentence can exceed the limit. Keep consecutive
  // beats of its strongest group; buildEdit ends the last one on a word edge.
  if (settings.target - remaining < MIN_DURATION && candidates[0]) {
    return {
      ids: candidates[0].items
        .map((b) => b.id)
        .concat(beats.filter((b) => !candidates[0]!.items.includes(b)).map((b) => b.id)),
    };
  }
  return { ids: beats.filter((b) => chosen.has(b.id)).map((b) => b.id) };
}

function shortTitle(text: string, fallback: string): string {
  const clean = (s: string) => {
    const firstClause = s.split(/[.!?…;,:]/u)[0] ?? "";
    const tokens = firstClause
      .replace(/[^\p{L}\p{N}\p{M}'’ -]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w && w.length <= 18);
    const leading = tokens.slice(0, 7);
    // End on a substantive word when a long spoken sentence needs shortening.
    while (
      leading.length &&
      (leading.join(" ").length > 46 ||
        /^(a|an|the|to|into|and|from|of|for|in|with|de|le|la|les|dans|pour|et|un|une)$/i.test(leading.at(-1)!))
    )
      leading.pop();
    return leading.join(" ");
  };
  return clean(text) || clean(fallback) || "Field notes";
}

export function buildEdit(
  title: string,
  language: string,
  facts: Analysis,
  beats: Beat[],
  selection: Selection,
  format: Format,
  settings: Settings,
): { edl: Edl; decisions: Decision[] } {
  const byId = new Map(beats.map((b) => [b.id, b]));
  const selected: Beat[] = [];
  let total = 0;
  for (const id of new Set(selection.ids)) {
    const beat = byId.get(id);
    if (!beat) throw new Error("The director selected a beat outside this footage.");
    const remaining = Math.min(MAX_DURATION, settings.target) - total;
    if (remaining < 0.3) break;
    let end = beat.end;
    if (beat.end - beat.start > remaining + 0.001) {
      end =
        boundary(
          beat.start + remaining,
          facts.words.filter((w) => w.clip === beat.clip),
          beat.start + 0.25,
          beat.start + remaining,
        ) ?? beat.start;
    }
    if (end <= beat.start + 0.1) continue;
    selected.push({ ...beat, end });
    total += end - beat.start;
  }
  if (total < MIN_DURATION - 0.01)
    throw new Error("The selected material is under five seconds. Choose longer footage or a longer cut.");
  const segments: ClipSegment[] = selected.map((b, i) => {
    const scale = settings.motion && i % 2 === 1 ? 1 + format.zoom : 1;
    return {
      id: `s${i + 1}`,
      type: "clip",
      clip: b.clip,
      in: b.start,
      out: b.end,
      framing: {
        scale,
        origin: { x: 0.5, y: 0.5 },
        ...(settings.motion ? { move: { toScale: ms(scale + format.zoom * 0.55), ease: "easeInOut" as const } } : {}),
      },
    };
  });
  const first = selected[0]!;
  const namedProject = /^[\p{L}][\p{L} ’'-]{3,45}$/u.test(title) && title.trim().split(/\s+/).length >= 2;
  const hook = shortTitle(selection.title ?? (namedProject ? title : first.text), title);
  const transitions: Edl["transitions"] = [];
  const sfx: Edl["audio"]["sfx"] = [];
  const accents =
    settings.sound && (!format.reference || (format.reference.lufs !== null && format.reference.lufs > -52));
  segments.slice(1).forEach((seg, i) => {
    const prev = segments[i]!;
    const duration = { cut: 0, flash: 0.13, zoom: 0.2, fade: 0.36 }[format.transition];
    if (settings.motion && duration > 0 && Math.min(seg.out - seg.in, prev.out - prev.in) > duration + 0.1) {
      transitions.push({ between: [prev.id, seg.id], type: format.transition, duration });
    }
    if (accents && (selected[i + 1]!.shot || i % 2 === 0)) {
      sfx.push({
        file: format.transition === "fade" ? "sfx/sweep.wav" : "sfx/pulse.wav",
        at: { segment: seg.id },
        gainDb: -15,
      });
    }
  });
  if (accents && sfx.length === 0) sfx.push({ file: "sfx/pulse.wav", at: { segment: segments[0]!.id }, gainDb: -18 });
  const keptWords = facts.words.filter((w) =>
    selected.some((b) => b.clip === w.clip && (w.start + w.end) / 2 >= b.start && (w.start + w.end) / 2 < b.end),
  );
  const emphasis = keptWords
    .filter((w) => strength(w.text) >= 2)
    .slice(0, 12)
    .map((w) => ({ word: w.id, style: "color" as const }));
  const music =
    settings.sound && format.musicDb !== null
      ? { file: "music/drift.m4a", gainDb: format.musicDb, duck: true, fadeOut: 0.8 }
      : undefined;
  const overlays: Edl["overlays"] = settings.motion
    ? [
        {
          id: "opening-title",
          component: "HookTitle",
          props: { text: hook },
          at: { segment: segments[0]!.id },
          duration: Math.min(2.2, total),
          layer: "front",
          zone: "top",
        },
      ]
    : [];
  // Illustrate a number only when the spoken word is retained and its card can
  // finish before the next event or the end of the reel.
  if (settings.motion) {
    let outputStart = 0;
    let available = 2.65;
    for (const beat of selected) {
      const words = keptWords.filter((w) => w.clip === beat.clip && w.start >= beat.start && w.start < beat.end);
      for (const w of words) {
        const at = outputStart + w.start - beat.start;
        if (at < available || at + 1.7 > total || overlays.length >= 4) continue;
        const number = /^([$€]?)(\d{1,5})([.,]\d{1,2})?(%|x|€)?[.!?,]?$/i.exec(w.text);
        if (!number) continue;
        const fraction = number[3]?.substring(1) ?? "";
        overlays.push({
          id: `figure-${overlays.length}`,
          component: "BigNumber",
          props: {
            value: Number(number[2] + "." + fraction),
            decimals: fraction.length,
            prefix: number[1] ?? "",
            suffix: number[4] ?? "",
          },
          at: { word: w.id },
          duration: 1.65,
          layer: "behind-captions",
          zone: "top",
        });
        available = at + 4.5;
      }
      outputStart += beat.end - beat.start;
    }
  }
  const sourceSeconds = facts.shots.reduce((sum, s) => sum + s.end - s.start, 0);
  const saved = Math.max(0, sourceSeconds - total);
  const reduction = saved > 0.08 ? ` Removed ${saved.toFixed(1)} seconds from the source.` : "";
  const decisions: Decision[] = [
    {
      title: "Picture edit",
      detail: `${segments.length} shot${segments.length === 1 ? "" : "s"} across ${total.toFixed(1)} seconds.${reduction} ${selection.reason ?? (settings.cuts ? "Cuts follow available shot changes and speech boundaries." : "Kept the original order up to the duration limit.")}`,
    },
    {
      title: "Motion",
      detail: settings.motion
        ? `Opened with “${hook}”. Applied ${Math.round(format.zoom * 100)}% alternating punch-ins and ${transitions.length} visible transition${transitions.length === 1 ? "" : "s"}.`
        : "Camera moves, graphic overlays and transitions are off.",
    },
    {
      title: "Subtitles",
      detail: settings.captions
        ? `${keptWords.length} timed words in groups of up to ${format.captionWords}.`
        : "Subtitles are off.",
    },
    {
      title: "Sound",
      detail: settings.sound
        ? `${sfx.length} timed sound accent${sfx.length === 1 ? "" : "s"}. ${music ? "The music ducks under the original audio." : "The original track carries the edit."}`
        : "Preserved the source audio and normalized its level.",
    },
  ];
  const edl: Edl = {
    version: 1,
    meta: {
      title,
      fps: 30,
      width: 1080,
      height: 1920,
      brand: "default",
      language: language === "und" || language === "auto" ? "en" : language,
    },
    segments,
    transitions,
    overlays,
    captions: {
      enabled: settings.captions,
      style: "bold",
      maxWordsPerPage: format.captionWords,
      position: "auto",
      emphasis,
      overrides: [],
      hide: [],
    },
    audio: { voice: { targetLufs: -14, denoise: false }, ...(music ? { music } : {}), sfx },
    notes: decisions.map((d) => d.title + " — " + d.detail).join("\n"),
  };
  return { edl, decisions };
}
