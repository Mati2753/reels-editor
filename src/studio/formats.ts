import { formatFromMeasurements, median, type Format } from "./format-model";
export { FormatSchema, presets, type Format } from "./format-model";
import { detectCuts, cutsToShots, detectSilence, measureLoudness } from "../pipeline/analysis/media";
import { parseSilencedetect } from "../pipeline/analysis/intervals";
import { ffprobeJson, ffmpeg } from "../pipeline/util/exec";
import { ms } from "../pipeline/project";

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
  return formatFromMeasurements(
    id,
    name,
    duration,
    shots.map((s) => s.end - s.start),
    motion,
    transients.length,
    hasAudio,
    silentShare,
    lufs,
    captionCueWords,
  );
}
