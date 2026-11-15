/**
 * Caption styles: sizes, spacing, positions and timing of the captions. Colours and fonts
 * come from the brand kit. Pure data, shared by the resolver (which lays the pages out
 * with the font metrics) and by the CaptionTrack component (which draws them).
 */

export interface CaptionStyle {
  name: string;
  /** Font size in px of the 1080x1920 frame (docs/DIRECTOR.md: 60 to 80). */
  fontSize: number;
  /** Smallest size a page may be shrunk to when a single word does not fit the width. */
  minFontSize: number;
  /** Line box height, multiple of the font size. */
  lineHeight: number;
  /** Extra spacing between letters, em. */
  letterSpacing: number;
  /** Extra spacing between words, em (the outline eats into the plain space). */
  wordSpacing: number;
  uppercase: boolean;
  /** Drop trailing periods, commas, colons and ellipses ("?" and "!" stay). */
  stripPunctuation: boolean;
  /** Outline drawn outside the glyphs, px. */
  outlineWidth: number;
  /** Drop shadow blur, px (colour: brand outline). */
  shadowBlur: number;
  maxLines: number;
  /** About 18 characters per line (docs/DIRECTOR.md). */
  maxCharsPerLine: number;
  /** Scale of the word being spoken. */
  activeScale: number;
  /** Font size multiple of a word with emphasis "scale". */
  emphasisScale: number;
  /** Padding of the emphasis "box" around its word, em. */
  boxPadding: { x: number; y: number };
  /** Vertical centre of the caption block for each position, px from the top. */
  positions: { center: number; "lower-third": number };
  /** A page stays on screen this long after its last word ends (unless the next page starts). */
  lingerSeconds: number;
  /** A pause at least this long between two kept words starts a new page. */
  pageBreakGapSeconds: number;
  /** Duration of the page entrance, frames: the page grows from enterScale to 1. */
  enterFrames: number;
  enterScale: number;
}

export const boldStyle: CaptionStyle = {
  name: "bold",
  fontSize: 72,
  minFontSize: 52,
  lineHeight: 1.18,
  letterSpacing: 0,
  wordSpacing: 0.12,
  uppercase: true,
  stripPunctuation: true,
  outlineWidth: 10,
  shadowBlur: 18,
  maxLines: 2,
  maxCharsPerLine: 18,
  activeScale: 1.08,
  emphasisScale: 1.22,
  boxPadding: { x: 0.18, y: 0.06 },
  positions: { center: 960, "lower-third": 1300 },
  lingerSeconds: 0.4,
  pageBreakGapSeconds: 0.45,
  enterFrames: 3,
  enterScale: 0.86,
};

export const captionStyles: Readonly<Record<string, CaptionStyle>> = {
  bold: boldStyle,
};
