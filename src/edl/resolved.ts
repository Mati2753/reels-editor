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

export interface ResolvedTransition {
  between: [string, string];
  type: "cut" | "fade" | "slide" | "whip" | "zoom" | "flash" | "glitch";
  /** First frame of the second segment. */
  atFrame: number;
  durationInFrames: number;
  direction?: "left" | "right" | "up" | "down";
}

export interface ResolvedMotion {
  kind: "fade" | "slide" | "pop" | "scale";
  durationInFrames: number;
  direction?: "left" | "right" | "up" | "down";
}

export interface ResolvedOverlay {
  id: string;
  component: string;
  props: Record<string, unknown>;
  fromFrame: number;
  durationInFrames: number;
  layer: "background" | "behind-captions" | "front";
  zone: "top" | "center" | "bottom" | "full";
  enter?: ResolvedMotion;
  exit?: ResolvedMotion;
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
