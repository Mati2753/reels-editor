import { parseSilencedetect } from "../src/pipeline/analysis/intervals";
import { detectRetakes, groupSentences } from "../src/pipeline/analysis/speech";
import {
  REFERENCE_FRAME_FILTER,
  frameEvidence,
  audioEvidence,
  makeReferenceEvidence,
} from "../src/intelligence/evidence";
import { describeReference } from "../src/intelligence/styles";
import { median } from "../src/studio/format-model";

function readProbe(core, input) {
  if (core.FS.analyzePath("probe.json").exists) core.FS.unlink("probe.json");
  core.ffprobe("-v", "error", "-show_format", "-show_streams", "-of", "json", "-o", "probe.json", "-i", input);
  core.reset();
  if (!core.FS.analyzePath("probe.json").exists) throw Error("A video could not be read. Try an MP4 or MOV.");
  const info = JSON.parse(core.FS.readFile("probe.json", { encoding: "utf8" }));
  const video = info.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(video?.duration) || Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw Error("The file has no readable video track.");
  const fraction = video.avg_frame_rate || video.r_frame_rate || "0/1";
  const [a, b] = fraction.split("/").map(Number);
  return {
    ...info,
    video,
    duration,
    source: {
      width: video.width,
      height: video.height,
      duration,
      fps: a && b ? a / b : null,
      frameRate: fraction,
      timeBase: video.time_base || null,
    },
  };
}
export function inspect(core, run, input, clip, { keepFrames = false, needSamples = true } = {}) {
  const meta = readProbe(core, input);
  const { source, duration } = meta;
  run([
    "-i",
    input,
    "-map",
    "0:" + meta.video.index,
    "-an",
    "-vf",
    REFERENCE_FRAME_FILTER + ",metadata=mode=print:file=frames.txt",
    "-vsync",
    "0",
    "-f",
    "null",
    "-",
  ]);
  const visual = frameEvidence(core.FS.readFile("frames.txt", { encoding: "utf8" }), duration, { keepFrames });
  core.FS.unlink("frames.txt");
  const cuts = visual.cuts.filter((c) => c.at > 0 && c.at < duration);
  const starts = [0, ...cuts.map((c) => c.at), duration];
  const shots = starts
    .slice(1)
    .map((end, i) => ({
      id: clip + "-s" + (i + 1),
      clip,
      start: starts[i],
      end,
      cutScore: i ? cuts[i - 1].score : null,
    }));
  let audio = null,
    raw = null,
    silence = [],
    integratedLufs = null,
    truePeakDbtp = null;
  const hasAudio = meta.streams.some((s) => s.codec_type === "audio");
  if (hasAudio) {
    const log = run([
      "-i",
      input,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      "silencedetect=n=-38dB:d=0.25,ebur128=peak=true:framelog=verbose",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "analysis.pcm",
    ]);
    const data = core.FS.readFile("analysis.pcm");
    const pcm = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    audio = audioEvidence(pcm, 16000);
    raw = needSamples ? pcm : null;
    core.FS.unlink("analysis.pcm");
    silence = parseSilencedetect(log, duration);
    const measured = Number(/I:\s*(-?[\d.]+)\s*LUFS/i.exec(log.split("Summary:").at(-1))?.[1]);
    integratedLufs = Number.isFinite(measured) && measured > -70 ? measured : null;
    const peak = Number(/True peak:[\s\S]*?Peak:\s*(-?[\d.]+)/i.exec(log.split("Summary:").at(-1))?.[1]);
    truePeakDbtp = Number.isFinite(peak) ? peak : null;
  }
  const evidence = makeReferenceEvidence({ source, visual, audio, integratedLufs });
  return {
    input,
    clip,
    seconds: duration,
    duration,
    audio: hasAudio,
    raw,
    silence,
    shots,
    visual,
    evidence,
    meta,
    truePeakDbtp,
  };
}
export function referenceCard(core, run, media, id, name) {
  const stream = media.meta.streams.find(
    (s) => s.codec_type === "subtitle" && ["mov_text", "subrip", "webvtt", "ass", "ssa"].includes(s.codec_name),
  );
  let cueWords = null,
    subtitleCues = null;
  if (stream) {
    try {
      run(["-i", media.input, "-map", "0:" + stream.index, "-f", "srt", "ref.srt"]);
      subtitleCues = core.FS.readFile("ref.srt", { encoding: "utf8" });
      const counts = subtitleCues
        .trim()
        .split(/\r?\n\s*\n/)
        .map(
          (c) =>
            c
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
    } catch {
      /* Unreadable embedded text does not identify a caption style. */
    }
  }
  const pauses = media.audio ? media.silence.reduce((n, s) => n + s.end - s.start, 0) / media.duration : null;
  return {
    card: describeReference(
      id,
      name,
      media.evidence,
      cueWords,
      pauses,
      media.visual.frames?.some((f) => f.luma != null)
        ? median(media.visual.frames.flatMap((f) => (f.luma == null ? [] : [f.luma])))
        : null,
    ),
    subtitleCues,
  };
}
export function analysisFor(media, words) {
  const sentences = groupSentences(words, 0.52);
  return {
    words,
    shots: media.shots,
    sentences,
    retakes: detectRetakes(words, sentences),
    silences: media.silence.map((s, i) => ({
      ...s,
      id: media.clip + "-p" + i,
      clip: media.clip,
      duration: s.end - s.start,
    })),
    loudness: media.evidence.audio
      ? [
          {
            clip: media.clip,
            rms: {
              step: media.evidence.audio.envelopeStep,
              db: media.evidence.audio.envelope.map((v) => (typeof v === "number" ? v : -96)),
            },
          },
        ]
      : [],
  };
}
