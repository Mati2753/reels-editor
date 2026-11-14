import { ms } from "../project";

export interface Bounds {
  start: number;
  end: number;
}

export interface EnergyTrack {
  /** Level of each frame, dBFS. */
  levels: readonly number[];
  /** Frame length, seconds. */
  step: number;
  /** A frame at or below this level is silent. */
  thresholdDb: number;
}

export interface RefineOptions {
  /** How far a bound inside sound may move back/forward to the edge of that sound, seconds. */
  maxShift: number;
  /** Sound shorter than this is ignored (clicks), seconds. */
  minSound: number;
  /** Silence shorter than this does not split a sound (stop consonants, dips), seconds. */
  bridge: number;
  /** Shortest word kept after refining, seconds; below that the bounds stay as they were. */
  minWordDuration: number;
}

export const DEFAULT_REFINE: RefineOptions = { maxShift: 0.5, minSound: 0.02, bridge: 0.1, minWordDuration: 0.04 };

export interface Region {
  start: number;
  end: number;
}

/**
 * Continuous sounding regions of an energy track: frames above the threshold, with runs
 * shorter than `minSound` dropped and silences shorter than `bridge` filled.
 */
export function soundRegions(energy: EnergyTrack, options: Pick<RefineOptions, "minSound" | "bridge">): Region[] {
  const { levels, step, thresholdDb } = energy;
  const raw: { a: number; b: number }[] = [];
  let open = -1;
  for (let f = 0; f <= levels.length; f++) {
    const on = f < levels.length && (levels[f] ?? -Infinity) > thresholdDb;
    if (on && open < 0) open = f;
    if (!on && open >= 0) {
      if ((f - open) * step >= options.minSound - 1e-9) raw.push({ a: open, b: f });
      open = -1;
    }
  }
  const merged: { a: number; b: number }[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && (r.a - last.b) * step < options.bridge) last.b = r.b;
    else merged.push({ ...r });
  }
  return merged.map((r) => ({ start: ms(r.a * step), end: ms(r.b * step) }));
}

/**
 * Moves word bounds onto the audio energy where a word touches a pause.
 *
 * Whisper places words on a 20 ms grid and drifts in long silences: a word after a pause
 * often "starts" inside the silence, a word before a pause often ends early or late.
 * Per bound (a bound between two words of continuous speech has no silence nearby and is
 * left alone):
 *  - start in silence: move it to the onset of the last sound that begins inside the word
 *    (a clap or breath before the word is skipped);
 *  - start in sound: if that sound began less than `maxShift` earlier and after the
 *    previous word, move it back to the onset;
 *  - end in silence: move it to the end of the last sound that ends inside the word;
 *  - end in sound: if that sound stops less than `maxShift` later and before the next
 *    word, move it forward to that point.
 * Measured facts only: nothing moves where the audio shows no silence edge.
 */
export function refineWordBounds(words: readonly Bounds[], energy: EnergyTrack, options: RefineOptions = DEFAULT_REFINE): Bounds[] {
  const regions = soundRegions(energy, options);
  const containing = (t: number): Region | undefined => regions.find((r) => r.start <= t && t < r.end);
  const eps = 1e-6;

  return words.map((w, i) => {
    const prevEnd = i > 0 ? (words[i - 1]?.end ?? 0) : 0;
    const nextStart = i + 1 < words.length ? (words[i + 1]?.start ?? Infinity) : Infinity;
    let start = w.start;
    let end = w.end;

    const rs = containing(w.start);
    if (rs) {
      if (w.start - rs.start <= options.maxShift && rs.start >= prevEnd - eps) start = rs.start;
    } else {
      const inside = regions.filter((r) => r.start > w.start && r.start < w.end);
      const last = inside[inside.length - 1];
      if (last) start = last.start;
    }

    const re = containing(w.end - eps);
    if (re) {
      if (re.end - w.end <= options.maxShift && re.end <= nextStart + eps) end = re.end;
    } else {
      const inside = regions.filter((r) => r.end > start && r.end < w.end);
      const last = inside[inside.length - 1];
      if (last) end = last.end;
    }

    if (end - start < options.minWordDuration) {
      return { start: w.start, end: w.end };
    }
    return { start: ms(start), end: ms(end) };
  });
}
