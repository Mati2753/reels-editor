import type { ReactElement } from "react";
import type { BrandKit } from "../../brand";
import type { ResolvedTransition } from "../../edl/resolved";

/**
 * A transition presentation: draws the transition window from the two sides' pictures.
 * `A` is the outgoing picture, `B` the incoming one, both full-frame elements that may be
 * rendered several times (glitch slices). Nothing here decides when: the window and the cut
 * come from the resolved EDL.
 */
export interface PresentationProps {
  A: ReactElement;
  B: ReactElement;
  /** Frame inside the window, 0 .. durationInFrames - 1. */
  frame: number;
  durationInFrames: number;
  /** Frame of the window where the second segment (and its voice) starts. */
  cut: number;
  /** (frame + 1) / durationInFrames: above 0 on the first frame, 1 on the last (fully the incoming picture). */
  progress: number;
  direction: NonNullable<ResolvedTransition["direction"]>;
  brand: BrandKit;
  /** Stable seed for deterministic noise (glitch). */
  seed: string;
}

export type Presentation = (props: PresentationProps) => ReactElement;
