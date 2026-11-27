import { z } from "zod";
import type { Format } from "../studio/format-model";

const captionLook = z.object({
  center: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
  ink: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullish(),
  uppercase: z.boolean().optional(),
  position: z.enum(["center", "lower-third"]).optional(),
});
export const ApprovedLookSchema = z.object({
  zoom: z.number().min(0).max(0.3),
  transition: z.enum(["cut", "fade", "flash", "zoom"]),
  stationary: z.boolean(),
  captionWords: z.int().min(1).max(4),
  captionStyle: captionLook,
  musicDb: z.number().finite().nullable(),
  accent: z.enum(["sfx/sweep.wav", "sfx/pulse.wav"]).nullable(),
});
export const feedbackChoices = {
  "keep-camera": "Use this camera and transition style",
  "keep-captions": "Use this subtitle style",
  "keep-mix": "Use this sound mix",
  "still-camera": "Keep the camera still",
  "quiet-music": "Lower the background music",
  "short-captions": "Use shorter subtitles",
  "center-captions": "Place subtitles near the middle",
  "reject-insert": "Avoid this B-roll image",
} as const;
const choice = z.enum([
  "keep-camera",
  "keep-captions",
  "keep-mix",
  "still-camera",
  "quiet-music",
  "short-captions",
  "center-captions",
  "reject-insert",
]);
const rule = z
  .object({
    family: z.string().min(1),
    context: z.enum(["speech", "picture"]),
    choice,
    sample: ApprovedLookSchema.optional(),
    asset: z.string().nullable(),
    timestamp: z.string().datetime(),
    editId: z.string().min(1),
  })
  .refine((r) => !r.choice.startsWith("keep-") || !!r.sample, "Choose a rendered example.")
  .refine((r) => r.choice !== "reject-insert" || !!r.asset, "Select an edit with B-roll.");
export type Feedback = z.infer<typeof rule>;
export const FeedbackSchema = z.array(rule).max(200);
export function rememberFeedback(history: unknown, input: unknown): Feedback[] {
  const entry = rule.parse(input);
  const kept = FeedbackSchema.parse(history ?? []).filter(
    (old) =>
      !(
        old.family === entry.family &&
        old.context === entry.context &&
        old.choice === entry.choice &&
        (entry.choice !== "reject-insert" || old.asset === entry.asset)
      ),
  );
  return [...kept, entry].slice(-200);
}
export function recallFeedback(history: unknown, format: Format, hasSpeech: boolean) {
  const context = hasSpeech ? "speech" : "picture";
  const family = format.profile?.family ?? format.id;
  const parsed = FeedbackSchema.safeParse(history);
  const rules = parsed.success ? parsed.data.filter((r) => r.family === family && r.context === context) : [];
  const recalled = { ...format };
  let stationary = false,
    captionStyle: z.infer<typeof captionLook> = {},
    accent: string | null | undefined;
  for (const r of rules) {
    const sample = r.sample;
    if (r.choice === "still-camera") stationary = true;
    if (r.choice === "keep-camera" && sample) {
      stationary = sample.stationary;
      recalled.transition = sample.transition;
      recalled.zoom = sample.zoom;
    }
    if (r.choice === "keep-mix" && sample) {
      recalled.musicDb = sample.musicDb;
      accent = sample.accent;
    }
    if (r.choice === "quiet-music" && recalled.musicDb !== null) recalled.musicDb = Math.max(-50, recalled.musicDb - 8);
    if (r.choice === "keep-captions" && sample) {
      recalled.captionWords = sample.captionWords;
      captionStyle = { ...sample.captionStyle };
    }
    if (r.choice === "center-captions") captionStyle.position = "center";
    if (r.choice === "short-captions") recalled.captionWords = 2;
  }
  return {
    family,
    context,
    rules,
    stationary,
    captionStyle,
    accent,
    rejected: rules.flatMap((r) => (r.choice === "reject-insert" && r.asset ? [r.asset] : [])),
    format: recalled,
  };
}
