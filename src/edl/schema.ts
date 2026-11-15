import { z } from "zod";

/**
 * The EDL contract between the director and the renderer: `projects/<slug>/edl.json`.
 * This schema is the source of truth; docs/EDL.md explains it and changes with it.
 *
 * All times are seconds. Output times are never written: they follow from the segments
 * (src/edl/resolve.ts is the only place where seconds become frames).
 */

const seconds = z.number().nonnegative();
const unit = z.number().min(0).max(1);
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, "ids use letters, digits, '-' and '_'");

// ---------------------------------------------------------------- anchors

/** At a word of analysis.json (`edge` "start" by default), shifted by `offset` seconds of output. */
export const WordAnchorSchema = z.strictObject({
  word: z.string(),
  edge: z.enum(["start", "end"]).optional(),
  offset: z.number().optional(),
});

/** `offset` seconds of output after the start of a segment. */
export const SegmentAnchorSchema = z.strictObject({
  segment: z.string(),
  offset: z.number().optional(),
});

export const AnchorSchema = z.union([WordAnchorSchema, SegmentAnchorSchema]);

// ---------------------------------------------------------------- segments

export const PointSchema = z.strictObject({ x: unit, y: unit });

/** Easing curve of a progressive move. */
export const EaseSchema = z.enum(["linear", "easeIn", "easeOut", "easeInOut"]);

export const FramingSchema = z.strictObject({
  /** 1 = the base 9:16 crop of the source; 1.2 = 20 % closer. Never below 1. */
  scale: z.number().min(1),
  /** Centre of the crop, 0..1 in the source picture. Shifted to keep the crop inside the source. */
  origin: PointSchema,
  /** Progressive zoom over the whole segment, from `scale`/`origin` to `toScale`/`toOrigin`. */
  move: z
    .strictObject({
      toScale: z.number().min(1),
      toOrigin: PointSchema.optional(),
      ease: EaseSchema,
    })
    .optional(),
});

export const ClipSegmentSchema = z.strictObject({
  id,
  type: z.literal("clip"),
  /** Clip id from probe.json ("c1"). */
  clip: z.string().regex(/^c\d+$/),
  /** Seconds in the normalized clip. */
  in: seconds,
  out: seconds,
  framing: FramingSchema,
  /** Playback speed, 1 by default; the segment lasts (out - in) / speed seconds. */
  speed: z.number().min(0.25).max(4).optional(),
});

export const SceneSegmentSchema = z.strictObject({
  id,
  type: z.literal("scene"),
  duration: z.number().positive(),
  background: z.strictObject({
    kind: z.enum(["color", "gradient", "image", "video"]),
    /** CSS colour or gradient, or a file for image / video. */
    value: z.string().min(1),
  }),
});

export const SegmentSchema = z.discriminatedUnion("type", [ClipSegmentSchema, SceneSegmentSchema]);

// ---------------------------------------------------------------- transitions

export const DirectionSchema = z.enum(["left", "right", "up", "down"]);

export const TransitionSchema = z.strictObject({
  between: z.tuple([z.string(), z.string()]),
  type: z.enum(["cut", "fade", "slide", "whip", "zoom", "flash", "glitch"]),
  duration: seconds,
  direction: DirectionSchema.optional(),
});

// ---------------------------------------------------------------- overlays

/** Entrance or exit of an overlay. */
export const MotionSchema = z.strictObject({
  kind: z.enum(["fade", "slide", "pop", "scale"]),
  duration: z.number().positive(),
  direction: DirectionSchema.optional(),
});

export const OverlaySchema = z.strictObject({
  id,
  /** Name in src/remotion/overlays/index.ts. */
  component: z.string(),
  /** Validated by the component's own schema. */
  props: z.record(z.string(), z.unknown()),
  at: AnchorSchema,
  duration: z.number().positive(),
  layer: z.enum(["background", "behind-captions", "front"]),
  zone: z.enum(["top", "center", "bottom", "full"]),
  enter: MotionSchema.optional(),
  exit: MotionSchema.optional(),
});

// ---------------------------------------------------------------- captions

export const CaptionConfigSchema = z.strictObject({
  enabled: z.boolean(),
  /** Name in src/remotion/captions/styles.ts. */
  style: z.string(),
  maxWordsPerPage: z.number().int().min(2).max(4),
  position: z.enum(["center", "lower-third", "auto"]),
  emphasis: z.array(z.strictObject({ word: z.string(), style: z.enum(["color", "scale", "box"]) })),
  /** Corrected caption text for one word; "" removes the word from the captions only. */
  overrides: z.array(z.strictObject({ word: z.string(), text: z.string() })),
  hide: z.array(z.strictObject({ from: AnchorSchema, to: AnchorSchema })),
});

// ---------------------------------------------------------------- audio

export const AudioConfigSchema = z.strictObject({
  voice: z.strictObject({ targetLufs: z.literal(-14), denoise: z.boolean() }),
  music: z
    .strictObject({
      file: z.string(),
      gainDb: z.number(),
      duck: z.boolean(),
      startAt: seconds.optional(),
      fadeOut: seconds,
    })
    .optional(),
  sfx: z.array(z.strictObject({ file: z.string(), at: AnchorSchema, gainDb: z.number() })),
});

// ---------------------------------------------------------------- EDL

export const MetaSchema = z.strictObject({
  title: z.string(),
  fps: z.literal(30),
  width: z.literal(1080),
  height: z.literal(1920),
  /** Name in src/brand/index.ts. */
  brand: z.string(),
  language: z.string(),
});

export const EdlSchema = z.strictObject({
  version: z.literal(1),
  meta: MetaSchema,
  segments: z.array(SegmentSchema).min(1),
  transitions: z.array(TransitionSchema),
  overlays: z.array(OverlaySchema),
  captions: CaptionConfigSchema,
  audio: AudioConfigSchema,
  /** The director's intent, for human review. */
  notes: z.string().optional(),
});

export type Anchor = z.infer<typeof AnchorSchema>;
export type WordAnchor = z.infer<typeof WordAnchorSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Ease = z.infer<typeof EaseSchema>;
export type Framing = z.infer<typeof FramingSchema>;
export type ClipSegment = z.infer<typeof ClipSegmentSchema>;
export type SceneSegment = z.infer<typeof SceneSegmentSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Motion = z.infer<typeof MotionSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type CaptionConfig = z.infer<typeof CaptionConfigSchema>;
export type AudioConfig = z.infer<typeof AudioConfigSchema>;
export type Edl = z.infer<typeof EdlSchema>;

export function isWordAnchor(anchor: Anchor): anchor is WordAnchor {
  return "word" in anchor;
}
