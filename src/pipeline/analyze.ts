import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { exists, fingerprint, sha256File, StepState, writeJsonIfChanged } from "./util/state";
import { ms, readJson, type ProjectPaths } from "./project";
import {
  ProbeSchema,
  TranscriptSchema,
  type Analysis,
  type ClipProbe,
  type Frame,
  type Loudness,
  type Shot,
  type Silence,
  type Sound,
  type TimedWord,
  type Transient,
} from "./schemas";
import { frameLevels, readWavMono16, silenceThreshold } from "./analysis/audio";
import { DEFAULT_REFINE, refineWordBounds } from "./analysis/align";
import { parseSilencedetect } from "./analysis/intervals";
import { cutsToShots, detectCuts, detectSilence, extractFrame, measureLoudness } from "./analysis/media";
import { crossAudioWithWords, DEFAULT_RETAKE, detectFillers, detectRetakes, groupSentences, type SpeechWord } from "./analysis/speech";
import type { StepLog } from "./ingest";

/** Bump when a rule below changes. */
const ANALYZE_VERSION = 2;
/** Bump when the expensive per-clip measurements (shots, loudness, silence map) change. */
const MEDIA_VERSION = 2;

export interface AnalyzeOptions {
  /** Shortest silence reported, seconds. */
  minSilence: number;
  /** Shortest sound without words reported, seconds. */
  minSound: number;
  /** Pause that ends a sentence even without punctuation, seconds. */
  sentenceGap: number;
  /** scdet threshold (0-100). */
  sceneThreshold: number;
  /** Two cuts closer than this around an unchanged picture are a transient, seconds. */
  minShot: number;
  /** Forces the silence threshold (dBFS) instead of measuring it per clip. */
  silenceDb: number | null;
}

export const DEFAULT_ANALYZE: AnalyzeOptions = {
  minSilence: 0.25,
  minSound: 0.08,
  sentenceGap: 1.0,
  sceneThreshold: 10,
  minShot: 0.5,
  silenceDb: null,
};

/** Granularity of the silence map handed to silencedetect: short pauses must show too. */
const SILENCE_MAP_MIN = 0.05;
/** Picture difference (0-255) under which two frames are "the same image". */
const SAME_PICTURE = 12;

const MediaFactsSchema = z.object({
  key: z.string(),
  duration: z.number(),
  silenceThresholdDb: z.number(),
  silent: z.array(z.object({ start: z.number(), end: z.number() })),
  shots: z.array(z.object({ start: z.number(), end: z.number(), cutScore: z.number().nullable() })),
  transients: z.array(z.object({ start: z.number(), end: z.number() })),
  loudness: z.object({ integratedLufs: z.number().nullable(), loudnessRange: z.number().nullable(), truePeakDb: z.number().nullable() }),
});
type MediaFacts = z.infer<typeof MediaFactsSchema>;

/** Expensive ffmpeg passes of one clip, cached in work/<clip>/media.json by source content. */
async function mediaFacts(paths: ProjectPaths, clip: ClipProbe, levels10ms: number[], options: AnalyzeOptions, state: StepState, log: StepLog): Promise<MediaFacts> {
  const video = path.join(paths.work, clip.normalized.video);
  const wav = path.join(paths.work, clip.normalized.audio);
  const cacheFile = path.join(paths.work, clip.id, "media.json");
  const key = fingerprint(MEDIA_VERSION, await state.hashFile(video), await state.hashFile(wav), options.sceneThreshold, options.minShot, options.silenceDb);
  try {
    const cached = MediaFactsSchema.parse(JSON.parse(await readFile(cacheFile, "utf8")));
    if (cached.key === key) {
      log(`${clip.id}: shots, loudness and silence map up to date`);
      return cached;
    }
  } catch {
    // no usable cache
  }
  log(`${clip.id}: measuring shots, loudness and silence...`);
  const duration = clip.normalized.duration;
  const silenceThresholdDb = options.silenceDb ?? silenceThreshold(levels10ms);
  const [cuts, loudness, silenceLog] = await Promise.all([
    detectCuts(video, options.sceneThreshold),
    measureLoudness(video),
    detectSilence(wav, silenceThresholdDb, SILENCE_MAP_MIN),
  ]);
  const { shots, transients } = await cutsToShots(video, clip.normalized.frames / 30, cuts, options.minShot, SAME_PICTURE);
  const facts: MediaFacts = {
    key,
    duration,
    silenceThresholdDb,
    silent: parseSilencedetect(silenceLog, duration).map((iv) => ({ start: ms(iv.start), end: ms(iv.end) })),
    shots,
    transients,
    loudness,
  };
  await writeJsonIfChanged(cacheFile, facts);
  return facts;
}

/** Key frame times: the middle of each sentence and just after each shot starts, on the 30 fps grid. */
function keyFrameRequests(clip: string, sentences: { id: string; start: number; end: number; clip: string }[], shots: Shot[], frames: number): { clip: string; index: number; reason: Frame["reason"]; ref: string }[] {
  const at = (t: number): number => Math.min(frames - 1, Math.max(0, Math.floor(t * 30)));
  const out: { clip: string; index: number; reason: Frame["reason"]; ref: string }[] = [];
  for (const s of sentences) if (s.clip === clip) out.push({ clip, index: at((s.start + s.end) / 2), reason: "sentence", ref: s.id });
  for (const sh of shots) if (sh.clip === clip) out.push({ clip, index: at(Math.min(sh.start + 0.5, (sh.start + sh.end) / 2)), reason: "shot", ref: sh.id });
  return out;
}

/**
 * `reels analyze <slug>`: transcript.json + normalized clips ──► work/analysis.json +
 * work/frames/*.jpg. Facts only; nothing here decides what to cut.
 */
export async function analyze(paths: ProjectPaths, options: AnalyzeOptions, log: StepLog): Promise<{ upToDate: boolean }> {
  const probe = await readJson(paths.probe, ProbeSchema, `run "reels ingest ${paths.slug}" first.`);
  const transcript = await readJson(paths.transcript, TranscriptSchema, `run "reels transcribe ${paths.slug}" first.`);
  const state = await StepState.load(paths.work, "analyze");

  const sources: string[] = [];
  for (const clip of probe.clips) {
    sources.push(await state.hashFile(path.join(paths.work, clip.normalized.video)), await state.hashFile(path.join(paths.work, clip.normalized.audio)));
  }
  const key = fingerprint(ANALYZE_VERSION, MEDIA_VERSION, await sha256File(paths.transcript), sources, options, DEFAULT_REFINE, DEFAULT_RETAKE);
  if (state.get("analysis") === key && (await exists(paths.analysis))) {
    const previous = (JSON.parse(await readFile(paths.analysis, "utf8")) as Analysis).frames ?? [];
    const missing = [];
    for (const f of previous) if (!(await exists(path.join(paths.work, f.file)))) missing.push(f);
    if (missing.length === 0) {
      log("analysis.json: up to date");
      await state.save();
      return { upToDate: true };
    }
  }

  const words: TimedWord[] = [];
  const silences: Omit<Silence, "id">[] = [];
  const sounds: Omit<Sound, "id">[] = [];
  const shots: Shot[] = [];
  const transients: Transient[] = [];
  const loudness: Loudness[] = [];
  const media = new Map<string, MediaFacts>();

  for (const clip of probe.clips) {
    const { samples, sampleRate } = await readWavMono16(path.join(paths.work, clip.normalized.audio));
    const levels10 = frameLevels(samples, sampleRate, 0.01);
    const facts = await mediaFacts(paths, clip, levels10, options, state, log);
    media.set(clip.id, facts);

    // Word bounds moved onto the audio energy where they touch a pause.
    const clipWords = transcript.words.filter((w) => w.clip === clip.id);
    const refined = refineWordBounds(clipWords, { levels: levels10, step: 0.01, thresholdDb: facts.silenceThresholdDb });
    const timed: TimedWord[] = clipWords.map((w, i) => {
      const r = refined[i] ?? w;
      const moved = r.start !== w.start || r.end !== w.end;
      return { id: w.id, clip: w.clip, text: w.text, start: r.start, end: r.end, ...(moved ? { raw: { start: w.start, end: w.end } } : {}) };
    });
    words.push(...timed);

    const crossed = crossAudioWithWords(clip.id, facts.duration, facts.silent, timed, levels10, options.minSilence, options.minSound);
    silences.push(...crossed.silences);
    sounds.push(...crossed.sounds);
    for (const s of facts.shots) shots.push({ id: `sh${shots.length + 1}`, clip: clip.id, ...s });
    for (const t of facts.transients) transients.push({ id: `tr${transients.length + 1}`, clip: clip.id, ...t });
    loudness.push({
      clip: clip.id,
      ...facts.loudness,
      silenceThresholdDb: facts.silenceThresholdDb,
      rms: { step: 0.1, db: frameLevels(samples, sampleRate, 0.1).map((d) => Math.round(d * 10) / 10) },
    });
  }

  const speech: SpeechWord[] = words;
  const sentences = groupSentences(speech, options.sentenceGap);
  const retakes = detectRetakes(speech, sentences);
  const inRetake = new Set<string>();
  for (const r of retakes) {
    const from = speech.findIndex((w) => w.id === r.attempt.from);
    const to = speech.findIndex((w) => w.id === r.attempt.to);
    for (let k = from; k <= to && k >= 0; k++) inRetake.add(speech[k]?.id ?? "");
  }
  const fillers = detectFillers(speech, inRetake);

  // Key frames: extract the missing ones, delete those no longer wanted.
  await mkdir(paths.frames, { recursive: true });
  const frames: Frame[] = [];
  const wanted = new Set<string>();
  for (const clip of probe.clips) {
    const sourceKey = await state.hashFile(path.join(paths.work, clip.normalized.video));
    if (state.get(`frames:${clip.id}`) !== sourceKey) {
      for (const f of await readdir(paths.frames)) if (f.startsWith(`${clip.id}-`)) await rm(path.join(paths.frames, f));
      state.set(`frames:${clip.id}`, sourceKey);
    }
    let extracted = 0;
    for (const req of keyFrameRequests(clip.id, sentences, shots, clip.normalized.frames)) {
      const name = `${clip.id}-f${String(req.index).padStart(6, "0")}.jpg`;
      const file = path.join("frames", name);
      if (!wanted.has(name) && !(await exists(path.join(paths.work, file)))) {
        // Middle of the frame's display interval, so the seek lands on that exact frame.
        await extractFrame(path.join(paths.work, clip.normalized.video), (req.index + 0.5) / 30, path.join(paths.work, file));
        extracted++;
      }
      wanted.add(name);
      frames.push({ id: `k${frames.length + 1}`, clip: clip.id, time: ms(req.index / 30), file, reason: req.reason, ref: req.ref });
    }
    if (extracted > 0) log(`${clip.id}: ${extracted} key frame(s) extracted`);
  }
  for (const f of await readdir(paths.frames)) if (!wanted.has(f)) await rm(path.join(paths.frames, f));

  const analysis: Analysis = {
    version: 1,
    params: {
      minSilence: options.minSilence,
      minSound: options.minSound,
      minShot: options.minShot,
      sentenceGap: options.sentenceGap,
      retakeWindow: DEFAULT_RETAKE.window,
      sceneThreshold: options.sceneThreshold,
    },
    words,
    silences: silences.map((s, i) => ({ id: `sil${i + 1}`, ...s })),
    sounds: sounds.map((s, i) => ({ id: `snd${i + 1}`, ...s })),
    shots,
    transients,
    loudness,
    fillers,
    retakes,
    sentences,
    frames,
  };
  const written = await writeJsonIfChanged(paths.analysis, analysis);
  state.set("analysis", key);
  await state.save();
  log(
    `analysis.json${written ? "" : " (unchanged)"}: ${sentences.length} sentences, ${analysis.silences.length} silences, ${sounds.length} sounds, ` +
      `${shots.length} shots, ${fillers.length} fillers, ${retakes.length} retakes, ${frames.length} key frames, ` +
      `${words.filter((w) => w.raw).length}/${words.length} word bounds moved onto the audio`,
  );
  return { upToDate: false };
}
