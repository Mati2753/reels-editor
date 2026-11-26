const width = 72,
  height = 48;
export const transformSize = { width, height };
type Motion = { at: number; end: number; dx: number; dy: number; scale: number; confidence: number };
export function comparePictures(bytes: Uint8Array, rate: number, cuts: number[]): Motion[] {
  const stride = width * height;
  if (!(rate > 0) || bytes.length % stride) throw Error("Invalid picture sequence.");
  const out: Motion[] = [];
  for (let n = 1; n < bytes.length / stride; n++) {
    const at = (n - 1) / rate,
      end = n / rate;
    if (cuts.some((c) => c > at && c <= end)) continue;
    const a = (n - 1) * stride,
      b = n * stride;
    function error(dx: number, dy: number, scale: number) {
      const q = [0, 0, 0, 0];
      for (let y = 6; y < 42; y += 3)
        for (let x = 7; x < 65; x += 3) {
          const xx = Math.round((x - width / 2) * scale + width / 2 + dx),
            yy = Math.round((y - height / 2) * scale + height / 2 + dy);
          const quadrant = (y >= 24 ? 2 : 0) + (x >= 36 ? 1 : 0);
          q[quadrant] = q[quadrant]! + Math.min(44, Math.abs(bytes[a + y * width + x]! - bytes[b + yy * width + xx]!));
        }
      return { q, total: q.reduce((s, v) => s + v, 0) };
    }
    const initial = error(0, 0, 1);
    if (initial.total < 240 * 2.5) continue;
    let best = { ...initial, dx: 0, dy: 0, scale: 1 };
    for (const scale of [1, 0.96, 1.04, 0.92, 1.08])
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (dx === 0 && dy === 0 && scale === 1) continue;
          const next = error(dx, dy, scale);
          if (next.total < best.total) best = { ...next, dx, dy, scale };
        }
    const confidence = 1 - best.total / initial.total;
    if (confidence < 0.34 || best.total / 240 > 16 || best.q.filter((v, i) => v < 0.82 * initial.q[i]!).length < 3)
      continue;
    out.push({ at, end, dx: best.dx / width, dy: best.dy / height, scale: best.scale, confidence });
  }
  return out;
}
