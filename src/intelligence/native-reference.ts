import { recognizeSound } from "./native-sound";
import { summarizeSound, soundModel, type SoundWindow } from "./audio-events";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { run, ffprobeJson } from "../pipeline/util/exec";
import { parseSilencedetect } from "../pipeline/analysis/intervals";
import { median } from "../studio/format-model";
import { audioEvidence, frameEvidence, makeReferenceEvidence, REFERENCE_FRAME_FILTER } from "./evidence";
import { describeReference, makeStyle } from "./styles";

export function rational(value?: string) {
  if (!value) return null;
  const [a, b] = value.split("/").map(Number);
  const result = b ? a! / b : a;
  return result && Number.isFinite(result) && result > 0 ? result : null;
}
export function integratedFromLog(text: string): number | null {
  const summary = text.split("Summary:").at(-1) ?? "";
  const m = /\bI:\s*(-?[\d.]+)\s*LUFS/i.exec(summary);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > -70 ? n : null;
}
export async function analyzeReferenceFile(file: string, id: string, name: string, keepFrames = false) {
  const input = path.resolve(file);
  type Stream = {
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    time_base?: string;
    disposition?: { attached_pic?: number };
    index: number;
  };
  const meta = (await ffprobeJson([
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    "mov,matroska,webm,avi,mpegts",
    "-show_streams",
    "-show_format",
    input,
  ])) as { streams: Stream[]; format: { duration?: string } };
  const video = meta.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(video?.duration) || Number(meta.format.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0)
    throw Error("Choose a readable video reference.");
  const dir = await mkdtemp(path.join(tmpdir(), "reelforge-reference-"));
  const read = ["-hide_banner", "-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-i", input];
  try {
    await run(
      "ffmpeg",
      [
        ...read,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        REFERENCE_FRAME_FILTER + ",metadata=mode=print:file=frames.txt",
        "-fps_mode",
        "passthrough",
        "-f",
        "null",
        "-",
      ],
      { cwd: dir },
    );
    const visual = frameEvidence(await readFile(path.join(dir, "frames.txt"), "utf8"), duration, { keepFrames: true });
    let soundWindows: SoundWindow[] | null = null;
    let audio = null,
      pauseShare: number | null = null,
      integratedLufs: number | null = null;
    if (meta.streams.some((s) => s.codec_type === "audio")) {
      const log = await run(
        "ffmpeg",
        [
          ...read,
          "-map",
          "0:a:0",
          "-vn",
          "-af",
          "silencedetect=n=-38dB:d=0.25,ebur128=framelog=verbose",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "f32le",
          "audio.pcm",
        ],
        { cwd: dir },
      );
      const pcm = await readFile(path.join(dir, "audio.pcm"));
      const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
      audio = audioEvidence(samples, 16000);
      if ((audio.rmsDbfs ?? -100) > -58) soundWindows = await recognizeSound(samples).catch(() => null);
      pauseShare = parseSilencedetect(log.stderr, duration).reduce((n, s) => n + s.end - s.start, 0) / duration;
      integratedLufs = integratedFromLog(log.stderr);
    }
    const subs = meta.streams.find(
      (s) => s.codec_type === "subtitle" && ["mov_text", "subrip", "webvtt", "ass", "ssa"].includes(s.codec_name ?? ""),
    );
    let cueWords: number | null = null;
    if (subs) {
      const { stdout } = await run("ffmpeg", [...read, "-map", "0:" + subs.index, "-f", "srt", "pipe:1"]);
      const counts = stdout
        .trim()
        .split(/\r?\n\s*\n/)
        .map(
          (s) =>
            s
              .split(/\r?\n/)
              .slice(2)
              .join(" ")
              .replace(/<[^>]*>|\{[^}]+\}/g, "")
              .trim()
              .split(/\s+/)
              .filter(Boolean).length,
        )
        .filter(Boolean);
      if (counts.length) cueWords = median(counts);
    }
    const source = {
      width: video.width,
      height: video.height,
      duration,
      fps: rational(video.avg_frame_rate ?? video.r_frame_rate),
      frameRate: video.avg_frame_rate ?? null,
      timeBase: video.time_base ?? null,
    };
    const evidence = makeReferenceEvidence({ source, visual, audio, integratedLufs });
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(input)) digest.update(chunk);
    const reference = describeReference(
      digest.digest("hex"),
      name,
      evidence,
      cueWords,
      pauseShare,
      visual.frames?.some((f) => f.luma != null)
        ? median(visual.frames.flatMap((f) => (f.luma == null ? [] : [f.luma])))
        : null,
    );
    reference.soundProfile = summarizeSound(soundWindows ?? []);
    return {
      soundEvents: { model: soundModel, windows: soundWindows },
      format: makeStyle([reference], id, name, "/formats/" + id + "/poster.jpg"),
      evidence,
      frames: keepFrames ? visual.frames : undefined,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
