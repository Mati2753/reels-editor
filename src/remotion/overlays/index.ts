import type { ComponentType } from "react";
import type { z } from "zod";

/**
 * Overlay library: every animation the director may place in `overlays` (docs/EDL.md).
 * A component is usable only once it is registered here and listed in the catalogue of
 * docs/DIRECTOR.md. Empty until phase 3: validate rejects any overlay until then.
 */
export interface OverlayDefinition {
  /** Schema of the `props` the EDL gives the overlay. */
  props: z.ZodType;
  component: ComponentType<{ props: Record<string, unknown>; durationInFrames: number }>;
}

export type OverlayRegistry = Readonly<Record<string, OverlayDefinition>>;

export const overlays: OverlayRegistry = {};
