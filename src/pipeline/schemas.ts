import { z } from "zod";

/**
 * Formats of the files written by the "facts" steps (docs/ARCHITECTURE.md, Ingest,
 * Transcribe, Analyze). All times are seconds in the normalized clip.
 */

const seconds = z.number().nonnegative();

// ---------------------------------------------------------------- probe.json (ingest)

export const RawProbeSchema = z.object({
  codec: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** Display rotation found in the metadata, degrees counter-clockwise (0, 90, 180, 270). */
  rotation: z.number(),
  /** Average frame rate (frames / duration). */
  fps: z.number(),
  /** Nominal frame rate declared by the container. */
  nominalFps: z.number(),
  variableFrameRate: z.boolean(),
  /** Shortest and longest interval between two frames, seconds. */
  frameInterval: z.object({ min: z.number(), max: z.number() }),
  duration: seconds,
  audio: z.object({ codec: z.string(), sampleRate: z.number().int(), channels: z.number().int() }).nullable(),
});

export const NormalizedProbeSchema = z.object({
  /** Relative to work/. */
  video: z.string(),
  /** Relative to work/: mono 16 kHz PCM extracted from `video`, for Whisper and analysis. */
  audio: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  fps: z.literal(30),
  frames: z.number().int(),
  duration: seconds,
  audioSampleRate: z.literal(48000),
});

export const ClipProbeSchema = z.object({
  id: z.string().regex(/^c\d+$/),
  /** File name in raw/. */
  file: z.string(),
  sha256: z.string(),
  raw: RawProbeSchema,
  normalized: NormalizedProbeSchema,
});

export const ProbeSchema = z.object({
  version: z.literal(1),
  clips: z.array(ClipProbeSchema),
});

export type RawProbe = z.infer<typeof RawProbeSchema>;
export type ClipProbe = z.infer<typeof ClipProbeSchema>;
export type Probe = z.infer<typeof ProbeSchema>;

// ---------------------------------------------------------------- transcript.json

export const WordSchema = z.object({
  id: z.string().regex(/^w\d+$/),
  clip: z.string(),
  text: z.string(),
  start: seconds,
  end: seconds,
  confidence: z.number().min(0).max(1),
});

export const TranscriptSchema = z.object({
  language: z.string(),
  engine: z.object({ name: z.string(), model: z.string() }),
  words: z.array(WordSchema),
});

export type Word = z.infer<typeof WordSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;

// ---------------------------------------------------------------- analysis.json

const span = { clip: z.string(), start: seconds, end: seconds };

export const TimedWordSchema = z.object({
  id: z.string(),
  ...span,
  text: z.string(),
  /** Whisper's own bounds, present only when analyze moved them onto the audio energy. */
  raw: z.object({ start: seconds, end: seconds }).optional(),
});

export const SilenceSchema = z.object({
  id: z.string(),
  ...span,
  duration: seconds,
  /** Word ending right before the silence and word starting right after it (null at clip edges). */
  after: z.string().nullable(),
  before: z.string().nullable(),
});

export const SoundSchema = z.object({
  id: z.string(),
  ...span,
  duration: seconds,
  /** Loudest 10 ms frame inside the interval, dBFS. */
  peakDb: z.number(),
  /**
   * Silence on both sides (a clap, a breath, an untranscribed "euh"). When false the
   * sound touches a word and is usually the word itself running past Whisper's bounds.
   */
  isolated: z.boolean(),
});

export const ShotSchema = z.object({
  id: z.string(),
  ...span,
  /** scdet score of the cut that opens the shot (0-100); null for the first shot of a clip. */
  cutScore: z.number().nullable(),
});

/** Brief picture changes that come back to the same image (flash, glitch): not shots. */
export const TransientSchema = z.object({ id: z.string(), ...span });

export const LoudnessSchema = z.object({
  clip: z.string(),
  integratedLufs: z.number().nullable(),
  loudnessRange: z.number().nullable(),
  truePeakDb: z.number().nullable(),
  /** Threshold below which a 10 ms frame counts as silent for this clip, dBFS. */
  silenceThresholdDb: z.number(),
  rms: z.object({ step: z.literal(0.1), db: z.array(z.number()) }),
});

export const FillerSchema = z.object({
  id: z.string(),
  ...span,
  kind: z.enum(["hesitation", "discourse", "repetition"]),
  text: z.string(),
  words: z.array(z.string()).min(1),
});

export const RetakeSchema = z.object({
  id: z.string(),
  clip: z.string(),
  /** The abandoned attempt: from its first word to the word before the restart. */
  attempt: z.object({ from: z.string(), to: z.string(), start: seconds, end: seconds, text: z.string() }),
  /** First word of the new attempt. */
  restart: z.object({ from: z.string(), start: seconds }),
  /** Number of identical words the two attempts start with. */
  matchedWords: z.number().int().positive(),
});

export const SentenceSchema = z.object({
  id: z.string(),
  ...span,
  from: z.string(),
  to: z.string(),
  text: z.string(),
  wordCount: z.number().int().positive(),
});

export const FrameSchema = z.object({
  id: z.string(),
  clip: z.string(),
  time: seconds,
  /** Relative to work/. */
  file: z.string(),
  reason: z.enum(["sentence", "shot"]),
  ref: z.string(),
});

export const AnalysisSchema = z.object({
  version: z.literal(1),
  params: z.object({
    minSilence: z.number(),
    minSound: z.number(),
    minShot: z.number(),
    sentenceGap: z.number(),
    retakeWindow: z.number(),
    sceneThreshold: z.number(),
  }),
  words: z.array(TimedWordSchema),
  silences: z.array(SilenceSchema),
  sounds: z.array(SoundSchema),
  shots: z.array(ShotSchema),
  transients: z.array(TransientSchema),
  loudness: z.array(LoudnessSchema),
  fillers: z.array(FillerSchema),
  retakes: z.array(RetakeSchema),
  sentences: z.array(SentenceSchema),
  frames: z.array(FrameSchema),
});

export type TimedWord = z.infer<typeof TimedWordSchema>;
export type Silence = z.infer<typeof SilenceSchema>;
export type Sound = z.infer<typeof SoundSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type Transient = z.infer<typeof TransientSchema>;
export type Loudness = z.infer<typeof LoudnessSchema>;
export type Filler = z.infer<typeof FillerSchema>;
export type Retake = z.infer<typeof RetakeSchema>;
export type Sentence = z.infer<typeof SentenceSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
