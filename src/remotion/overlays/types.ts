import type { ReactNode } from "react";
import type { z } from "zod";
import type { BrandKit } from "../../brand";
import type { TextMeasurer } from "../../edl/measure-core";
import type { Box, ResolvedMotion } from "../../edl/resolved";
import type { Direction, MotionKind, Zone } from "../../edl/schema";
import type { FitResult } from "../../edl/textfit";

/**
 * What an overlay component is (docs/ARCHITECTURE.md, "Extension : ajouter une animation"):
 * a zod schema of its props, the zones it accepts, its default entrance and exit, a layout
 * computed by the resolver with the real font metrics (so validate knows what fits), and
 * the React component that draws the layout at a given frame.
 *
 * Methods (not function-valued properties) so that a definition of specific props can be
 * stored in the registry of all definitions.
 */
export interface OverlayDefinition<P = unknown, L = unknown> {
  /** One line for the gallery and error messages. */
  description: string;
  props: z.ZodType<P>;
  zones: readonly Zone[];
  enter: { kind: MotionKind; duration: number; direction: Direction };
  exit: { kind: MotionKind; duration: number; direction: Direction };
  /** Every text the overlay shows, for the word-count rule (docs/DIRECTOR.md: 6 words). */
  text(props: P): string;
  /** Number of cues the overlay uses (0 when it has none). */
  cueCount(props: P): number;
  layout(props: P, ctx: LayoutContext): LayoutResult<L>;
  render(view: OverlayView<P, L>): ReactNode;
}

export interface LayoutContext {
  brand: BrandKit;
  measure: TextMeasurer;
  language: string;
  zone: Zone;
  /** Content rectangle of the zone (src/edl/zones.ts). */
  area: Box;
  /** The brand's safe area: nothing drawn as text outside it. */
  safe: Box;
}

export interface TextReport {
  /** Prop the text comes from ("title", "items[2]"). */
  field: string;
  fit: FitResult;
  /** Font size the component wants for it. */
  preferred: number;
}

export interface LayoutResult<L> {
  layout: L;
  /** Bounding box of the settled content, px. */
  box: Box;
  /** Texts fitted, for validate (shrunk, overflow). */
  texts: TextReport[];
}

export interface OverlayView<P, L> {
  props: P;
  layout: L;
  brand: BrandKit;
  zone: Zone;
  area: Box;
  box: Box;
  /** Frame inside the overlay (0 = first frame). */
  frame: number;
  durationInFrames: number;
  fps: number;
  /** Entrance progress: 0 → 1 over the entrance (a spring: may overshoot slightly). */
  enter: number;
  /** Exit progress: 0 until the exit starts, 1 on the last frame. */
  exit: number;
  enterMotion: ResolvedMotion;
  exitMotion: ResolvedMotion;
  /** Cue frames from the overlay's first frame; components fall back to a stagger without them. */
  cues: number[];
}

export function defineOverlay<P, L>(def: OverlayDefinition<P, L>): OverlayDefinition<P, L> {
  return def;
}
