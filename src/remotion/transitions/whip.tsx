import { AbsoluteFill, Easing } from "remotion";
import { directionVector } from "../overlays/motion";
import type { PresentationProps } from "./types";

const whipEase = Easing.bezier(0.85, 0, 0.15, 1);

/**
 * Whip pan: a fast push with a motion blur along the move, strongest at the middle of the
 * window (the speed of the pan). The blur is an SVG Gaussian blur on one axis only.
 */
export function Whip({ A, B, progress, direction, durationInFrames, seed }: PresentationProps) {
  const v = directionVector(direction);
  const p = whipEase(progress);
  // Speed of the move, normalized: derivative of the ease, 0 at the ends, peak at the middle.
  const dp = (whipEase(Math.min(1, progress + 0.02)) - whipEase(Math.max(0, progress - 0.02))) / 0.04;
  const blur = Math.min(90, dp * 18 * (8 / Math.max(4, durationInFrames)) * 2.2);
  const id = `whip-blur-${seed}-${durationInFrames}-${Math.round(progress * 1000)}`;
  const sx = v.x !== 0 ? blur : 0;
  const sy = v.y !== 0 ? blur : 0;
  const a = { x: v.x * p * 100, y: v.y * p * 100 };
  const b = { x: v.x * (p - 1) * 100, y: v.y * (p - 1) * 100 };
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
        <defs>
          <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} edgeMode="duplicate" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{ filter: blur > 0.5 ? `url(#${id})` : undefined }}>
        <AbsoluteFill style={{ transform: `translate(${a.x}%, ${a.y}%)` }}>{A}</AbsoluteFill>
        <AbsoluteFill style={{ transform: `translate(${b.x}%, ${b.y}%)` }}>{B}</AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
