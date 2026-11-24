import { ms } from "../../edl/time";
import type { Filler, Retake, Sentence, Silence, Sound } from "../schemas";
import { normalizeWord } from "../words";
import { subtract, type Interval } from "./intervals";

/** A word of one clip with its (refined) bounds. Lists are in time order. */
export interface SpeechWord {
  id: string;
  clip: string;
  text: string;
  start: number;
  end: number;
}

// ------------------------------------------------------------------------ sentences

const SENTENCE_END = /(\.|!|\?|…)["»”)]*$/u;

/**
 * Groups words into sentences: a sentence ends on a word ending with . ! ? … (Whisper's
 * punctuation), on a pause of at least `gap` seconds, or at the end of a clip.
 */
export function groupSentences(words: readonly SpeechWord[], gap: number): Sentence[] {
  const sentences: Sentence[] = [];
  let current: SpeechWord[] = [];
  const flush = (): void => {
    const first = current[0];
    const last = current[current.length - 1];
    if (first && last) {
      sentences.push({
        id: `s${sentences.length + 1}`,
        clip: first.clip,
        start: first.start,
        end: last.end,
        from: first.id,
        to: last.id,
        text: current.map((w) => w.text).join(" "),
        wordCount: current.length,
      });
    }
    current = [];
  };
  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    if (!next || next.clip !== w.clip || SENTENCE_END.test(w.text) || next.start - w.end >= gap) flush();
  });
  return sentences;
}

// ------------------------------------------------------------------------ fillers

/** Words and phrases that a montage may remove. Facts: the director decides. */
const HESITATIONS = new Set(["euh", "euhh", "heu", "e", "eh", "hum", "hmm", "mmh", "mh"]);
const DISCOURSE: readonly string[][] = [["du", "coup"], ["en", "fait"], ["voilà"], ["bah"], ["ben"]];
/** Pronoun pairs that are correct French, not stutters ("nous nous sommes"). */
const LEGIT_DOUBLES = new Set(["nous", "vous"]);

export interface RepeatSpan {
  /** Index of the first word of the first occurrence. */
  index: number;
  /** Length of the repeated group. */
  size: number;
}

/** Immediate repetitions: words[k..k+n) == words[k+n..k+2n), n = 1..3, within one clip. */
export function findImmediateRepetitions(norm: readonly string[], clips: readonly string[]): RepeatSpan[] {
  const out: RepeatSpan[] = [];
  let k = 0;
  while (k < norm.length) {
    let found = 0;
    for (let n = 1; n <= 3 && k + 2 * n <= norm.length; n++) {
      let same = true;
      for (let j = 0; j < n; j++) {
        if (norm[k + j] !== norm[k + n + j] || norm[k + j] === "" || clips[k + j] !== clips[k + n + j] || clips[k] !== clips[k + j]) {
          same = false;
          break;
        }
      }
      if (same && !(n === 1 && LEGIT_DOUBLES.has(norm[k] ?? ""))) {
        found = n;
        break;
      }
    }
    if (found > 0) {
      out.push({ index: k, size: found });
      k += found;
    } else {
      k += 1;
    }
  }
  return out;
}

export function detectFillers(words: readonly SpeechWord[], excluded: ReadonlySet<string> = new Set()): Filler[] {
  const norm = words.map((w) => normalizeWord(w.text));
  const clips = words.map((w) => w.clip);
  const fillers: Omit<Filler, "id">[] = [];
  const make = (from: number, size: number, kind: Filler["kind"]): Omit<Filler, "id"> => {
    const span = words.slice(from, from + size);
    const first = span[0];
    const last = span[span.length - 1];
    if (!first || !last) throw new Error("empty filler span");
    return { clip: first.clip, start: first.start, end: last.end, kind, text: span.map((w) => w.text).join(" "), words: span.map((w) => w.id) };
  };

  for (let i = 0; i < words.length; i++) {
    if (HESITATIONS.has(norm[i] ?? "")) {
      fillers.push(make(i, 1, "hesitation"));
      continue;
    }
    for (const phrase of DISCOURSE) {
      if (phrase.every((p, j) => norm[i + j] === p && clips[i + j] === clips[i])) {
        fillers.push(make(i, phrase.length, "discourse"));
        break;
      }
    }
  }
  for (const rep of findImmediateRepetitions(norm, clips)) {
    const ids = words.slice(rep.index, rep.index + rep.size).map((w) => w.id);
    if (ids.some((id) => excluded.has(id))) continue;
    fillers.push(make(rep.index, rep.size, "repetition"));
  }
  return fillers
    .sort((a, b) => (a.clip === b.clip ? a.start - b.start : a.clip < b.clip ? -1 : 1))
    .map((f, i) => ({ id: `f${i + 1}`, ...f }));
}

// ------------------------------------------------------------------------ retakes

export interface RetakeOptions {
  /** Longest time between the start of the attempt and the restart, seconds. */
  window: number;
  /** A pause at least this long marks a possible restart point, seconds. */
  pause: number;
  /** Identical words the two attempts must start with. */
  minMatch: number;
  /** Most words the attempt may have beyond the matched ones (an abandoned attempt is short). */
  maxExtra: number;
}

export const DEFAULT_RETAKE: RetakeOptions = { window: 10, pause: 0.3, minMatch: 2, maxExtra: 4 };

/**
 * Restarted sentences. A restart point is a sentence start or a word after a pause. When
 * the words from restart point j repeat, for at least `minMatch` words, the words from an
 * earlier restart point i of the same clip (less than `window` seconds before), the span
 * i..j-1 is an abandoned attempt. The nearest i wins.
 */
export function detectRetakes(words: readonly SpeechWord[], sentences: readonly Sentence[], options: RetakeOptions = DEFAULT_RETAKE): Retake[] {
  const norm = words.map((w) => normalizeWord(w.text));
  const sentenceStarts = new Set(sentences.map((s) => s.from));
  const isBoundary = (k: number): boolean => {
    const w = words[k];
    const prev = words[k - 1];
    if (!w) return false;
    return !prev || prev.clip !== w.clip || sentenceStarts.has(w.id) || w.start - prev.end >= options.pause;
  };
  const boundaries = words.map((_, k) => k).filter(isBoundary);
  const retakes: Retake[] = [];
  let lastRestart = -1;
  for (const j of boundaries) {
    const wj = words[j];
    if (!wj) continue;
    for (let b = boundaries.indexOf(j) - 1; b >= 0; b--) {
      const i = boundaries[b] ?? 0;
      const wi = words[i];
      if (!wi || wi.clip !== wj.clip || wj.start - wi.start > options.window) break;
      if (i < lastRestart) break; // do not reach across an earlier restart
      let run = 0;
      while (i + run < j && j + run < words.length && norm[i + run] !== "" && norm[i + run] === norm[j + run] && words[j + run]?.clip === wj.clip) run++;
      const extra = j - i - run;
      if (run >= options.minMatch && extra <= options.maxExtra) {
        const last = words[j - 1];
        if (!last) break;
        retakes.push({
          id: `r${retakes.length + 1}`,
          clip: wj.clip,
          attempt: { from: wi.id, to: last.id, start: wi.start, end: last.end, text: words.slice(i, j).map((w) => w.text).join(" ") },
          restart: { from: wj.id, start: wj.start },
          matchedWords: run,
        });
        lastRestart = j;
        break;
      }
    }
  }
  return retakes;
}

// ------------------------------------------------------------------------ silences and sounds

/**
 * Crosses the audio with the words. `silent` are the intervals where the audio is below
 * the silence threshold (silencedetect). A silence is a silent interval that no word
 * overlaps, of at least `minSilence`; a sound is a non-silent interval that no word
 * overlaps (clap, breath, untranscribed hesitation, music), of at least `minSound`.
 */
export function crossAudioWithWords(
  clip: string,
  duration: number,
  silent: readonly Interval[],
  words: readonly SpeechWord[],
  levels10ms: readonly number[],
  minSilence: number,
  minSound: number,
): { silences: Omit<Silence, "id">[]; sounds: Omit<Sound, "id">[] } {
  const spans = words.map((w) => ({ start: w.start, end: w.end }));
  const neighbours = (iv: Interval): { after: string | null; before: string | null } => {
    let after: string | null = null;
    let before: string | null = null;
    for (const w of words) {
      if (w.end <= iv.start + 1e-6) after = w.id;
      if (before === null && w.start >= iv.end - 1e-6) before = w.id;
    }
    return { after, before };
  };
  const silences = subtract(silent, spans)
    .filter((iv) => iv.end - iv.start >= minSilence)
    .map((iv) => ({ clip, start: ms(iv.start), end: ms(iv.end), duration: ms(iv.end - iv.start), ...neighbours(iv) }));

  const noisy = subtract(subtract([{ start: 0, end: duration }], silent), spans);
  const sounds = noisy
    .filter((iv) => iv.end - iv.start >= minSound)
    .map((iv) => {
      let peak = -Infinity;
      for (let f = Math.floor(iv.start / 0.01); f < Math.ceil(iv.end / 0.01) && f < levels10ms.length; f++) peak = Math.max(peak, levels10ms[f] ?? -Infinity);
      const touches = (t: number): boolean => spans.some((w) => Math.abs(w.start - t) < 1e-6 || Math.abs(w.end - t) < 1e-6);
      return {
        clip,
        start: ms(iv.start),
        end: ms(iv.end),
        duration: ms(iv.end - iv.start),
        peakDb: Number.isFinite(peak) ? Math.round(peak * 10) / 10 : -90,
        isolated: !touches(iv.start) && !touches(iv.end),
      };
    });
  return { silences, sounds };
}
