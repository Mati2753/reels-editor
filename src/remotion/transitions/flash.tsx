import { AbsoluteFill, Easing } from "remotion";
import type { PresentationProps } from "./types";

const rise = Easing.in(Easing.quad);
const fall = Easing.out(Easing.cubic);

/**
 * Flash: the picture burns out to the brand's flash colour, peaking on the cut, and the
 * incoming picture emerges from it (a fast rise, a slower decay).
 */
export function Flash({ A, B, frame, cut, durationInFrames, brand }: PresentationProps) {
  const before = frame < cut;
  const level = before ? rise((frame + 1) / (cut + 1)) : 1 - fall((frame - cut) / Math.max(1, durationInFrames - cut));
  const exposure = 1 + 0.9 * level;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: `brightness(${exposure.toFixed(3)})` }}>{before ? A : B}</AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: brand.colors.flash, opacity: Math.min(1, level).toFixed(3) }} />
    </AbsoluteFill>
  );
}
