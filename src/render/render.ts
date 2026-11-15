import { renderMedia } from "@remotion/renderer";
import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineError, readJson, type ProjectPaths } from "../pipeline/project";
import { ProbeSchema } from "../pipeline/schemas";
import { ffmpeg, ffprobeJson } from "../pipeline/util/exec";
import { exists, fingerprint, StepState, writeJsonIfChanged } from "../pipeline/util/state";
import { resolvedProject, type EdlTarget } from "./project";
import { browserExecutable, bundleReel, chromiumOptions, rendererFingerprint, renderDir, selectReel } from "./remotion";

/** Bump when the encoding or the audio finishing changes. */
const RENDER_VERSION = 1;

/** True peak ceiling after loudness normalization, dBTP. */
const TRUE_PEAK = -1;

export interface RenderOptions {
  browserExecutable?: string;
  concurrency?: number;
}

export interface RenderReport {
  output: string;
  skipped: boolean;
  frames: number;
  seconds: number;
  renderSeconds: number;
  loudness: { integrated: number; truePeak: number } | null;
}

interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
  output_i?: string;
  output_tp?: string;
  normalization_type?: string;
}

function parseLoudnorm(stderr: string): LoudnormStats {
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (!m) throw new PipelineError(`could not read loudnorm statistics from ffmpeg:\n${stderr.slice(-800)}`);
  return JSON.parse(m[0]) as LoudnormStats;
}

/**
 * Voice loudness: two-pass EBU R128 normalization to the EDL's target (docs/ARCHITECTURE.md:
 * "ffmpeg finalise l'audio"). The first pass measures, the second applies a linear gain when
 * the true peak allows it. The picture is copied untouched.
 */
async function finishAudio(input: string, output: string, targetLufs: number): Promise<{ integrated: number; truePeak: number; type: string }> {
  const filter = `loudnorm=I=${targetLufs}:TP=${TRUE_PEAK}:LRA=11`;
  const first = await ffmpeg(["-i", input, "-vn", "-af", `${filter}:print_format=json`, "-f", "null", "-"]);
  const m = parseLoudnorm(first.stderr);
  const second = await ffmpeg([
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0",
    "-c:v", "copy",
    "-af", `${filter}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`,
    "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    output,
  ]);
  const s = parseLoudnorm(second.stderr);
  return { integrated: Number(s.output_i), truePeak: Number(s.output_tp), type: s.normalization_type ?? "?" };
}

/**
 * `reels render <slug>`: validate, render the resolved EDL with Remotion, normalize the
 * voice, write out/<slug>.mp4. Skipped when nothing it depends on changed.
 */
export async function render(paths: ProjectPaths, target: EdlTarget, options: RenderOptions, log: (m: string) => void): Promise<RenderReport> {
  const edl = await resolvedProject(paths, target, log);
  const probe = await readJson(paths.probe, ProbeSchema, `run "reels ingest ${paths.slug}" first.`);
  const output = path.join(paths.out, `${target.name}.mp4`);
  const state = await StepState.load(paths.work, "render");
  const key = fingerprint(RENDER_VERSION, edl, probe.clips.map((c) => c.sha256), await rendererFingerprint());
  await writeJsonIfChanged(path.join(renderDir(paths), `${target.name}.resolved.json`), edl);
  const frames = edl.durationInFrames;
  if (state.get(`mp4:${target.name}`) === key && (await exists(output))) {
    log(`render: ${path.basename(output)} is up to date`);
    return { output, skipped: true, frames, seconds: frames / edl.fps, renderSeconds: 0, loudness: null };
  }

  const started = Date.now();
  const browser = browserExecutable(options.browserExecutable);
  const serveUrl = await bundleReel(paths, probe, log);
  const composition = await selectReel(serveUrl, edl, browser);
  const raw = path.join(renderDir(paths), `${target.name}.remotion.mp4`);
  let lastLog = 0;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 18,
    audioCodec: "aac",
    audioBitrate: "320k",
    outputLocation: raw,
    inputProps: { edl },
    browserExecutable: browser,
    chromiumOptions,
    concurrency: options.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2)),
    overwrite: true,
    logLevel: "error",
    onProgress: ({ renderedFrames, progress }) => {
      const now = Date.now();
      if (now - lastLog > 5000 || progress === 1) {
        lastLog = now;
        log(`  ${renderedFrames}/${frames} frames (${Math.round(progress * 100)} %)`);
      }
    },
  });
  const remotionSeconds = (Date.now() - started) / 1000;

  log(`normalizing the voice to ${edl.audio.voice.targetLufs} LUFS...`);
  await mkdir(paths.out, { recursive: true });
  const tmp = `${output}.tmp.mp4`;
  const loud = await finishAudio(raw, tmp, edl.audio.voice.targetLufs);
  await rename(tmp, output);
  await rm(raw, { force: true });

  // Check what was written.
  const info = (await ffprobeJson(["-select_streams", "v:0", "-count_packets", "-show_entries", "stream=width,height,r_frame_rate,nb_read_packets", output])) as {
    streams: { width: number; height: number; r_frame_rate: string; nb_read_packets: string }[];
  };
  const v = info.streams[0];
  if (!v || v.width !== edl.width || v.height !== edl.height || v.r_frame_rate !== `${edl.fps}/1` || Number(v.nb_read_packets) !== frames) {
    throw new PipelineError(`the rendered file does not match the EDL: ${JSON.stringify(v)} (expected ${edl.width}x${edl.height}, ${edl.fps} fps, ${frames} frames)`);
  }
  state.set(`mp4:${target.name}`, key);
  await state.save();
  const renderSeconds = (Date.now() - started) / 1000;
  log(`render: Remotion ${remotionSeconds.toFixed(1)} s, total ${renderSeconds.toFixed(1)} s; loudness ${loud.integrated} LUFS, true peak ${loud.truePeak} dBTP (${loud.type})`);
  return { output, skipped: false, frames, seconds: frames / edl.fps, renderSeconds, loudness: { integrated: loud.integrated, truePeak: loud.truePeak } };
}
