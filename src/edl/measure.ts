import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import opentype, { type Font } from "opentype.js";
import type { FontSpec } from "../brand";

/**
 * Text measurement for caption layout, from the font file itself (the one the renderer
 * loads), so line breaks and safe-zone checks are decided before rendering.
 */
export type TextMeasurer = (text: string, font: FontSpec, fontSize: number, letterSpacingEm: number) => number;

const FONTS_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
const cache = new Map<string, Font>();

function load(file: string): Font {
  let font = cache.get(file);
  if (!font) {
    const buf = readFileSync(new URL(file, `file://${FONTS_DIR}`));
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    cache.set(file, font);
  }
  return font;
}

/** Advance width in px with kerning, as Chrome lays the text out on one line. */
export const measureText: TextMeasurer = (text, font, fontSize, letterSpacingEm) => {
  const f = load(font.file);
  return f.getAdvanceWidth(text, fontSize, { kerning: true }) + letterSpacingEm * fontSize * [...text].length;
};
