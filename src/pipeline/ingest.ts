import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, ffprobeJson, run } from "./util/exec";
import { exists, fingerprint, StepState, writeJsonIfChanged } from "./util/state";
import { listRawVideos, ms, PipelineError, type ProjectPaths } from "./project";
import { ProbeSchema, type ClipProbe, type Probe, type RawProbe } from "./schemas";

/** Bump when the normalization changes: every clip is then re-encoded. */
const INGEST_VERSION = 1;

export const TARGET_FPS = 30;
export const TARGET_AUDIO_RATE = 48000;
export const ANALYSIS_AUDIO_RATE = 16000;

/** Video filter: constant 30 fps (duplicates/drops frames by timestamp), even size, square pixels. */
const VIDEO_FILTER = `fps=${TARGET_FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p`;
const ENCODE = {
  video: ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", "15", "-fps_mode", "cfr"],
  audio: ["-c:a", "aac", "-b:a", "192k", "-ar", String(TARGET_AUDIO_RATE)],
  // No -avoid_negative_ts: it shifts the streams' start times apart (0.066 s video vs
  // 0.045 s audio measured), and audio.wav would then lose that offset.
  container: ["-movflags", "+faststart", "-map_metadata", "-1"],
};

export interface StepLog {
  (message: string): void;
}

/**
 * Gives every raw file a stable clip id. Files already known keep theirs; new files get
 * the next unused number, in name order. Ids of removed files are never reused.
 */
export function assignClipIds(
  files: readonly string[],
  known: readonly { file: string; id: string }[],
  nextNumber: number,
): { ids: Map<string, string>; nextNumber: number } {
  const ids = new Map<string, string>();
  let next = nextNumber;
  for (const k of known) {
    next = Math.max(next, Number(k.id.slice(1)) + 1);
  }
  for (const file of files) {
    const prior = known.find((k) => k.file === file);
    if (prior) {
      ids.set(file, prior.id);
    }
  }
  for (const file of files) {
    if (!ids.has(file)) {
      ids.set(file, `c${next}`);
      next += 1;
    }
  }
  return { ids, nextNumber: next };
}

function parseRate(rate: unknown): number {
  if (typeof rate !== "string") return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

interface FfStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  nb_read_packets?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

interface FfProbe {
  streams?: FfStream[];
  format?: { duration?: string };
}

/** Rotation the player must apply, degrees counter-clockwise, normalised to 0/90/180/270. */
function rotationOf(stream: FfStream): number {
  const fromMatrix = stream.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation;
  const fromTag = stream.tags?.rotate !== undefined ? -Number(stream.tags.rotate) : undefined;
  const value = fromMatrix ?? fromTag ?? 0;
  return (((Math.round(value / 90) * 90) % 360) + 360) % 360;
}

async function frameIntervals(file: string): Promise<{ min: number; max: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file]);
  const pts = stdout
    .split("\n")
    .map((l) => Number.parseFloat(l))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i] ?? 0) - (pts[i - 1] ?? 0);
    if (d <= 0) continue;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min: Number.isFinite(min) ? ms(min) : 0, max: ms(max) };
}

export async function probeRaw(file: string): Promise<RawProbe> {
  const data = (await ffprobeJson(["-show_streams", "-show_format", file])) as FfProbe;
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video) {
    throw new PipelineError(`${path.basename(file)} has no video stream.`);
  }
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const intervals = await frameIntervals(file);
  const duration = Number(data.format?.duration ?? video.duration ?? 0);
  return {
    codec: video.codec_name ?? "unknown",
    width: video.width ?? 0,
    height: video.height ?? 0,
    rotation: rotationOf(video),
    fps: ms(parseRate(video.avg_frame_rate)),
    nominalFps: ms(parseRate(video.r_frame_rate)),
    // Phones jitter by a few hundred microseconds even at "constant" rate; 2 ms is a real change.
    variableFrameRate: intervals.max - intervals.min > 0.002,
    frameInterval: intervals,
    duration: ms(duration),
    audio: audio
      ? { codec: audio.codec_name ?? "unknown", sampleRate: Number(audio.sample_rate ?? 0), channels: audio.channels ?? 0 }
      : null,
  };
}

async function normalizeClip(rawFile: string, raw: RawProbe, clipDir: string): Promise<void> {
  await mkdir(clipDir, { recursive: true });
  const video = path.join(clipDir, "source.mp4");
  const wav = path.join(clipDir, "audio.wav");
  const tmpVideo = path.join(clipDir, "source.tmp.mp4");

  // ffmpeg applies the display rotation itself while filtering (autorotate, on by default)
  // and writes no rotation on the output.
  const inputs = ["-i", rawFile];
  const maps = ["-map", "0:v:0"];
  const audioArgs: string[] = [...ENCODE.audio];
  if (raw.audio) {
    maps.push("-map", "0:a:0");
    // Fill holes/drift in the source audio so it stays aligned with the video timeline.
    audioArgs.push("-af", "aresample=async=1:first_pts=0");
    if (raw.audio.channels > 2) audioArgs.push("-ac", "2");
  } else {
    inputs.push("-f", "lavfi", "-i", `anullsrc=r=${TARGET_AUDIO_RATE}:cl=mono`);
    maps.push("-map", "1:a:0", "-shortest");
  }
  await ffmpeg([
    ...inputs,
    ...maps,
    "-vf",
    VIDEO_FILTER,
    ...ENCODE.video,
    ...audioArgs,
    ...ENCODE.container,
    tmpVideo,
  ]);
  // Encoded under a temporary name: an interrupted run never leaves a truncated source.mp4.
  await rename(tmpVideo, video);

  // Whisper and analysis read the audio of the normalized file: same timeline as the video.
  await ffmpeg(["-i", video, "-map", "0:a:0", "-ac", "1", "-ar", String(ANALYSIS_AUDIO_RATE), "-c:a", "pcm_s16le", wav]);
}

async function probeNormalized(work: string, clipId: string): Promise<ClipProbe["normalized"]> {
  const video = path.join(clipId, "source.mp4");
  const audio = path.join(clipId, "audio.wav");
  const file = path.join(work, video);
  const data = (await ffprobeJson(["-count_packets", "-show_streams", "-show_format", file])) as FfProbe;
  const v = data.streams?.find((s) => s.codec_type === "video");
  const a = data.streams?.find((s) => s.codec_type === "audio");
  const fps = parseRate(v?.avg_frame_rate);
  const rate = Number(a?.sample_rate ?? 0);
  if (!v || Math.abs(fps - TARGET_FPS) > 1e-6 || parseRate(v.r_frame_rate) !== TARGET_FPS) {
    throw new PipelineError(`Normalization of ${clipId} did not produce constant ${TARGET_FPS} fps (got ${v?.avg_frame_rate}).`);
  }
  if (rate !== TARGET_AUDIO_RATE) {
    throw new PipelineError(`Normalization of ${clipId} did not produce ${TARGET_AUDIO_RATE} Hz audio (got ${rate}).`);
  }
  if (rotationOf(v) !== 0) {
    throw new PipelineError(`Normalized ${clipId} still carries a rotation of ${rotationOf(v)} degrees.`);
  }
  return {
    video,
    audio,
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: TARGET_FPS,
    frames: Number(v.nb_read_packets ?? 0),
    duration: ms(Number(data.format?.duration ?? 0)),
    audioSampleRate: TARGET_AUDIO_RATE,
  };
}

async function readProbe(file: string): Promise<Probe | null> {
  try {
    return ProbeSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * `reels ingest <slug>`: raw/* ──► work/<clip>/source.mp4 + work/<clip>/audio.wav + work/probe.json.
 * Only new or changed raw files are re-encoded.
 */
export async function ingest(paths: ProjectPaths, log: StepLog): Promise<{ processed: string[]; skipped: string[] }> {
  const files = await listRawVideos(paths.raw);
  if (files.length === 0) {
    throw new PipelineError(`No video in ${paths.raw}.`);
  }
  await mkdir(paths.work, { recursive: true });
  const state = await StepState.load(paths.work, "ingest");
  const previous = await readProbe(paths.probe);
  const { ids, nextNumber } = assignClipIds(files, previous?.clips ?? [], Number(state.get("nextClipNumber") ?? 1));
  state.set("nextClipNumber", String(nextNumber));

  const clips: ClipProbe[] = [];
  const processed: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const id = ids.get(file);
    if (!id) throw new Error("unreachable: every file has an id");
    const rawFile = path.join(paths.raw, file);
    const sha256 = await state.hashFile(rawFile);
    const key = fingerprint(INGEST_VERSION, sha256, VIDEO_FILTER, ENCODE);
    const prior = previous?.clips.find((c) => c.id === id);
    const outputsExist =
      (await exists(path.join(paths.work, id, "source.mp4"))) && (await exists(path.join(paths.work, id, "audio.wav")));
    if (prior && prior.sha256 === sha256 && state.get(`clip:${id}`) === key && outputsExist) {
      clips.push({ ...prior, file });
      skipped.push(id);
      log(`${id} (${file}): up to date`);
      continue;
    }
    log(`${id} (${file}): normalizing...`);
    const raw = await probeRaw(rawFile);
    await normalizeClip(rawFile, raw, path.join(paths.work, id));
    const normalized = await probeNormalized(paths.work, id);
    clips.push({ id, file, sha256, raw, normalized });
    state.set(`clip:${id}`, key);
    processed.push(id);
    log(
      `${id}: ${raw.width}x${raw.height} rot ${raw.rotation}° ${raw.variableFrameRate ? "VFR" : "CFR"} ${raw.fps} fps ──► ` +
        `${normalized.width}x${normalized.height} ${normalized.fps} fps CFR, ${normalized.frames} frames, ${normalized.duration} s`,
    );
  }

  // Clips whose raw file disappeared: forget them.
  const live = new Set(clips.map((c) => c.id));
  for (const key of state.keys()) {
    const m = /^clip:(c\d+)$/.exec(key);
    if (m?.[1] && !live.has(m[1])) {
      state.delete(key);
      await rm(path.join(paths.work, m[1]), { recursive: true, force: true });
      log(`${m[1]}: raw file removed, dropped`);
    }
  }

  clips.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  await writeJsonIfChanged(paths.probe, { version: 1, clips } satisfies Probe);
  await state.save();
  return { processed, skipped };
}
