import { AbsoluteFill, Easing, interpolate } from "remotion";
import type { PresentationProps } from "./types";

const accel = Easing.bezier(0.6, 0, 1, 0.6);
const decel = Easing.bezier(0, 0.4, 0.4, 1);

/**
 * Zoom through: the outgoing picture rushes towards the viewer (scale up, blur), the
 * incoming one arrives from a close-up and settles, crossing over around the cut.
 */
export function Zoom({ A, B, frame, cut, durationInFrames }: PresentationProps) {
  // Outgoing half: window start .. cut; incoming half: cut .. window end.
  const outT = Math.min(1, (frame + 1) / Math.max(1, cut + 1));
  const inT = Math.max(0, (frame - cut + 1) / Math.max(1, durationInFrames - cut));
  const aScale = 1 + 0.55 * accel(outT);
  const aBlur = 14 * accel(outT);
  const bScale = 1 + 0.4 * (1 - decel(inT));
  const bBlur = 14 * (1 - decel(inT));
  // Short crossfade across the cut so the switch is not a hard jump at full blur.
  const bOpacity = interpolate(frame, [cut - 1, cut + 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${aScale})`, filter: `blur(${aBlur.toFixed(2)}px)` }}>{A}</AbsoluteFill>
      <AbsoluteFill style={{ opacity: bOpacity, transform: `scale(${bScale})`, filter: `blur(${bBlur.toFixed(2)}px)` }}>{B}</AbsoluteFill>
    </AbsoluteFill>
  );
}
