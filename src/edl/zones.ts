import type { SafeZone } from "../brand";
import type { Zone } from "./schema";

/**
 * Overlay zones (docs/EDL.md, Overlays): the rectangle of the 1080x1920 frame where an
 * overlay may draw its content, derived from the brand's safe zone. Pure geometry shared
 * by the resolver (layout, checks) and the overlay components.
 *
 * Every zone is centred on the frame: x from the larger of the two side margins on both
 * sides (130..950 with the default kit), like the captions. Vertically:
 *   top     safe top .. 680          (above the face in a talking-head shot)
 *   center  680 .. 1180              (captions stay below it, in the lower third)
 *   bottom  1060 .. safe bottom      (captions move to the centre above it)
 *   full    the whole frame is covered by a backdrop; the content stays in safe top .. 1180
 *           so that the captions keep the lower third, or down to the safe bottom when
 *           no caption is shown during the overlay.
 */

export type { Zone };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FRAME = { width: 1080, height: 1920 } as const;

/** Bottom of the top zone and top of the centre zone, px. */
export const TOP_ZONE_BOTTOM = 680;
/** Bottom of the centre zone and of a full-screen overlay's content when captions show. */
export const CENTER_ZONE_BOTTOM = 1180;
/** Top of the bottom zone, px. */
export const BOTTOM_ZONE_TOP = 1060;

/** The safe area of a brand: no text outside it (docs/DIRECTOR.md, Zone sûre). */
export function safeArea(safe: SafeZone): Rect {
  return { x: safe.left, y: safe.top, width: FRAME.width - safe.left - safe.right, height: FRAME.height - safe.top - safe.bottom };
}

/** Content rectangle of a zone. `captionsShown`: a caption page may show during the overlay. */
export function zoneArea(zone: Zone, safe: SafeZone, captionsShown: boolean): Rect {
  const half = Math.min(FRAME.width / 2 - safe.left, FRAME.width / 2 - safe.right);
  const x = FRAME.width / 2 - half;
  const width = 2 * half;
  const top = safe.top;
  const bottom = FRAME.height - safe.bottom;
  switch (zone) {
    case "top":
      return { x, y: top, width, height: TOP_ZONE_BOTTOM - top };
    case "center":
      return { x, y: TOP_ZONE_BOTTOM, width, height: CENTER_ZONE_BOTTOM - TOP_ZONE_BOTTOM };
    case "bottom":
      return { x, y: BOTTOM_ZONE_TOP, width, height: bottom - BOTTOM_ZONE_TOP };
    case "full":
      return { x, y: top, width, height: (captionsShown ? CENTER_ZONE_BOTTOM : bottom) - top };
  }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function inside(inner: Rect, outer: Rect, tolerance = 0.5): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.width <= outer.x + outer.width + tolerance && inner.y + inner.height <= outer.y + outer.height + tolerance;
}
