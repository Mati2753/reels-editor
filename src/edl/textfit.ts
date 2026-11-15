import type { FontSpec } from "../brand";
import { isClitic } from "./captions";
import type { TextMeasurer } from "./measure-core";

/**
 * Fitting a text into a box with the real font metrics: the largest font size, from
 * `maxSize` down to `minSize`, at which the words break into at most `maxLines` lines no
 * wider than `maxWidth` (and no taller than `maxHeight`). Used by the overlay layouts
 * (src/remotion/overlays/*), run by the resolver, so validate knows before rendering
 * whether a text fits, was shrunk, or overflows.
 */

export interface FitOptions {
  font: FontSpec;
  maxWidth: number;
  maxLines: number;
  maxSize: number;
  minSize: number;
  /** Line box height, multiple of the font size. */
  lineHeight: number;
  /** Total height allowed for the lines, px (each line counting `perLine` px more). */
  maxHeight?: number;
  /** Height added to every line for the maxHeight check (padding of a line box, gap), px. */
  perLine?: number;
  /** Letter spacing, em. */
  letterSpacing?: number;
  uppercase?: boolean;
  language: string;
  /** Width of a character as drawn, when it differs from its advance (tabular digits). */
  measureOverride?: (text: string, size: number) => number;
}

export interface FitResult {
  /** The text as drawn (case applied). */
  text: string;
  fontSize: number;
  lines: string[];
  lineWidths: number[];
  /** Widest line, px. */
  width: number;
  /** Lines times line height, px. */
  height: number;
  /** Set below `maxSize` to fit. */
  shrunk: boolean;
  /** Does not fit even at `minSize`: drawn at minSize, lines as wide as needed. */
  overflow: boolean;
}

/** Every way to cut n words into at most maxLines consecutive non-empty lines. */
function* splits(n: number, maxLines: number): Generator<number[]> {
  // Yields the index of the first word of every line after the first.
  const rec = function* (start: number, cuts: number[]): Generator<number[]> {
    if (cuts.length + 1 <= maxLines) yield cuts;
    if (cuts.length + 1 >= maxLines) return;
    for (let c = start + 1; c < n; c++) yield* rec(c, [...cuts, c]);
  };
  yield* rec(0, []);
}

export function fitText(raw: string, o: FitOptions, measure: TextMeasurer): FitResult {
  const text = (o.uppercase ? raw.toLocaleUpperCase(o.language) : raw).replace(/\s+/g, " ").trim();
  const words = text === "" ? [] : text.split(" ");
  const ls = o.letterSpacing ?? 0;
  const width = (t: string, size: number) => (o.measureOverride ? o.measureOverride(t, size) : measure(t, o.font, size, ls));
  const step = 2;
  for (let size = o.maxSize; size >= o.minSize - 1e-9; size -= step) {
    const s = Math.max(size, o.minSize);
    let best: { lines: string[]; widths: number[]; score: number[] } | null = null;
    for (const cuts of splits(words.length, o.maxLines)) {
      const bounds = [0, ...cuts, words.length];
      const lines: string[] = [];
      for (let k = 0; k + 1 < bounds.length; k++) lines.push(words.slice(bounds[k], bounds[k + 1]).join(" "));
      if (o.maxHeight !== undefined && lines.length * (s * o.lineHeight + (o.perLine ?? 0)) > o.maxHeight + 1e-6) continue;
      const widths = lines.map((l) => width(l, s));
      if (widths.some((w) => w > o.maxWidth + 1e-6)) continue;
      const cliticEnds = cuts.filter((c) => isClitic(words[c - 1] ?? "", o.language)).length;
      // Fewer lines, no line ending on an article or a preposition, then balanced lines.
      const score = [lines.length, cliticEnds, Math.round(Math.max(...widths))];
      if (!best || lexLess(score, best.score)) best = { lines, widths, score };
    }
    if (best) {
      return {
        text,
        fontSize: s,
        lines: best.lines,
        lineWidths: best.widths,
        width: Math.max(0, ...best.widths),
        height: best.lines.length * s * o.lineHeight,
        shrunk: s < o.maxSize,
        overflow: false,
      };
    }
    if (size <= o.minSize) break;
  }
  // Overflow: greedy lines at the smallest size, reported by validate.
  const s = o.minSize;
  const lines: string[] = [];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur !== undefined && width(`${cur} ${w}`, s) <= o.maxWidth) lines[lines.length - 1] = `${cur} ${w}`;
    else lines.push(w);
  }
  const lineWidths = lines.map((l) => width(l, s));
  return { text, fontSize: s, lines, lineWidths, width: Math.max(0, ...lineWidths), height: lines.length * s * o.lineHeight, shrunk: true, overflow: true };
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Word count of a text as the director's rule counts it (docs/DIRECTOR.md: 6 at most). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
