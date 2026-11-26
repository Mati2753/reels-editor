export const soundModel = {
  model: "YAMNet",
  revision: "ac2ca3bd45d12ec1f19f1144205ea529b4e9dedf",
  sha256: "1510041dce24a2e9e84ec546807ac408ae496da6d1ed41bc3ccba649623f8e19",
  sampleRate: 16000,
  window: 15600,
  hop: 7680,
} as const;

export type SoundWindow = {
  start: number;
  end: number;
  speech: number;
  music: number;
  silence: number;
  labels: { name: string; score: number }[];
};
export function soundWindows(
  scores: Float32Array,
  labels: readonly string[],
  offset: number,
  samples: number,
): SoundWindow[] {
  if (labels.length !== 521 || scores.length % 521 || offset < 0 || samples < 0)
    throw Error("Invalid AudioSet evidence.");
  const windows: SoundWindow[] = [];
  const rounded = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
  for (let row = 0; row < scores.length / 521; row++) {
    const from = offset + row * soundModel.hop,
      to = Math.min(samples, from + soundModel.window);
    if (to - from < Math.min(samples, 4000)) break;
    const distribution = scores.subarray(row * 521, (row + 1) * 521);
    if (distribution.some((n) => !Number.isFinite(n) || n < -1e-6 || n > 1 + 1e-6))
      throw Error("Invalid acoustic class probability.");
    const labelScores = [];
    for (let i = 0; i < distribution.length; i++)
      if (distribution[i]! >= 0.25) labelScores.push({ name: labels[i]!, score: rounded(distribution[i]!) });
    windows.push({
      start: from / 16000,
      end: to / 16000,
      speech: rounded(distribution[0]!),
      music: rounded(distribution[132]!),
      silence: rounded(distribution[494]!),
      labels: labelScores.sort((a, b) => b.score - a.score).slice(0, 4),
    });
  }
  return windows;
}
export function summarizeSound(windows: SoundWindow[]) {
  if (!windows.length) return null;
  const share = (key: "speech" | "music" | "silence") => windows.filter((w) => w[key] >= 0.55).length / windows.length;
  return {
    windows: windows.length,
    speechShare: share("speech"),
    musicShare: share("music"),
    silenceShare: share("silence"),
  };
}
export function preservedMusic(
  segments: readonly { clip: string; in: number; out: number }[],
  sources: readonly { clip: string; events?: SoundWindow[] }[],
) {
  let voiced = 0,
    covered = 0,
    total = 0;
  for (const s of segments) {
    total += s.out - s.in;
    for (const w of sources.find((m) => m.clip === s.clip)?.events ?? []) {
      // Each observation represents one hop. Adjacent analysis windows overlap.
      const span = Math.max(0, Math.min(s.out, w.end, w.start + 0.48) - Math.max(s.in, w.start));
      covered += span;
      if (w.music >= 0.65) voiced += span;
    }
  }
  return total > 0 && covered >= total * 0.72 && voiced >= covered * 0.65;
}

export function instrumentalOnly(rows: SoundWindow[]) {
  const profile = summarizeSound(rows);
  if (!profile || profile.windows < 4 || profile.musicShare < 0.9 || rows.some((w) => w.speech > 0.12)) return false;
  const tags = rows.flatMap((w) => w.labels.map((l) => l.name));
  if (tags.some((t) => /singing|vocal|speech|narration|conversation|chant|rapping/i.test(t))) return false;
  return (
    rows.filter((w) =>
      w.labels.some((l) =>
        /guitar|piano|synthesizer|musical instrument|keyboard \(musical\)|orchestra|drum kit/i.test(l.name),
      ),
    ).length >=
    rows.length * 0.3
  );
}
export async function inferSoundWindows(
  pcm: Float32Array,
  labels: readonly string[],
  predict: (wave: Float32Array) => Promise<Float32Array>,
) {
  const result: SoundWindow[] = [];
  const { hop, window } = soundModel;
  for (let offset = 0; offset < pcm.length; offset += 32 * hop) {
    const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + 31 * hop + window));
    if (offset > 0 && chunk.length < 4000) break;
    result.push(...soundWindows(await predict(chunk), labels, offset, pcm.length));
    if (offset + chunk.length >= pcm.length) break;
  }
  return result;
}

export type MaskingInterval = {
  start: number;
  end: number;
  observations: number;
  sourceSpeech: number;
  outputSpeech: number;
  outputMusic: number;
};
export function compareSpeechMix(
  segments: readonly { clip: string; in: number; out: number }[],
  sources: readonly { clip: string; events?: SoundWindow[] }[],
  output: SoundWindow[],
) {
  let cursor = 0,
    checked = 0;
  const sceneRanges = segments.map((seg) => {
    const start = cursor;
    cursor += seg.out - seg.in;
    return { ...seg, start, end: cursor };
  });
  const intervals: MaskingInterval[] = [];
  let lastFlagStart = -Infinity;
  for (const w of output) {
    // Only compare windows within a single continuous retained shot.
    const scene = sceneRanges.find((s) => s.start <= w.start + 0.01 && s.end >= w.end - 0.01);
    if (!scene) continue;
    const at = scene.in + (w.start + w.end) / 2 - scene.start;
    const rows = sources.find((s) => s.clip === scene.clip)?.events;
    if (!rows?.length) continue;
    const i = Math.min(rows.length - 1, Math.max(0, Math.round((at - 0.4875) / 0.48)));
    const source = rows[i]!;
    if (at < source.start || at > source.end || source.speech < 0.8) continue;
    checked++;
    if (w.speech > 0.38 || source.speech - w.speech < 0.5 || w.music - source.music < 0.28) continue;
    const previous = intervals.at(-1);
    if (previous && w.start - lastFlagStart <= 0.5) {
      previous.end = w.end;
      previous.observations++;
      previous.sourceSpeech = Math.max(previous.sourceSpeech, source.speech);
      previous.outputSpeech = Math.min(previous.outputSpeech, w.speech);
      previous.outputMusic = Math.max(previous.outputMusic, w.music);
    } else
      intervals.push({
        start: w.start,
        end: w.end,
        observations: 1,
        sourceSpeech: source.speech,
        outputSpeech: w.speech,
        outputMusic: w.music,
      });
    lastFlagStart = w.start;
  }
  return { checked, intervals: intervals.filter((f) => f.observations >= 2) };
}
