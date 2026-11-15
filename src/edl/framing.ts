import type { Ease, Point } from "./schema";

/**
 * Framing geometry: which rectangle of the source picture fills the 1080x1920 output.
 * Pure functions, shared by the resolver (checks) and the VideoTrack (per frame).
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Crop extends Rect {
  /** True when the crop had to be shifted to stay inside the source (origin not centred). */
  shifted: boolean;
}

/**
 * Largest rectangle with the output's aspect ratio inside the source, centred on `origin`
 * (0..1 of the source), reduced by `scale`, then shifted, never shrunk, so that it stays
 * inside the source: the output never shows anything outside the picture. A crop of scale
 * s can only be centred on points between 1/(2s) and 1 - 1/(2s) of the base crop; beyond,
 * it stops at the edge of the source.
 */
export function cropRect(source: Size, output: Size, scale: number, origin: Point): Crop {
  const outAspect = output.width / output.height;
  const srcAspect = source.width / source.height;
  const baseWidth = srcAspect > outAspect ? source.height * outAspect : source.width;
  const baseHeight = baseWidth / outAspect;
  const s = Math.max(1, scale);
  const width = baseWidth / s;
  const height = baseHeight / s;
  const wantX = origin.x * source.width - width / 2;
  const wantY = origin.y * source.height - height / 2;
  const x = clamp(wantX, 0, source.width - width);
  const y = clamp(wantY, 0, source.height - height);
  // Shifted only along an axis where the crop is smaller than the source: at scale 1 on a
  // source of the output's shape the crop is the whole picture and the origin is moot.
  const shiftedX = width < source.width - 0.5 && Math.abs(x - wantX) > 0.5;
  const shiftedY = height < source.height - 0.5 && Math.abs(y - wantY) > 0.5;
  return { x, y, width, height, shifted: shiftedX || shiftedY };
}

/**
 * Position and size of the whole source picture, in output pixels, so that `crop` exactly
 * fills the output.
 */
export function placeSource(source: Size, output: Size, crop: Rect): Rect {
  const k = output.width / crop.width;
  return { x: -crop.x * k, y: -crop.y * k, width: source.width * k, height: source.height * k };
}

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
};

export function ease(kind: Ease, t: number): number {
  return EASES[kind](clamp(t, 0, 1));
}

export interface FramingState {
  scale: number;
  origin: Point;
}

/**
 * Framing at `frame` (0-based, local to the segment) of a segment lasting `duration`
 * frames: the move starts on the first frame and reaches its target on the last one.
 */
export function framingAt(
  framing: { scale: number; origin: Point; move?: { toScale: number; toOrigin?: Point; ease: Ease } },
  frame: number,
  duration: number,
): FramingState {
  const { move } = framing;
  if (!move) return { scale: framing.scale, origin: framing.origin };
  const p = ease(move.ease, duration > 1 ? frame / (duration - 1) : 1);
  const to = move.toOrigin ?? framing.origin;
  return {
    scale: framing.scale + (move.toScale - framing.scale) * p,
    origin: { x: framing.origin.x + (to.x - framing.origin.x) * p, y: framing.origin.y + (to.y - framing.origin.y) * p },
  };
}

/** Largest scale advised for a source (docs/DIRECTOR.md: 1.4 on 1080p, 1.8 on 4K). */
export function maxAdvisedScale(source: Size): number {
  return Math.min(source.width, source.height) >= 2160 ? 1.8 : 1.4;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
