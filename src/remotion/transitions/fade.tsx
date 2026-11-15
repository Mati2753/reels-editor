import { AbsoluteFill } from "remotion";
import { smooth } from "../overlays/motion";
import type { PresentationProps } from "./types";

/** Cross-dissolve: the incoming picture fades in over the outgoing one (ease in-out). */
export function Fade({ A, B, progress }: PresentationProps) {
  return (
    <AbsoluteFill>
      <AbsoluteFill>{A}</AbsoluteFill>
      <AbsoluteFill style={{ opacity: smooth(progress) }}>{B}</AbsoluteFill>
    </AbsoluteFill>
  );
}
