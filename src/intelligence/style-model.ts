import { z } from "zod";

const unit = z.number().min(0).max(1);
const optionalMeasurement = z.number().finite().nullable();
export const StyleSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seconds: z.number().positive(),
  frames: z.number().int().positive(),
  fps: optionalMeasurement,
  width: z.number().positive(),
  height: z.number().positive(),
  shots: z.number().int().positive(),
  cadence: z.number().positive(),
  pictureTransform: z
    .object({
      direction: z.enum(["in", "out", "translate"]),
      scalePerSecond: z.number().nonnegative(),
      confidence: unit,
    })
    .optional(),
  facePosition: z.object({ x: unit, y: unit }).optional(),
  cadenceSections: z.array(z.number().positive()).length(3).optional(),
  pauseShare: optionalMeasurement,
  motion: optionalMeasurement,
  flashes: z.number().int().nonnegative(),
  fades: z.number().int().nonnegative(),
  lufs: optionalMeasurement,
  cueWords: optionalMeasurement,
  captionLayout: z
    .object({
      ink: z
        .string()
        .regex(/^#[a-f0-9]{6}$/i)
        .nullish(),
      uppercase: z.boolean().optional(),
      center: unit,
      height: unit,
      confidence: unit,
      words: z.number().positive(),
      samples: z.number().int().positive(),
    })
    .nullish(),
  tempo: optionalMeasurement,
  medianLuma: optionalMeasurement.optional(),
  luma: optionalMeasurement,
  contrast: optionalMeasurement,
  saturation: optionalMeasurement,
  confidence: unit,
  hasAudio: z.boolean(),
});
export type StyleSource = z.infer<typeof StyleSourceSchema>;
export const PreferencesSchema = z
  .object({
    cadence: z.number().min(0.8).max(12).optional(),
    zoom: z.number().min(0).max(0.3).optional(),
    captionWords: z.number().int().min(2).max(4).optional(),
    musicDb: z.number().min(-50).max(-8).nullable().optional(),
    transition: z.enum(["cut", "fade", "zoom", "flash"]).optional(),
    broll: z.boolean().optional(),
    captions: z.boolean().optional(),
    grade: z.boolean().optional(),
  })
  .strict();
export type Preferences = z.infer<typeof PreferencesSchema>;
export const StyleProfileSchema = z.object({
  version: z.literal(2),
  family: z.string().min(1),
  revision: z.number().int().positive(),
  parent: z.string().nullable(),
  references: z.array(StyleSourceSchema),
  preferences: PreferencesSchema,
  reason: z.string().min(1),
  created: z.string(),
  notes: z.array(
    z.object({
      rule: z.string(),
      basis: z.string(),
      kind: z.enum(["observation", "inference", "preference"]),
      confidence: unit.nullable(),
    }),
  ),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;
