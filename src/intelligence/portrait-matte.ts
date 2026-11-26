export const portraitModel = {
  model: "Xenova/modnet",
  revision: "fa2fa546052fba4c08921230a26cc69a333fca12",
  sha256: "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
  size: 256,
  rate: 8,
} as const;

export function evaluateMatte(alpha: Float32Array, size: number, face?: { x: number; y: number }) {
  if (!Number.isInteger(size) || size < 1 || alpha.length !== size * size)
    throw Error("Unexpected portrait mask dimensions.");
  const mask = new Uint8Array(alpha.length);
  let foreground = 0,
    background = 0,
    invalid = 0;
  for (let k = 0; k < alpha.length; k++) {
    const p = alpha[k]!;
    if (!Number.isFinite(p)) {
      invalid++;
      continue;
    }
    mask[k] = Math.round(255 * Math.max(0, Math.min(1, p)));
    foreground += Number(p > 0.8);
    background += Number(p < 0.2);
  }
  foreground /= alpha.length;
  background /= alpha.length;
  const pixel = (p: number) => Math.max(0, Math.min(size - 1, Math.floor(p * size)));
  const faceAlpha = face ? mask[pixel(face.y) * size + pixel(face.x)]! / 255 : null;
  const accepted =
    invalid === 0 && foreground >= 0.025 && background >= 0.025 && (faceAlpha === null || faceAlpha >= 0.55);
  return { mask, foreground, background, faceAlpha, accepted };
}
