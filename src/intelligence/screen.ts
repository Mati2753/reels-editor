import { z } from "zod";
export const ScreenPlanSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  centers: z.array(
    z.object({ at: z.number().nonnegative(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  ),
  confidence: z.number().min(0).max(1),
});
export type ScreenPlan = z.infer<typeof ScreenPlanSchema>;
const mid = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
export function trackScreen(
  data: Uint8Array,
  width: number,
  height: number,
  rate: number,
  background: string,
): ScreenPlan | null {
  const stride = width * height * 3;
  if (
    width < 8 ||
    height < 8 ||
    rate <= 0 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(data.length / stride) ||
    !/^#[0-9a-f]{6}$/i.test(background)
  )
    throw Error("Invalid screen tracking input.");
  const samples: number[][] = [];
  const centers: ScreenPlan["centers"] = [];
  const votes: number[] = [];
  let dominant: number | undefined;
  for (let frame = 0; frame < data.length / stride; frame++) {
    const origin = frame * stride;
    const edges: number[][] = [];
    for (let y = 1; y < height - 1; y += 2)
      for (const x of [0, 1, width - 2, width - 1]) {
        const i = origin + (y * width + x) * 3;
        edges.push([data[i]!, data[i + 1]!, data[i + 2]!]);
      }
    const color = [0, 1, 2].map((c) => mid(edges.map((p) => p[c]!)));
    const channel = color[1]! > color[2]! ? 1 : 2;
    if (color[channel]! - Math.max(color[0]!, color[3 - channel]!) < 55) continue;
    if (dominant !== undefined && channel !== dominant) continue;
    const key = (r: number, g: number, b: number) => Math.hypot(r - color[0]!, g - color[1]!, b - color[2]!) < 80;
    const agreement = edges.filter((p) => key(p[0]!, p[1]!, p[2]!)).length / edges.length;
    if (agreement < 0.8) continue;
    let count = 0,
      sx = 0,
      sy = 0;
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = origin + (y * width + x) * 3;
        if (key(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
        count++;
        sx += x + 0.5;
        sy += y + 0.5;
      }
    if (count < width * height * 0.035 || count > width * height * 0.65) continue;
    dominant = channel;
    samples.push(color);
    votes.push(agreement);
    centers.push({ at: frame / rate, x: sx / count / width, y: sy / count / height });
  }
  if (centers.length < 2 || centers.length / (data.length / stride) < 0.85) return null;
  const color =
    "#" +
    [0, 1, 2]
      .map((c) =>
        mid(samples.map((p) => p[c]!))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return ScreenPlanSchema.parse({
    color,
    background,
    centers,
    confidence: (mid(votes) * centers.length) / (data.length / stride),
  });
}
