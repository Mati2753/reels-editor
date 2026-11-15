import opentype, { type Font } from "opentype.js";
import type { FontSpec } from "../brand";

/**
 * Width of a line of text in px: (text, font, font size px, letter spacing em). Pure; used
 * by the resolver to lay out captions and overlays with the real font metrics.
 */
export type TextMeasurer = (text: string, font: FontSpec, fontSize: number, letterSpacingEm: number) => number;

/**
 * A measurer over font files given as bytes (Node: read from assets/fonts/; browser: the
 * bundled files). Widths are the advance widths with kerning, as Chrome lays a line out.
 */
export function measurerFromFonts(read: (font: FontSpec) => ArrayBuffer): TextMeasurer {
  const cache = new Map<string, Font>();
  const load = (spec: FontSpec): Font => {
    let font = cache.get(spec.file);
    if (!font) {
      font = opentype.parse(read(spec));
      cache.set(spec.file, font);
    }
    return font;
  };
  return (text, font, fontSize, letterSpacingEm) => load(font).getAdvanceWidth(text, fontSize, { kerning: true }) + letterSpacingEm * fontSize * [...text].length;
}
