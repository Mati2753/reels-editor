import { AbsoluteFill, Easing } from "remotion";
import { directionVector } from "../overlays/motion";
import type { PresentationProps } from "./types";

const push = Easing.bezier(0.7, 0, 0.25, 1);

/**
 * Push: both pictures move together towards `direction`, the incoming one taking the
 * place of the outgoing one, with a strong ease in-out (a quick start, a soft landing).
 */
export function Slide({ A, B, progress, direction }: PresentationProps) {
  const v = directionVector(direction);
  const p = push(progress);
  const a = { x: v.x * p * 100, y: v.y * p * 100 };
  const b = { x: v.x * (p - 1) * 100, y: v.y * (p - 1) * 100 };
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${a.x}%, ${a.y}%)` }}>{A}</AbsoluteFill>
      <AbsoluteFill style={{ transform: `translate(${b.x}%, ${b.y}%)` }}>{B}</AbsoluteFill>
    </AbsoluteFill>
  );
}
