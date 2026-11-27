import { z } from "zod";
import { ms } from "../edl/time";
import { StyleProfileSchema } from "../intelligence/style-model";

export const FormatSchema = z.object({
  profile: StyleProfileSchema.optional(),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  shotSeconds: z.number().positive(),
  pauseSeconds: z.number().positive(),
  zoom: z.number().min(0).max(0.3),
  transition: z.enum(["cut", "fade", "zoom", "flash"]),
  captionWords: z.number().int().min(1).max(4),
  musicDb: z.number().nullable(),
  reference: z
    .object({
      duration: z.number(),
      shots: z.number(),
      medianShot: z.number(),
      silentShare: z.number().nullable(),
      lufs: z.number().nullable(),
      motion: z.number(),
      flashes: z.number(),
      captionCueWords: z.number().nullable().optional(),
    })
    .optional(),
});
export type Format = z.infer<typeof FormatSchema>;
export const presets: Format[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Longer shots, gentle movement and soft dissolves.",
    image: "/assets/alpine.jpg",
    shotSeconds: 4.8,
    pauseSeconds: 0.85,
    zoom: 0.07,
    transition: "fade",
    captionWords: 4,
    musicDb: -17,
  },
  {
    id: "quick-cut",
    name: "Quick cut",
    description: "Short beats, punch-ins and crisp accents.",
    image: "/assets/forest.jpg",
    shotSeconds: 1.9,
    pauseSeconds: 0.4,
    zoom: 0.19,
    transition: "zoom",
    captionWords: 2,
    musicDb: -19,
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Speech-led cuts, readable captions and clean joins.",
    image: "/assets/lake.jpg",
    shotSeconds: 3.2,
    pauseSeconds: 0.6,
    zoom: 0.1,
    transition: "cut",
    captionWords: 3,
    musicDb: null,
  },
];

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2;
}

export function formatFromMeasurements(
  id: string,
  name: string,
  duration: number,
  shotDurations: number[],
  motion: number,
  flashes: number,
  hasAudio: boolean,
  silentShare: number | null,
  lufs: number | null,
  captionCueWords: number | null,
): Format {
  const medianShot = ms(median(shotDurations));
  const shotSeconds = Math.min(9, Math.max(1.1, medianShot));
  const transition = flashes ? "flash" : shotSeconds <= 2.5 ? "cut" : motion > 13 ? "zoom" : "fade";
  return {
    id,
    name,
    image: `/formats/${id}/poster.jpg`,
    description: `${shotDurations.length} measured shot${shotDurations.length === 1 ? "" : "s"} · ${medianShot.toFixed(1)}s median length`,
    shotSeconds,
    pauseSeconds: ms(0.38 + 0.8 * (silentShare ?? Math.min(1, shotSeconds / 9))),
    zoom: ms(Math.min(0.2, 0.045 + motion * 0.004)),
    transition,
    captionWords:
      captionCueWords !== null
        ? Math.max(1, Math.min(4, Math.round(captionCueWords)))
        : shotSeconds <= 2.5
          ? 2
          : shotSeconds < 4
            ? 3
            : 4,
    musicDb:
      !hasAudio || silentShare === null || silentShare > 0.8 || lufs === null || lufs < -52
        ? null
        : Math.max(-26, Math.min(-16, Math.round(lufs - 4))),
    reference: {
      duration,
      shots: shotDurations.length,
      medianShot,
      silentShare,
      lufs,
      motion,
      flashes: flashes,
      captionCueWords,
    },
  };
}
