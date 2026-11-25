import { z } from "zod";

/** Keep the input's presentation clock and decode every frame. Spatial reduction bounds pixel work. */
export const REFERENCE_FRAME_FILTER = "scale=144:-2,format=yuv444p,scdet=threshold=8,signalstats";

const unit = z.number().min(0).max(1);
const byte = z.number().min(0).max(255).nullable();
const sat = z.number().min(0).max(182).nullable();
const seconds = z.number().nonnegative();
const score = z.number().min(0).max(100);
const confidenceBasis = "Heuristic evidence strength, uncalibrated" as const;

export const ReferenceSourceSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().positive(),
  fps: z.number().positive().nullable(),
  frameRate: z.string().max(60).nullable().optional(),
  timeBase: z.string().max(60).nullable().optional(),
});
export type ReferenceSource = z.infer<typeof ReferenceSourceSchema>;

export const FrameRecordSchema = z.object({
  index: z.number().int().nonnegative(),
  ptsTicks: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  sourcePts: z.number(),
  at: seconds,
  score: score.nullable(),
  luma: byte,
  shadows: byte,
  highlights: byte,
  chromaU: byte,
  chromaV: byte,
  saturation: sat,
  delta: byte,
});
export type FrameRecord = z.infer<typeof FrameRecordSchema>;

const CutSchema = z.object({
  at: seconds,
  sourcePts: z.number(),
  score: score.nullable(),
  confidence: unit,
  status: z.literal("inferred"),
  basis: z.enum(["scdet", "abrupt picture change"]),
});
const TransitionSchema = z
  .object({
    kind: z.enum(["flash", "fade-in", "fade-out"]),
    start: seconds,
    end: seconds,
    confidence: unit,
    status: z.literal("inferred"),
    basis: z.string().min(1),
  })
  .refine((t) => t.end > t.start, "Transition ends before its start");

const VisualSummarySchema = z.object({
  frameCount: z.number().int().positive(),
  firstPts: z.number(),
  lastPts: z.number(),
  analyzedSeconds: seconds,
  coveredSeconds: seconds,
  missingFrameNumbers: z.number().int().nonnegative(),
  medianFrameInterval: z.number().positive().nullable(),
  cutThreshold: score,
  cuts: z.array(CutSchema),
  transitions: z.array(TransitionSchema),
  color: z.object({
    luma: byte,
    shadows: byte,
    highlights: byte,
    contrast: byte,
    chromaU: byte,
    chromaV: byte,
    saturation: sat,
  }),
  motion: z.object({ median: byte, p90: byte }),
});
export const FrameEvidenceSchema = VisualSummarySchema.extend({ frames: z.array(FrameRecordSchema).optional() });
export type FrameEvidence = z.infer<typeof FrameEvidenceSchema>;
type Transition = z.infer<typeof TransitionSchema>;

const OnsetSchema = z.object({ at: seconds, strength: unit });
type Onset = z.infer<typeof OnsetSchema>;
const TempoSchema = z.object({ bpm: z.number().min(55).max(190), confidence: unit, status: z.literal("inferred") });
export const AudioEvidenceSchema = z.object({
  duration: seconds,
  sampleRate: z.number().int().positive(),
  samples: z.number().int().nonnegative(),
  rmsDbfs: z.number().nullable(),
  samplePeakDbfs: z.number().nullable(),
  clippedSamples: z.number().int().nonnegative(),
  clippedShare: unit,
  envelopeStep: z.number().positive(),
  envelope: z.array(z.number().nullable()),
  onsetStep: z.number().positive(),
  onsets: z.array(OnsetSchema),
  tempo: TempoSchema.nullable(),
});
export type AudioEvidence = z.infer<typeof AudioEvidenceSchema>;

export const ReferenceEvidenceSchema = z.object({
  version: z.literal(1),
  source: ReferenceSourceSchema,
  visual: VisualSummarySchema,
  audio: AudioEvidenceSchema.nullable(),
  integratedLufs: z.number().nullable(),
  unknowns: z.array(z.string()),
  provenance: z.object({
    visual: z.literal("FFmpeg scdet and signalstats, native presentation timestamps, 8-bit YUV proxy"),
    audio: z.literal("Decoded mono PCM, RMS and sample peaks"),
    loudness: z.literal("EBU R128 measurement").nullable(),
    confidence: z.literal(confidenceBasis),
  }),
});
export type ReferenceEvidence = z.infer<typeof ReferenceEvidenceSchema>;

const rounded = (x: number, digits = 4) => Number(x.toFixed(digits));
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lo = Math.floor(index);
  return sorted[lo]! + (index - lo) * (sorted[Math.ceil(index)]! - sorted[lo]!);
}
function median(values: number[]): number {
  return quantile(values, 0.5) ?? 0;
}

const stats = {
  "scd.score": "score",
  "signalstats.YAVG": "luma",
  "signalstats.YLOW": "shadows",
  "signalstats.YHIGH": "highlights",
  "signalstats.UAVG": "chromaU",
  "signalstats.VAVG": "chromaV",
  "signalstats.SATAVG": "saturation",
  "signalstats.YDIF": "delta",
} as const;
type StatKey = (typeof stats)[keyof typeof stats];
const statByKey = new Map<string, StatKey>(Object.entries(stats));
const numberPattern = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const header = new RegExp("\\bframe:\\s*(\\d+)\\s+pts:\\s*(-?\\d+|N/A|NOPTS)\\s+pts_time:\\s*(" + numberPattern + ")");
const metadata = new RegExp(
  "\\blavfi\\.(scd\\.score|signalstats\\.(?:YAVG|YLOW|YHIGH|UAVG|VAVG|SATAVG|YDIF))=(" + numberPattern + ")",
);

/** Parse the metadata filter's file output without allocating a second array of all its text lines. */
function readFrameRecords(text: string): FrameRecord[] {
  const rows: FrameRecord[] = [];
  let current: FrameRecord | undefined;
  let pos = 0;
  while (pos < text.length) {
    const newline = text.indexOf("\n", pos);
    const line = text.slice(pos, newline < 0 ? text.length : newline);
    pos = newline < 0 ? text.length : newline + 1;
    const match = line.includes("pts_time:") ? header.exec(line) : null;
    if (match) {
      const index = Number(match[1]),
        sourcePts = Number(match[3]);
      if (!Number.isSafeInteger(index) || !Number.isFinite(sourcePts)) throw Error("Invalid decoded frame timestamp.");
      if (current && (sourcePts < current.sourcePts - 1e-8 || index <= current.index)) {
        throw Error("Reference frame records are out of presentation order.");
      }
      const origin = rows[0]?.sourcePts ?? sourcePts;
      current = {
        index,
        ptsTicks: /^-?\d+$/.test(match[2]!) ? match[2]! : null,
        sourcePts,
        at: rounded(Math.max(0, sourcePts - origin), 7),
        score: null,
        luma: null,
        shadows: null,
        highlights: null,
        chromaU: null,
        chromaV: null,
        saturation: null,
        delta: null,
      };
      rows.push(current);
      continue;
    }
    if (!current || !line.includes("lavfi.")) continue;
    const value = metadata.exec(line);
    if (!value) continue;
    const key = statByKey.get(value[1]!);
    const n = Number(value[2]);
    if (key && Number.isFinite(n) && n >= 0 && n <= (key === "score" ? 100 : key === "saturation" ? 182 : 255))
      current[key] = n;
  }
  if (!rows.length || !rows.some((r) => r.luma !== null || r.score !== null))
    throw Error("No usable FFmpeg frame measurements.");
  return rows;
}

/** Similarity of measured frame averages. This cannot identify whether two pictures depict the same subject. */
function appearanceDistance(a: FrameRecord, b: FrameRecord): number | null {
  if (a.luma === null || b.luma === null) return null;
  const uc = a.chromaU !== null && b.chromaU !== null ? Math.abs(a.chromaU - b.chromaU) : 0;
  const vc = a.chromaV !== null && b.chromaV !== null ? Math.abs(a.chromaV - b.chromaV) : 0;
  return Math.abs(a.luma - b.luma) + 0.34 * (uc + vc);
}

/** A brief extreme brightness excursion that returns towards its prior appearance. */
function flashes(rows: FrameRecord[]): { transitions: Transition[]; edges: Set<number> } {
  const transitions: Transition[] = [];
  const edges = new Set<number>();
  for (let i = 1; i < rows.length - 1; i++) {
    const prior = rows[i - 1]!,
      head = rows[i]!;
    if (prior.luma === null || head.luma === null || head.luma - prior.luma < 38 || head.luma < 154) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const tail = rows[j]!,
        dt = tail.at - head.at;
      if (dt > 0.34) break;
      if (dt <= 0 || tail.luma === null || head.luma - tail.luma < 34) continue;
      const distance = appearanceDistance(prior, tail);
      if (distance === null || distance > 13) continue;
      const confidence = clamp(0.59 + (head.luma - prior.luma) / 600 + (13 - distance) / 110, 0.59, 0.9);
      transitions.push({
        kind: "flash",
        start: head.at,
        end: tail.at,
        confidence: rounded(confidence),
        status: "inferred",
        basis: "Brief rise in measured luma followed by a return to similar pre-event YUV averages.",
      });
      edges.add(i);
      edges.add(j);
      i = j;
      break;
    }
  }
  return { transitions, edges };
}

/** Identify gradual dark-ended luminance ramps. Exposure changes can produce the same signal. */
function fades(rows: FrameRecord[], direction: 1 | -1): Transition[] {
  const found: Transition[] = [];
  let beginning = -1,
    last = -1,
    steps = 0;
  const finish = () => {
    if (beginning >= 0 && last > beginning && steps >= 3) {
      const a = rows[beginning]!,
        b = rows[last]!,
        dt = b.at - a.at;
      const shift = direction * (b.luma! - a.luma!);
      const black = direction === 1 ? a.luma! : b.luma!;
      if (dt >= 0.115 && dt <= 3 && black <= 37 && shift >= 28) {
        found.push({
          kind: direction === 1 ? "fade-in" : "fade-out",
          start: a.at,
          end: b.at,
          confidence: rounded(
            clamp(0.45 + Math.min(steps, 14) / 70 + Math.min(shift, 128) / 800 + (37 - black) / 280, 0.45, 0.88),
          ),
          status: "inferred",
          basis: "Sustained directional luma ramp with a dark endpoint. Camera exposure can produce this pattern.",
        });
      }
    }
    beginning = -1;
    last = -1;
    steps = 0;
  };
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!,
      next = rows[i]!;
    if (prev.luma === null || next.luma === null) {
      finish();
      continue;
    }
    const d = direction * (next.luma - prev.luma);
    if (d < -0.65 || d > 28 || next.at - prev.at > 0.55) {
      finish();
      continue;
    }
    if (d >= 0.4) {
      if (beginning < 0) beginning = i - 1;
      last = i;
      steps++;
    } else if (last >= 0 && next.at - rows[last]!.at > 0.15) finish();
  }
  finish();
  return found;
}

function summarizeColor(rows: FrameRecord[], duration: number, interval: number | null) {
  const keys = ["luma", "shadows", "highlights", "contrast", "chromaU", "chromaV", "saturation"] as const;
  type Key = (typeof keys)[number];
  const output = {} as Record<Key, number | null>;
  for (const key of keys) {
    let sum = 0,
      weight = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const v =
        key === "contrast"
          ? r.shadows !== null && r.highlights !== null
            ? Math.max(0, r.highlights - r.shadows)
            : null
          : r[key];
      if (v === null) continue;
      const next = rows[i + 1]?.at ?? Math.min(duration, r.at + (interval ?? duration));
      const span = Math.max(0, Math.min(duration, next) - r.at);
      sum += span * v;
      weight += span;
    }
    output[key] = weight > 0 ? rounded(sum / weight) : null;
  }
  return output;
}

export function frameEvidence(
  text: string,
  analyzedSeconds: number,
  options: { keepFrames?: boolean } = {},
): FrameEvidence {
  if (!Number.isFinite(analyzedSeconds) || analyzedSeconds <= 0)
    throw Error("Reference analysis duration must be positive.");
  const rows = readFrameRecords(text);
  const spans = rows
    .slice(1)
    .map((f, i) => f.at - rows[i]!.at)
    .filter((d) => d > 0);
  const interval = quantile(spans, 0.5);
  const changes = rows.slice(1).flatMap((r) => (r.score === null ? [] : [r.score]));
  const base = median(changes);
  const threshold =
    changes.length < 8
      ? 8
      : rounded(clamp(base + 5 * Math.max(0.4, median(changes.map((s) => Math.abs(s - base)))), 8, 26));
  const flash = flashes(rows);
  const cuts: z.infer<typeof CutSchema>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (flash.edges.has(i) || r.at <= 0 || r.at >= analyzedSeconds) continue;
    const sc = r.score ?? 0;
    const jump = appearanceDistance(rows[i - 1]!, r) ?? 0;
    // scdet can suppress the second of two equally large consecutive changes.
    const abrupt = (r.delta ?? 0) >= 45 && jump >= 37;
    if (sc < threshold && !abrupt) continue;
    const confidence =
      sc >= threshold
        ? clamp(0.52 + (sc - threshold) / 65 + Math.min(jump, 70) / 450, 0.52, 0.98)
        : clamp(0.48 + jump / 380, 0.5, 0.83);
    cuts.push({
      at: r.at,
      sourcePts: r.sourcePts,
      score: r.score,
      confidence: rounded(confidence),
      status: "inferred",
      basis: sc >= threshold ? "scdet" : "abrupt picture change",
    });
  }
  const deltas = rows.slice(1).flatMap((r) => (r.delta === null ? [] : [r.delta]));
  const last = rows.at(-1)!;
  return {
    frameCount: rows.length,
    firstPts: rows[0]!.sourcePts,
    lastPts: last.sourcePts,
    analyzedSeconds,
    coveredSeconds: rounded(Math.min(analyzedSeconds, last.at + (interval ?? 0)), 7),
    missingFrameNumbers: Math.max(0, last.index - rows[0]!.index + 1 - rows.length),
    medianFrameInterval: interval,
    cutThreshold: threshold,
    cuts,
    transitions: [...flash.transitions, ...fades(rows, 1), ...fades(rows, -1)]
      .filter((t) => t.end <= analyzedSeconds)
      .sort((a, b) => a.start - b.start),
    color: summarizeColor(rows, analyzedSeconds, interval),
    motion: { median: quantile(deltas, 0.5), p90: quantile(deltas, 0.9) },
    ...(options.keepFrames ? { frames: rows } : {}),
  };
}

/** Report silence as null dBFS (negative infinity), never as zero dBFS. */
function dbfs(amplitude: number): number | null {
  return amplitude > 0 ? rounded(20 * Math.log10(amplitude), 3) : null;
}

function findOnsets(levels: number[], step: number): Onset[] {
  if (levels.length < 2) return [];
  // Compare each window to a short trailing envelope. A single transient should yield one event.
  let floor = -96;
  const novelty = levels.map((value) => {
    const rise = Math.max(0, value - floor);
    floor += (value >= floor ? 0.72 : 0.32) * (value - floor);
    return rise;
  });
  const middle = median(novelty);
  const threshold = Math.max(3.4, middle + 3.2 * median(novelty.map((v) => Math.abs(v - middle))));
  const audibility = Math.max(-62, (quantile(levels, 0.85) ?? -60) - 33);
  const selected: { index: number; rise: number }[] = [];
  for (let i = 0; i < novelty.length; i++) {
    const rise = novelty[i]!;
    if (levels[i]! < audibility || rise < threshold || rise < (novelty[i - 1] ?? 0) || rise < (novelty[i + 1] ?? 0))
      continue;
    const prev = selected.at(-1);
    if (prev && (i - prev.index) * step < 0.105) {
      if (rise > prev.rise) {
        prev.index = i;
        prev.rise = rise;
      }
    } else selected.push({ index: i, rise });
  }
  return selected.map((s) => ({
    at: rounded(s.index * step, 6),
    strength: rounded(clamp(s.rise / (3 * threshold), 0, 1)),
  }));
}

/** Estimate a stable pulse from adjacent onset intervals. Silence, sparse or irregular audio can return null. */
function estimateTempo(onsets: Onset[]): AudioEvidence["tempo"] {
  if (onsets.length < 6 || onsets.at(-1)!.at - onsets[0]!.at < 2.15) return null;
  const periods = onsets
    .slice(1)
    .map((p, i) => p.at - onsets[i]!.at)
    .filter((t) => t >= 0.2 && t <= 2.2);
  if (periods.length < 5 || periods.length / (onsets.length - 1) < 0.62) return null;
  // Uniformly sample long files for the tempo search. Keep every detected onset in the output.
  const stride = Math.max(1, Math.ceil(periods.length / 4096));
  const evaluated = periods.filter((_, i) => i % stride === 0);
  let bestScore = 0,
    bestBpm = 0,
    bestDirect = 0;
  for (let bpm = 60; bpm <= 180; bpm++) {
    const beat = 60 / bpm;
    let support = 0,
      direct = 0;
    for (const t of evaluated) {
      const count = Math.round(t / beat);
      if (count < 1 || count > 5) continue;
      const fit = 1 - Math.min(1, Math.abs(t / beat - count) / 0.145);
      support += fit;
      if (count === 1) direct += fit;
    }
    // Prefer the beat interval actually present over its doubled subdivision.
    const level = (support * 0.76 + direct * 0.24) / evaluated.length;
    if (level > bestScore) {
      bestScore = level;
      bestBpm = bpm;
      bestDirect = direct / evaluated.length;
    }
  }
  if (bestScore < 0.69 || bestDirect < 0.26) return null;
  const beat = 60 / bestBpm;
  const supported = evaluated.flatMap((t) => {
    const n = Math.round(t / beat);
    return n >= 1 && n <= 5 && Math.abs(t / beat - n) <= 0.145 ? [t / n] : [];
  });
  if (!supported.length) return null;
  // Sub-window quantization alternates short and long periods even on an exact metronome.
  // A winsorized mean keeps the accumulated timing while limiting isolated irregular beats.
  const center = median(supported),
    radius = beat * 0.06;
  const refined =
    supported.reduce((sum, period) => sum + clamp(period, center - radius, center + radius), 0) / supported.length;
  return {
    bpm: rounded(clamp(60 / refined, 55, 190), 1),
    confidence: rounded(Math.min(0.95, bestScore) * Math.min(1, 0.72 + evaluated.length / 45)),
    status: "inferred",
  };
}

export function audioEvidence(samples: Float32Array, sampleRate: number): AudioEvidence {
  if (!(samples instanceof Float32Array)) throw new Error("Audio evidence requires mono Float32 PCM.");
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 768000)
    throw new Error("Invalid PCM sample rate.");
  const duration = samples.length / sampleRate;
  // Large recordings retain bounded envelope memory; timing precision is reported with each result.
  const onsetSamples = Math.max(1, Math.round(sampleRate * 0.015), Math.ceil(samples.length / 65536));
  const envelopeSamples = Math.max(1, Math.round(sampleRate * 0.1), Math.ceil(samples.length / 2048));
  const onsetStep = onsetSamples / sampleRate,
    envelopeStep = envelopeSamples / sampleRate;
  const levels: number[] = [],
    envelope: (number | null)[] = [];
  let energy = 0,
    peak = 0,
    clipped = 0,
    onsetEnergy = 0,
    onsetBright = 0,
    envelopeEnergy = 0,
    previous = 0;
  let onsetCount = 0,
    envelopeCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    if (!Number.isFinite(v)) throw Error("PCM contains a non-finite sample.");
    const mag = Math.abs(v),
      sq = v * v,
      delta = v - previous;
    peak = Math.max(peak, mag);
    if (mag >= 1) clipped++;
    energy += sq;
    envelopeEnergy += sq;
    onsetEnergy += sq;
    onsetBright += delta * delta;
    previous = v;
    onsetCount++;
    envelopeCount++;
    if (onsetCount === onsetSamples || i === samples.length - 1) {
      const weighted = Math.sqrt((onsetEnergy + 0.3 * onsetBright) / onsetCount);
      levels.push(Math.max(-96, dbfs(weighted) ?? -96));
      onsetCount = 0;
      onsetEnergy = 0;
      onsetBright = 0;
    }
    if (envelopeCount === envelopeSamples || i === samples.length - 1) {
      envelope.push(dbfs(Math.sqrt(envelopeEnergy / envelopeCount)));
      envelopeCount = 0;
      envelopeEnergy = 0;
    }
  }
  const onsets = findOnsets(levels, onsetStep);
  return {
    duration,
    sampleRate,
    samples: samples.length,
    rmsDbfs: samples.length ? dbfs(Math.sqrt(energy / samples.length)) : null,
    samplePeakDbfs: dbfs(peak),
    clippedSamples: clipped,
    clippedShare: samples.length ? clipped / samples.length : 0,
    envelopeStep,
    envelope,
    onsetStep,
    onsets,
    tempo: estimateTempo(onsets),
  };
}

export function makeReferenceEvidence({
  source,
  visual,
  audio,
  integratedLufs = null,
}: {
  source: ReferenceSource;
  visual: FrameEvidence;
  audio: AudioEvidence | null;
  integratedLufs?: number | null;
}): ReferenceEvidence {
  // Persist frame traces separately. Keeping only the compact summary makes templates transportable.
  const { frames: _frames, ...summary } = visual;
  const unknowns = [
    "Exact camera or subject motion, tracking, masks and VFX identity",
    "Burned-in subtitle text, typeface and animation",
    "Narrative intention, depicted subjects and emotional meaning",
    "Separation of speech, music and effects; original grade and LUT identity",
  ];
  if (!audio) unknowns.push("No PCM analysis supplied.");
  else if (audio.tempo === null) unknowns.push("A stable rhythmic pulse was not established.");
  if (integratedLufs === null) unknowns.push("Integrated EBU R128 loudness was not measured.");
  if (summary.missingFrameNumbers > 0) unknowns.push("Decoded frame records are missing.");
  if (summary.coveredSeconds + Math.max(0.075, 2 * (summary.medianFrameInterval ?? 0)) < source.duration) {
    unknowns.push("Reference evidence covers only the reported portion of this source.");
  }
  return ReferenceEvidenceSchema.parse({
    version: 1,
    source,
    visual: summary,
    audio,
    integratedLufs,
    unknowns,
    provenance: {
      visual: "FFmpeg scdet and signalstats, native presentation timestamps, 8-bit YUV proxy",
      audio: "Decoded mono PCM, RMS and sample peaks",
      loudness: integratedLufs === null ? null : "EBU R128 measurement",
      confidence: confidenceBasis,
    },
  });
}
