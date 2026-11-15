import type { BrandKit } from "../brand";
import type { CaptionStyle } from "../remotion/captions/styles";
import type { Ease, Point } from "./schema";

/**
 * The resolved EDL: what the Remotion composition receives as props. Every time is an
 * integer frame of the output; components read it as is and compute no time themselves.
 * Produced only by src/edl/resolve.ts. JSON-serializable.
 */

export interface ResolvedFraming {
  scale: number;
  origin: Point;
  move?: { toScale: number; toOrigin?: Point; ease: Ease };
}

export interface ResolvedClipSegment {
  type: "clip";
  id: string;
  clip: string;
  /** Path of the normalized clip relative to the render's public directory. */
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  fromFrame: number;
  durationInFrames: number;
  /** First source frame shown (30 fps source). */
  trimBefore: number;
  playbackRate: number;
  framing: ResolvedFraming;
}

export interface ResolvedSceneSegment {
  type: "scene";
  id: string;
  fromFrame: number;
  durationInFrames: number;
  background: { kind: "color" | "gradient" | "image" | "video"; value: string };
}

export type ResolvedSegment = ResolvedClipSegment | ResolvedSceneSegment;

export interface ResolvedToken {
  /** Word id in analysis.json. */
  word: string;
  /** Text as displayed (override and case applied). */
  text: string;
  /** Highlighted as the active word on [fromFrame, toFrame). */
  fromFrame: number;
  toFrame: number;
  emphasis?: "color" | "scale" | "box";
  /** Measured advance width at the page's font size, px (emphasis included). */
  width: number;
}

export interface ResolvedCaptionPage {
  fromFrame: number;
  durationInFrames: number;
  position: "center" | "lower-third";
  fontSize: number;
  lines: ResolvedToken[][];
  /** Bounding box of the text on screen, outline and active-word growth included, px. */
  box: { x: number; y: number; width: number; height: number };
}

/** Fixed framing of a transition side: the segment's framing at the junction. */
export interface TransitionSideClip {
  kind: "clip";
  segment: string;
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Total frames of the source clip: source frames are clamped to [0, sourceFrames - 1]. */
  sourceFrames: number;
  /**
   * Source frame shown on the first frame of the transition window; frame k of the window
   * shows source frame clamp(firstSourceFrame + k × playbackRate). Before the cut the
   * outgoing side is the segment itself; after it, its handle (the source just past `out`).
   * The incoming side mirrors this (the source just before `in`). Handles are muted.
   */
  firstSourceFrame: number;
  playbackRate: number;
  /** The segment's framing; frame k of the window uses it at segment frame clamp(firstSegmentFrame + k, 0, segmentFrames - 1). */
  framing: ResolvedFraming;
  segmentFrames: number;
  firstSegmentFrame: number;
}

export interface TransitionSideScene {
  kind: "scene";
  segment: string;
  background: { kind: "color" | "gradient" | "image" | "video"; value: string };
}

export type TransitionSide = TransitionSideClip | TransitionSideScene;

export interface ResolvedTransition {
  between: [string, string];
  type: "cut" | "fade" | "slide" | "whip" | "zoom" | "flash" | "glitch";
  /** First frame of the second segment: the cut, where the voice switches. */
  atFrame: number;
  /** First frame of the transition window (atFrame - floor(duration / 2)). */
  fromFrame: number;
  durationInFrames: number;
  direction?: "left" | "right" | "up" | "down";
  outgoing: TransitionSide;
  incoming: TransitionSide;
}

export interface ResolvedMotion {
  kind: "fade" | "slide" | "pop" | "scale" | "none";
  durationInFrames: number;
  direction: "left" | "right" | "up" | "down";
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedOverlay {
  id: string;
  component: string;
  /** Props as parsed by the component's schema (defaults applied). */
  props: Record<string, unknown>;
  fromFrame: number;
  durationInFrames: number;
  layer: "background" | "behind-captions" | "front";
  zone: "top" | "center" | "bottom" | "full";
  /** Rectangle the content is laid out in (src/edl/zones.ts), px. */
  area: Box;
  /** Bounding box of what the component draws in its settled state, px (checked against the safe zone and the captions). */
  box: Box;
  enter: ResolvedMotion;
  exit: ResolvedMotion;
  /** Frames, from the overlay's first frame, of its cues (list items, steps...). */
  cues: number[];
  /** Component-specific layout computed with the real font metrics (src/remotion/overlays/<Name>.tsx). */
  layout: unknown;
}

export interface ResolvedAudio {
  voice: { targetLufs: number; denoise: boolean };
  music?: { file: string; gainDb: number; duck: boolean; startFrame: number; fadeOutFrames: number };
  sfx: { file: string; fromFrame: number; gainDb: number }[];
}

export interface ResolvedEdl {
  version: 1;
  title: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  brand: BrandKit;
  captionStyle: CaptionStyle;
  segments: ResolvedSegment[];
  transitions: ResolvedTransition[];
  overlays: ResolvedOverlay[];
  captions: { enabled: boolean; pages: ResolvedCaptionPage[] };
  audio: ResolvedAudio;
}
