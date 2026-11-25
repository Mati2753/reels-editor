import { z } from "zod";
import { median } from "../studio/format-model";
const unit = z.number().min(0).max(1);
export const TextSampleSchema = z.object({
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
  return {
    center: median(band.map((t) => t.y + t.height / 2)),
    height: median(band.map((t) => t.height)),
    words: median(band.map((t) => t.text.split(/\s+/).length)),
    confidence: median(band.map((t) => t.confidence)),
    samples: new Set(band.map((t) => t.at)).size,
  };
}
