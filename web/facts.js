import { parseSilencedetect } from "../src/pipeline/analysis/intervals";
import { detectRetakes, groupSentences } from "../src/pipeline/analysis/speech";
import { median, formatFromMeasurements } from "../src/studio/format-model";

export function inspect(core, run) {
  core.ffprobe("-v", "error", "-show_format", "-show_streams", "-of", "json", "-o", "probe.json", "-i", "input");
  core.reset();
  if (!core.FS.analyzePath("probe.json").exists) throw Error("This video format could not be read. Try an MP4 or MOV.");
  const meta = JSON.parse(core.FS.readFile("probe.json", { encoding: "utf8" }));
  const picture = meta.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const seconds = Number(picture?.duration) || Number(meta.format.duration);
  if (!picture || !(seconds > 0 && Number.isFinite(seconds)))
    throw Error("This file does not contain a readable video.");
  const audio = meta.streams.some((s) => s.codec_type === "audio");
  // Cap the analysis portion, keeping the output small enough to finish on a phone.
  const duration = Math.min(seconds, 180);
  const log = run([
    "-t",
    String(duration),
    "-i",
    "input",
    "-map",
    "0:v:0",
    "-vf",
    "fps=4,scale=96:-2,signalstats,metadata=mode=print:key=lavfi.signalstats.YDIF,select='gt(scene,0.24)',showinfo",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const candidates = [...log.matchAll(/\bn:\s*\d+\s+pts:.*?\bpts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const edges = [0];
  for (const t of candidates) if (t - edges.at(-1) >= 0.55 && t < duration - 0.3) edges.push(t);
  edges.push(duration);
  const shots = edges
    .slice(1)
    .map((end, i) => ({ id: "shot" + i, clip: "c1", start: edges[i], end, cutScore: i ? 25 : null }));
  const deltas = [...log.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].slice(1).map((m) => Number(m[1]));
  let raw = new Float32Array(0),
    silence = [],
    levels = [],
    mean = null;
  if (audio) {
    const sound = run([
      "-t",
      String(duration),
      "-i",
      "input",
      "-vn",
      "-af",
      "silencedetect=n=-38dB:d=0.25",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "analysis.pcm",
    ]);
    const data = core.FS.readFile("analysis.pcm");
    raw = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    silence = parseSilencedetect(sound, duration);
    let sums = 0;
    for (let i = 0; i < raw.length; i += 1600) {
      const stop = Math.min(i + 1600, raw.length);
      let energy = 0;
      for (let j = i; j < stop; j++) energy += raw[j] * raw[j];
      sums += energy;
      levels.push(Math.max(-96, 10 * Math.log10(Math.max(1e-10, energy / (stop - i)))));
    }
    mean = Math.max(-96, 10 * Math.log10(Math.max(1e-10, sums / Math.max(1, raw.length))));
  }
  return { seconds, duration, audio, raw, silence, levels, mean, shots, motion: deltas.length ? median(deltas) : 0 };
}

export function learn(name, audioVideo, cueWords = null) {
  const { duration, audio, shots, silence, mean, motion } = audioVideo;
  const share = audio ? silence.reduce((n, s) => n + s.end - s.start, 0) / duration : null;
  const style = formatFromMeasurements(
    "ref-" + crypto.randomUUID(),
    name,
    duration,
    shots.map((s) => s.end - s.start),
    motion,
    0,
    audio,
    share,
    mean,
    cueWords,
  );
  return { ...style, image: "./assets/forest.jpg" };
}

export function analysisFor(media, words) {
  const sentences = groupSentences(words, 0.52);
  return {
    words,
    shots: media.shots,
    sentences,
    retakes: detectRetakes(words, sentences),
    silences: media.silence.map((s, i) => ({ ...s, id: "p" + i, clip: "c1", duration: s.end - s.start })),
    loudness: [{ clip: "c1", rms: { step: 0.1, db: media.levels } }],
  };
}
