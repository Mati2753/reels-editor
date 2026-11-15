import type { CSSProperties } from "react";
import { Easing, interpolate, spring } from "remotion";
import type { ResolvedMotion } from "../../edl/resolved";

/**
 * Overlay motion (docs/DIRECTOR.md, Mouvement): entrances on a damped spring, exits shorter
 * and accelerating, never linear. The durations come from the resolved EDL; nothing here
 * decides when anything happens.
 */

/** Spring of each entrance kind: "pop" overshoots visibly, the others settle with a slight one. */
const SPRINGS = {
  pop: { damping: 11, stiffness: 170, mass: 0.7 },
  scale: { damping: 17, stiffness: 160, mass: 0.8 },
  slide: { damping: 16, stiffness: 150, mass: 0.8 },
  item: { damping: 15, stiffness: 160, mass: 0.7 },
} as const;

/** Ease of exits: accelerating out (ease-in cubic). */
export const exitEasing = Easing.bezier(0.55, 0, 1, 0.45);
/** Ease of moves that start and stop (counters, bars, transitions). */
export const smooth = Easing.bezier(0.65, 0, 0.35, 1);
/** Ease of moves that land (decelerating). */
export const landing = Easing.bezier(0.16, 1, 0.3, 1);

/**
 * Entrance progress at `frame` (0-based): 0 → 1 on a spring stretched to the entrance's
 * duration. Evaluated one frame ahead so that the overlay's first frame already shows it
 * (the anchor is the first visible frame).
 */
export function enterProgress(frame: number, motion: ResolvedMotion, fps: number): number {
  if (motion.kind === "none") return 1;
  if (motion.kind === "fade") return interpolate(frame + 1, [0, motion.durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return spring({ frame: frame + 1, fps, config: SPRINGS[motion.kind], durationInFrames: motion.durationInFrames });
}

/** Exit progress: 0 until the exit starts, reaching 1 on the overlay's last frame. */
export function exitProgress(frame: number, durationInFrames: number, motion: ResolvedMotion): number {
  if (motion.kind === "none") return frame >= durationInFrames ? 1 : 0;
  const start = durationInFrames - motion.durationInFrames;
  return interpolate(frame + 1, [start, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: exitEasing });
}

/** Spring of an element appearing inside an overlay (a list item on its cue), 0 → 1. */
export function itemProgress(frame: number, startFrame: number, fps: number, durationInFrames = 10): number {
  if (frame < startFrame - 1) return 0;
  return spring({ frame: frame - startFrame + 1, fps, config: SPRINGS.item, durationInFrames });
}

const UNIT: Record<ResolvedMotion["direction"], { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export function directionVector(d: ResolvedMotion["direction"]): { x: number; y: number } {
  return UNIT[d];
}

/** Distance an overlay slides, px. */
const SLIDE = 150;

/**
 * Transform and opacity of an overlay's content for its entrance and exit progress.
 * `origin` is the transform origin in px (centre of the content box).
 */
export function motionStyle(enter: number, exit: number, inMotion: ResolvedMotion, outMotion: ResolvedMotion, origin: { x: number; y: number }): CSSProperties {
  let opacity = 1;
  let tx = 0;
  let ty = 0;
  let scale = 1;
  // Entrance.
  switch (inMotion.kind) {
    case "fade":
      opacity *= enter;
      break;
    case "pop":
      scale *= 0.45 + 0.55 * enter;
      opacity *= Math.min(1, enter * 3);
      break;
    case "scale":
      scale *= 0.82 + 0.18 * enter;
      opacity *= Math.min(1, enter * 2.2);
      break;
    case "slide": {
      const v = UNIT[inMotion.direction];
      tx += v.x * SLIDE * (1 - enter);
      ty += v.y * SLIDE * (1 - enter);
      opacity *= Math.min(1, enter * 2.5);
      break;
    }
    case "none":
      break;
  }
  // Exit.
  switch (outMotion.kind) {
    case "fade":
      opacity *= 1 - exit;
      break;
    case "pop":
    case "scale":
      scale *= 1 - 0.18 * exit;
      opacity *= 1 - exit;
      break;
    case "slide": {
      const v = UNIT[outMotion.direction];
      tx += v.x * SLIDE * 0.8 * exit;
      ty += v.y * SLIDE * 0.8 * exit;
      opacity *= 1 - exit;
      break;
    }
    case "none":
      if (exit >= 1) opacity = 0;
      break;
  }
  return {
    opacity: Math.max(0, Math.min(1, opacity)),
    transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`,
    transformOrigin: `${origin.x}px ${origin.y}px`,
  };
}
