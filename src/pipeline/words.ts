import { ms } from "../edl/time";

/** A word as the Whisper engine returns it, before merging and ids. */
export interface EngineWord {
  text: string;
  start: number;
  end: number;
  probability: number;
}

export interface MergedWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

const ONLY_PUNCTUATION = /^[\p{P}\s]+$/u;

/**
 * Turns engine words into display words.
 *
 * Whisper marks the beginning of a word with a leading space. faster-whisper still cuts
 * French elisions and hyphenated pronouns into pieces ("aujourd" + "'hui", "Mettez" +
 * "-vous"); a piece without a leading space is glued to the word before it, so the
 * director anchors on "aujourd'hui" as a single word. Pure punctuation is attached to the
 * previous word without changing its timing. Confidence of a merged word is the lowest
 * of its pieces.
 */
export function mergeEngineWords(words: readonly EngineWord[]): MergedWord[] {
  const out: MergedWord[] = [];
  for (const w of words) {
    const text = w.text.trim();
    if (text === "") continue;
    const prev = out[out.length - 1];
    const startsWord = /^\s/.test(w.text);
    if (prev && ONLY_PUNCTUATION.test(text)) {
      prev.text += text;
      continue;
    }
    if (prev && !startsWord) {
      prev.text += text;
      prev.end = Math.max(prev.end, w.end);
      prev.confidence = Math.min(prev.confidence, w.probability);
      continue;
    }
    if (ONLY_PUNCTUATION.test(text)) continue; // leading punctuation with no word before it
    out.push({ text, start: w.start, end: Math.max(w.start, w.end), confidence: w.probability });
  }
  return out.map((w) => ({ ...w, start: ms(w.start), end: ms(w.end), confidence: Math.round(w.confidence * 1000) / 1000 }));
}

/** Lowercase, without surrounding punctuation; apostrophes unified. Used to compare words. */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Word id: clip id, then the word's 1-based rank in that clip ("c1-w12"). */
export function wordId(clip: string, rank: number): string {
  return `${clip}-w${rank}`;
}

/**
 * Gives the words of one clip their ids. Numbering restarts in every clip so that
 * re-transcribing a clip only changes the ids of that clip: the director's anchors on
 * the other clips stay valid.
 */
export function clipWords<T extends MergedWord>(clip: string, words: readonly T[]): (T & { id: string; clip: string })[] {
  return words.map((w, i) => ({ ...w, id: wordId(clip, i + 1), clip }));
}
