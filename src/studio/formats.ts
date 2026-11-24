import { z } from "zod";
import { detectCuts, cutsToShots, detectSilence, measureLoudness } from "../pipeline/analysis/media";
import { parseSilencedetect } from "../pipeline/analysis/intervals";
import { ffprobeJson, ffmpeg } from "../pipeline/util/exec";
import { ms } from "../pipeline/project";

export const FormatSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  shotSeconds: z.number().positive(),
  pauseSeconds: z.number().positive(),
  zoom: z.number().min(0).max(0.3),
  transition: z.enum(["cut", "fade", "zoom", "flash"]),
  captionWords: z.number().int().min(2).max(4),
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

export async function inspectVideo(file: string) {
  const data = (await ffprobeJson([
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    "mov,matroska,webm,avi,mpegts",
    "-show_streams",
    "-show_format",
    file,
  ])) as {
    streams: {
      codec_type: string;
      codec_name?: string;
      duration?: string;
      width?: number;
      height?: number;
      disposition?: { attached_pic?: number };
    }[];
    format: { duration?: string };
  };
  const video = data.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(video?.duration) || Number(data.format.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Choose a video with a readable picture and duration.");
  }
  const subtitle = data.streams.findIndex(
    (s) => s.codec_type === "subtitle" && ["mov_text", "subrip", "webvtt", "ass", "ssa"].includes(s.codec_name ?? ""),
  );
  return { duration, hasAudio: data.streams.some((s) => s.codec_type === "audio"), subtitle };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2;
}

// YDIF measures the change in luminance between samples. The median suppresses
// isolated hard cuts. Camera movement and movement in the scene both contribute.
async function measureMotion(file: string): Promise<number> {
  const { stdout } = await ffmpeg([
    "-i",
    file,
    "-an",
    "-vf",
    "fps=4,scale=128:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-",
    "-f",
    "null",
    "-",
  ]);
  const deltas = [...stdout.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].slice(1).map((m) => Number(m[1]));
  return deltas.length ? ms(median(deltas)) : 0;
}

export async function learnFormat(file: string, id: string, name: string): Promise<Format> {
  const { duration, hasAudio, subtitle } = await inspectVideo(file);
  let captionCueWords: number | null = null;
  if (subtitle >= 0) {
    const { stdout } = await ffmpeg(["-i", file, "-map", `0:${subtitle}`, "-f", "srt", "-"]);
    const counts = stdout
      .trim()
      .split(/\r?\n\s*\n/)
      .map(
        (cue) =>
          cue
            .split(/\r?\n/)
            .slice(2)
            .join(" ")
            .replace(/<[^>]+>|\{[^}]+\}/g, "")
            .trim()
            .split(/\s+/)
            .filter(Boolean).length,
      )
      .filter((n) => n > 0);
    if (counts.length) captionCueWords = median(counts);
  }
  const cuts = await detectCuts(file, 9);
  const { shots, transients } = await cutsToShots(file, duration, cuts, 0.38, 12);
  const motion = await measureMotion(file);
  let silentShare: number | null = null;
  let lufs: number | null = null;
  if (hasAudio) {
    const silence = await detectSilence(file, -38, 0.25);
    silentShare = ms(
      Math.min(1, parseSilencedetect(silence, duration).reduce((sum, v) => sum + v.end - v.start, 0) / duration),
    );
    lufs = (await measureLoudness(file)).integratedLufs;
  }
  const medianShot = ms(median(shots.map((s) => s.end - s.start)));
  const shotSeconds = Math.min(9, Math.max(1.1, medianShot));
  const transition = transients.length ? "flash" : shotSeconds <= 2.5 ? "cut" : motion > 13 ? "zoom" : "fade";
  return {
    id,
    name,
    image: `/formats/${id}/poster.jpg`,
    description: `${shots.length} measured shot${shots.length === 1 ? "" : "s"} · ${medianShot.toFixed(1)}s median length`,
    shotSeconds,
    pauseSeconds: ms(0.38 + 0.8 * (silentShare ?? Math.min(1, shotSeconds / 9))),
    zoom: ms(Math.min(0.2, 0.045 + motion * 0.004)),
    transition,
    captionWords:
      captionCueWords !== null
        ? Math.max(2, Math.min(4, Math.round(captionCueWords)))
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
      shots: shots.length,
      medianShot,
      silentShare,
      lufs,
      motion,
      flashes: transients.length,
      captionCueWords,
    },
  };
}
