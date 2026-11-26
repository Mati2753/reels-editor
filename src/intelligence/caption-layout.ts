import { z } from "zod";
import { median } from "../studio/format-model";
const unit = z.number().min(0).max(1);
export const TextSampleSchema = z.object({
  ink: z
    .string()
    .regex(/^#[a-f0-9]{6}$/i)
    .nullish(),
  at: z.number().nonnegative(),
  text: z.string().min(1),
  confidence: unit,
  x: unit,
  y: unit,
  width: unit,
  height: unit,
});
export type TextSample = z.infer<typeof TextSampleSchema>;
export function inferCaptionLayout(samples: TextSample[]) {
  // Changing text in a consistent band provides stronger caption evidence than a static logo.
  const lines = z
    .array(TextSampleSchema)
    .parse(samples)
    .filter(
      (s) =>
        s.confidence >= 0.75 &&
        s.y + s.height / 2 >= 0.36 &&
        s.height >= 0.015 &&
        s.height <= 0.14 &&
        Math.abs(s.x + s.width / 2 - 0.5) < 0.19 &&
        s.text.trim().split(/\s+/).length >= 2,
    );
  const bands = lines
    .map((s) => lines.filter((t) => Math.abs(t.y + t.height / 2 - s.y - s.height / 2) < 0.055))
    .sort((a, b) => new Set(b.map((t) => t.at)).size - new Set(a.map((t) => t.at)).size);
  const band = bands[0];
  if (!band || new Set(band.map((t) => t.at)).size < 2 || new Set(band.map((t) => t.text.toLowerCase())).size < 2)
    return null;
  const inks = band.flatMap((l) => (l.ink ? [l.ink.toLowerCase()] : []));
  const best = inks.sort((a, b) => inks.filter((k) => k === b).length - inks.filter((k) => k === a).length)[0];
  const letters = band
    .map((l) => l.text.replace(/[^\p{L}]/gu, ""))
    .filter((t) => t.length >= 3 && t.toLowerCase() !== t.toUpperCase());
  return {
    ink: best && inks.filter((k) => k === best).length >= band.length * 0.65 ? best : null,
    uppercase: letters.length >= 2 && letters.every((t) => t === t.toUpperCase()),
    center: median(band.map((t) => t.y + t.height / 2)),
    height: median(band.map((t) => t.height)),
    words: median(band.map((t) => t.text.split(/\s+/).length)),
    confidence: median(band.map((t) => t.confidence)),
    samples: new Set(band.map((t) => t.at)).size,
  };
}

// Require a consistent surround and a recurring, visibly distinct interior color.
// Text on busy footage can leave the ink estimate unknown.
export function estimateInk(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  box: { x0: number; y0: number; x1: number; y1: number },
) {
  const { x0, x1, y0, y1 } = box;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const ring: number[][] = [];
  const outer = Math.max(2, Math.round((y1 - y0) * 0.18));
  for (let y = Math.max(0, y0 - outer); y < Math.min(h, y1 + outer); y += 2)
    for (let x = Math.max(0, x0 - outer); x < Math.min(w, x1 + outer); x += 2) {
      const i = (y * w + x) * 4,
        r = pixels[i]!,
        g = pixels[i + 1]!,
        b = pixels[i + 2]!;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) {
        ring.push([r, g, b]);
        continue;
      }
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4),
        bin = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      buckets.set(key, bin);
    }
  if (ring.length < 8) return null;
  const bg = [0, 1, 2].map((i) => median(ring.map((rgb) => rgb[i]!)));
  if (ring.filter((c) => Math.hypot(c[0]! - bg[0]!, c[1]! - bg[1]!, c[2]! - bg[2]!) < 48).length < ring.length * 0.75)
    return null;
  const area = ((x1 - x0) * (y1 - y0)) / 4;
  const ink = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .find(
      (v) =>
        v.count > area * 0.1 && Math.hypot(v.r / v.count - bg[0]!, v.g / v.count - bg[1]!, v.b / v.count - bg[2]!) > 95,
    );
  return ink
    ? "#" +
        [ink.r, ink.g, ink.b]
          .map((sum) =>
            Math.round(sum / ink.count)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
    : null;
}
