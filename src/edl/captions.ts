import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import type { BrandKit } from "../brand";
import type { CaptionStyle } from "../remotion/captions/styles";
import type { TextMeasurer } from "./measure";

/**
 * Caption pages: grouping of the kept words into pages and layout of each page in lines.
 * Called by resolve.ts only; times here are seconds of output.
 */

export interface CaptionWord {
  word: string;
  /** Displayed text: override applied, case and punctuation as the style wants. */
  text: string;
  /** Text used to find sentence and clause ends (override applied, punctuation kept). */
  source: string;
  start: number;
  end: number;
  emphasis?: "color" | "scale" | "box";
}

/**
 * Words that must not end a page or a line: they belong with the word after them
 * (articles, determiners, prepositions, subject pronouns, conjunctions), and numbers,
 * which belong with their unit (docs/DIRECTOR.md, Sous-titres).
 */
const CLITICS: Record<string, ReadonlySet<string>> = {
  fr: new Set(
    (
      "le la les l' un une des du de d' au aux à mon ton son ma ta sa mes tes ses notre votre nos vos leur leurs " +
      "ce cet cette ces et ou mais donc ni car je j' tu il elle on nous vous ils elles ne n' se s' me m' te t' qu' que qui " +
      "en y pour par avec dans sur sans sous vers chez entre très plus moins si comme"
    ).split(" "),
  ),
  en: new Set("the a an of to in on at for with and or but my your his her our their this that these those i you he she we they very".split(" ")),
};

function bare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

export function isClitic(text: string, language: string): boolean {
  const w = bare(text);
  if (/^\d[\d\s.,]*$/.test(w)) return true;
  if (/[.,;:!?…]$/.test(text.trim())) return false;
  const set = CLITICS[language.slice(0, 2)];
  if (!set) return false;
  if (set.has(w)) return true;
  // Elided forms written with the next word cut off ("l'", "d'") are covered above; a word
  // ending in an apostrophe is always elided.
  return w.endsWith("'");
}

export function endsSentence(text: string): boolean {
  return /[.!?…]["»”)]*$/.test(text.trim());
}

export function endsClause(text: string): boolean {
  return /[,;:]["»”)]*$/.test(text.trim());
}

/** Displayed form of a word for a style: case, trailing punctuation. */
export function displayText(text: string, style: CaptionStyle, language: string): string {
  let t = text.trim();
  if (style.stripPunctuation) {
    const stripped = t.replace(/(\.\.\.|[.,;:…])+$/u, "");
    if (stripped !== "") t = stripped;
  }
  return style.uppercase ? t.toLocaleUpperCase(language) : t;
}

export interface PageLayout {
  fontSize: number;
  /** Token indexes per line. */
  lines: number[][];
  /** Advance width of each token at fontSize, emphasis included. */
  widths: number[];
  lineWidths: number[];
  /** True when even the smallest font size could not fit the page inside maxWidth. */
  overflow: boolean;
}

export interface LayoutEnv {
  style: CaptionStyle;
  brand: BrandKit;
  measure: TextMeasurer;
  language: string;
  /** Widest line allowed, px, outline and active-word growth excluded. */
  maxWidth: number;
}

/** Every way to cut n tokens into at most maxLines consecutive non-empty lines. */
function splits(n: number, maxLines: number): number[][][] {
  const out: number[][][] = [];
  const rec = (start: number, lines: number[][]): void => {
    if (start === n) {
      out.push(lines);
      return;
    }
    if (lines.length === maxLines) return;
    for (let end = start + 1; end <= n; end++) {
      rec(end, [...lines, Array.from({ length: end - start }, (_, i) => start + i)]);
    }
  };
  rec(0, []);
  return out;
}

function tokenWidth(t: CaptionWord, fontSize: number, env: LayoutEnv): number {
  const { style, brand, measure } = env;
  const size = t.emphasis === "scale" ? fontSize * style.emphasisScale : fontSize;
  let w = measure(t.text, brand.fonts.caption, size, style.letterSpacing);
  if (t.emphasis === "box") w += 2 * style.boxPadding.x * fontSize;
  return w;
}

/** Growth of the widest token when it is the active word (it is scaled around its centre). */
export function activeGrowth(widths: readonly number[], style: CaptionStyle): number {
  return (style.activeScale - 1) * Math.max(0, ...widths);
}

/**
 * Lays one page out at the style's font size, or smaller (down to minFontSize) when a
 * single word is too wide. Prefers fewer lines, then lines that do not end on a clitic,
 * then the most balanced lines. Returns null when the tokens do not fit at the style's
 * font size and `allowShrink` is false (used to decide page breaks).
 */
export function layoutPage(tokens: readonly CaptionWord[], env: LayoutEnv, allowShrink: boolean): PageLayout | null {
  const { style, measure, brand, language } = env;
  for (let fontSize = style.fontSize; fontSize >= style.minFontSize; fontSize -= 2) {
    const widths = tokens.map((t) => tokenWidth(t, fontSize, env));
    const space = measure(" ", brand.fonts.caption, fontSize, style.letterSpacing) + style.wordSpacing * fontSize;
    const growth = activeGrowth(widths, style);
    let best: { lines: number[][]; lineWidths: number[]; score: number[] } | null = null;
    for (const lines of splits(tokens.length, style.maxLines)) {
      const lineWidths = lines.map((l) => l.reduce((s, i) => s + (widths[i] ?? 0), 0) + space * (l.length - 1));
      const chars = lines.map((l) => l.map((i) => tokens[i]?.text ?? "").join(" ").length);
      const fits = lineWidths.every((w) => w + growth <= env.maxWidth) && lines.every((l, k) => l.length === 1 || (chars[k] ?? 0) <= style.maxCharsPerLine);
      if (!fits) continue;
      const cliticEnds = lines.slice(0, -1).filter((l) => isClitic(tokens[l[l.length - 1] ?? 0]?.source ?? "", language)).length;
      const score = [lines.length, cliticEnds, Math.max(...lineWidths)];
      if (!best || lexLess(score, best.score)) best = { lines, lineWidths, score };
    }
    if (best) return { fontSize, lines: best.lines, widths, lineWidths: best.lineWidths, overflow: false };
    if (!allowShrink) return null;
  }
  // Does not fit even at the smallest size: one token per line, flagged for validate.
  const fontSize = style.minFontSize;
  const widths = tokens.map((t) => tokenWidth(t, fontSize, env));
  const lines = tokens.map((_, i) => [i]);
  return { fontSize, lines, widths, lineWidths: lines.map((l) => widths[l[0] ?? 0] ?? 0), overflow: true };
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export interface PageBreakOptions {
  maxWords: number;
  /** A pause at least this long (seconds of output) starts a new page. */
  gap: number;
  language: string;
  /** Output times (seconds) at which a page must break: hidden spans. */
  barriers: readonly number[];
  /** Whether a run of tokens fits on one page without shrinking. */
  fits: (tokens: readonly CaptionWord[]) => boolean;
}

/**
 * Groups the kept words into pages: at most maxWords per page, a new page after a sentence
 * or clause end (punctuation), after a pause, across a hidden span,
 * and when the next word would not fit. A page never ends on a clitic when the clitic can
 * move to the next page. The grouping itself is done by @remotion/captions from the page
 * breaks decided here.
 */
export function breakPages(tokens: readonly CaptionWord[], o: PageBreakOptions): CaptionWord[][] {
  const breakAfter = new Set<number>();
  let page: number[] = [];
  const crossesBarrier = (a: CaptionWord, b: CaptionWord) => o.barriers.some((t) => a.start < t && b.start >= t);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (page.length > 0) {
      const prevIndex = page[page.length - 1]!;
      const prev = tokens[prevIndex]!;
      const hard = t.start - prev.end >= o.gap || endsSentence(prev.source) || endsClause(prev.source) || crossesBarrier(prev, t);
      const full = page.length >= o.maxWords || !o.fits([...page, i].map((k) => tokens[k]!));
      if (hard) {
        breakAfter.add(prevIndex);
        page = [];
      } else if (full) {
        // Move trailing clitics to the next page, keeping at least one word on this one.
        let cut = page.length;
        while (cut > 1 && isClitic(tokens[page[cut - 1]!]!.source, o.language)) cut--;
        breakAfter.add(page[cut - 1]!);
        page = page.slice(cut);
      }
    }
    page.push(i);
  }

  const captions: Caption[] = tokens.map((t, i) => ({
    text: ` ${t.word}`,
    startMs: t.start * 1000,
    endMs: t.end * 1000,
    timestampMs: null,
    confidence: null,
    pageBreakAfter: breakAfter.has(i),
  }));
  const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: Number.MAX_SAFE_INTEGER });
  const out: CaptionWord[][] = [];
  let k = 0;
  for (const p of pages) {
    out.push(p.tokens.map(() => tokens[k++]!));
  }
  if (k !== tokens.length) throw new Error(`caption grouping lost words (${k} of ${tokens.length})`);
  return out;
}
