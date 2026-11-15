import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FontSpec } from "../brand";
import { measurerFromFonts, type TextMeasurer } from "./measure-core";

/**
 * Text measurement for layout (captions, overlays), from the font files themselves (the
 * ones the renderer loads), so line breaks and safe-zone checks are decided before
 * rendering. Node side: the files are read from assets/fonts/. The browser side (gallery
 * of the Studio) builds the same measurer from the bundled files (src/remotion/fonts.ts).
 */
export type { TextMeasurer } from "./measure-core";

const FONTS_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

function readFont(font: FontSpec): ArrayBuffer {
  const buf = readFileSync(new URL(font.file, `file://${FONTS_DIR}`));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Advance width in px with kerning, as Chrome lays the text out on one line. */
export const measureText: TextMeasurer = measurerFromFonts(readFont);
