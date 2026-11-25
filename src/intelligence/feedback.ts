import { z } from "zod";
import type { Format } from "../studio/format-model";

export const feedbackChoices = {
  "still-camera": "Keep the camera still",
  "quiet-music": "Lower the background music",
  "short-captions": "Use shorter subtitles",
  "center-captions": "Place subtitles near the middle",
  "reject-insert": "Avoid this B-roll image",
} as const;
const choice = z.enum(["still-camera", "quiet-music", "short-captions", "center-captions", "reject-insert"]);
const rule = z
  .object({
    family: z.string().min(1),
    context: z.enum(["speech", "picture"]),
    choice,
    asset: z.string().nullable(),
    timestamp: z.string().datetime(),
    editId: z.string().min(1),
  })
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
  const has = (key: Feedback["choice"]) => rules.some((r) => r.choice === key);
  return {
    family,
    context,
    rules,
    stationary: has("still-camera"),
    rejected: rules.flatMap((r) => (r.choice === "reject-insert" && r.asset ? [r.asset] : [])),
    position: has("center-captions") ? "center" : null,
    format: {
      ...format,
      musicDb: has("quiet-music") && format.musicDb !== null ? Math.max(-50, format.musicDb - 8) : format.musicDb,
      captionWords: has("short-captions") ? 2 : format.captionWords,
    },
  };
}
