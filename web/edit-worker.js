import { classifyAudio, closeAudioClassifier } from "./audio-events";
import {
  summarizeSound,
  preservedMusic,
  soundModel,
  instrumentalOnly,
  compareSpeechMix,
} from "../src/intelligence/audio-events";
import { portraitMattes, exportPortraitMasks } from "./portrait";
import { comparePictures, transformSize } from "../src/intelligence/picture-transform";
import { planIllustration } from "../src/intelligence/illustration";
import { locateFaces } from "./faces";
import { trackScreen } from "../src/intelligence/screen";
import { inferCaptionLayout } from "../src/intelligence/caption-layout";
import { recallFeedback, feedbackChoices } from "../src/intelligence/feedback";
import { findBeats, localSelection, buildEdit } from "../src/studio/director";
import { importSrt } from "../src/studio/subtitles";
import { median } from "../src/studio/format-model";
import { makeStyle, matchGrade, outputSize } from "../src/intelligence/styles";
import { buildPortableCut, PortableCutSchema, verifyPortableSources } from "../src/intelligence/timeline";
import { assessRender, suggestRepair } from "../src/intelligence/quality";
import { selectBroll } from "../src/intelligence/assets";
import { inspect, referenceCard, analysisFor } from "./facts";
import { fingerprint, readLocal, saveLocal } from "./storage";
import { render } from "./render";
const progress = (stage, value) => self.postMessage({ stage, value });
const asset = async (name) => {
  const res = await fetch(new URL("assets/" + name, self.location.href));
  if (!res.ok) throw Error("A studio asset could not load. Please try again.");
  return new Uint8Array(await res.arrayBuffer());
};
async function engine() {
  const url = new URL("ffmpeg-core.js", self.location.href).href;
  importScripts(url);
  const [a, b] = await Promise.all([asset("engine-0.bin"), asset("engine-1.bin")]);
  const bytes = new Uint8Array(a.length + b.length);
  bytes.set(a);
  bytes.set(b, a.length);
  const locate = btoa(JSON.stringify({ wasmURL: url.replace(/\.js$/, ".wasm"), workerURL: "" }));
  return self.createFFmpegCore({ wasmBinary: bytes, mainScriptUrlOrBlob: url + "#" + locate });
}
async function model(name, input, transfer = []) {
  const channel = new MessageChannel(),
    child = channel.port1;
  self.postMessage({ model: name, port: channel.port2 }, [channel.port2]);
  try {
    return await new Promise((resolve, reject) => {
      let timer;
      const wait = () => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(Error("Model timed out.")), 150000);
      };
      wait();
      child.onmessage = ({ data }) => {
        if (data.stage) {
          progress(data.stage, 0.28);
          wait();
          return;
        }
        clearTimeout(timer);
        data.error ? reject(Error(data.error)) : resolve(data.words ?? data.observations);
      };
      child.onerror = (e) => {
        clearTimeout(timer);
        reject(Error(e.message));
      };
      child.postMessage(input, transfer);
    });
  } finally {
    child.close();
  }
}
async function getVisualContext(core, run, m) {
  const key = "visual:clip-533-v1:" + m.digest;
  const cached = await readLocal(key);
  if (cached) return cached;
  const frames = [];
  // Inspect the middle of the first, middle, and final detected shots; each inference retains its timestamp.
  const picks = Array.from(new Set([0, Math.floor(m.shots.length / 2), m.shots.length - 1]));
  for (const i of picks) {
    const shot = m.shots[i],
      at = (shot.start + shot.end) / 2;
    run([
      "-ss",
      String(at),
      "-i",
      m.input,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=224:224:force_original_aspect_ratio=decrease,pad=224:224:(ow-iw)/2:(oh-ih)/2",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "vision.rgb",
    ]);
    const rgb = core.FS.readFile("vision.rgb");
    if (rgb.length === 224 * 224 * 3) frames.push({ clip: m.clip, at, width: 224, height: 224, rgb: rgb.buffer });
  }
  if (!frames.length) return [];
  const observations = await model(
    "vision",
    frames,
    frames.map((f) => f.rgb),
  );
  await saveLocal(key, observations);
  return observations;
}
async function inspectText(core, run, media, times) {
  const frames = [];
  for (const at of [...new Set(times)].slice(0, 8)) {
    run([
      "-ss",
      String(at),
      "-i",
      media.input,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:640:force_original_aspect_ratio=decrease",
      "-threads",
      "1",
      "-c:v",
      "png",
      "text-sample.png",
    ]);
    const bytes = core.FS.readFile("text-sample.png");
    core.FS.unlink("text-sample.png");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    frames.push({ at, bytes, width: view.getUint32(16), height: view.getUint32(20) });
  }
  return frames.length
    ? model(
        "ocr",
        frames,
        frames.map((f) => f.bytes.buffer),
      )
    : [];
}
function fullScaleIntervals(samples) {
  const spans = [];
  if (!samples) return null;
  let start = -1,
    count = 0;
  for (let i = 0; i <= samples.length; i++) {
    if (i < samples.length && Math.abs(samples[i]) >= 1) {
      if (start < 0) start = i;
      count++;
      continue;
    }
    if (start >= 0) {
      const last = spans.at(-1);
      if (last && start / 16000 - last.end < 0.05) {
        last.end = i / 16000;
        last.samples += count;
      } else spans.push({ start: start / 16000, end: i / 16000, samples: count });
      start = -1;
      count = 0;
    }
  }
  return spans;
}
function timelinePhrases(edl, sentences) {
  let cursor = 0;
  const phrases = [];
  for (const seg of edl.segments) {
    for (const q of sentences.filter((s) => s.clip === seg.clip && s.end > seg.in && s.start < seg.out)) {
      const start = cursor + Math.max(q.start - seg.in, 0),
        end = cursor + Math.min(q.end, seg.out) - seg.in;
      if (end - start > 0.5) phrases.push({ start, end, text: q.text });
    }
    cursor += seg.out - seg.in;
  }
  return phrases;
}
function sceneReasons(edl, beats, media) {
  return edl.segments.map((s, i) => {
    const b = beats.find((b) => b.clip === s.clip && Math.abs(b.start - s.in) < 0.06);
    const why = b?.text
      ? /[?!\d]/.test(b.text)
        ? "Spoken question, number or emphasis"
        : "Preserves a continuous spoken phrase"
      : b?.shot
        ? "A measured picture change opens this scene"
        : "Retains source order within the target duration";
    return {
      scene: s.id,
      clip: s.clip,
      sourceIn: s.in,
      sourceOut: s.out,
      decision: "keep",
      basis: why,
      words: b?.text ?? "",
      framing: s.framing?.move ? "Move to support a change in picture or emphasis" : "Hold the framing",
      transition: edl.transitions.find((t) => t.between[1] === s.id)?.type ?? "cut",
      score: b?.score ?? null,
      label: media.find((m) => m.clip === s.clip)?.semantic?.find((v) => v.at >= s.in && v.at < s.out)?.label ?? null,
      sequence: i + 1,
      status: "editorial inference",
    };
  });
}
function fromRevision(cut, plan, bindings) {
  const parsed = PortableCutSchema.parse(cut);
  verifyPortableSources(parsed, bindings);
  const fps = parsed.output.rate.numerator / parsed.output.rate.denominator;
  if (fps !== 30) throw Error("This renderer supports 30 fps timelines.");
  const byId = new Map(plan.segments.map((s) => [s.id, s]));
  const segments = parsed.scenes.map((s) => ({
    ...(byId.get(s.id) ?? { type: "clip", framing: { scale: 1, origin: { x: 0.5, y: 0.5 } } }),
    id: s.id,
    clip: s.clip,
    in: s.inFrame / fps,
    out: s.outFrame / fps,
  }));
  const active = new Set(segments.map((s) => s.id));
  return {
    ...plan,
    segments,
    transitions: plan.transitions.filter((t) =>
      segments.some((s, i) => s.id === t.between[0] && segments[i + 1]?.id === t.between[1]),
    ),
    overlays: plan.overlays.filter((o) => !o.at.segment || active.has(o.at.segment)),
    audio: { ...plan.audio, sfx: plan.audio.sfx.filter((f) => active.has(f.at.segment)) },
  };
}
self.onmessage = async ({ data }) => {
  try {
    const { kind, settings = {}, format: selectedFormat, title, supplied, example } = data;
    const files = data.files ?? [data.file];
    if (!files.length) throw Error("Choose at least one video.");
    progress("Opening the editing engine", 0.02);
    const core = await engine();
    function run(args, tick) {
      const log = [];
      core.setLogger((e) => log.push(e.message));
      core.setProgress((p) => tick?.(p.time / 1e6));
      core.setTimeout(-1);
      core.exec(
        "-hide_banner",
        "-loglevel",
        "info",
        "-y",
        "-nostdin",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        ...args,
      );
      const code = core.ret;
      core.reset();
      if (code)
        throw Error(
          "Video processing failed. " +
            log
              .slice(-6)
              .filter((x) => !x.includes("Aborted"))
              .join(" ")
              .slice(-490),
        );
      return log.join("\n");
    }
    const media = [],
      refs = [],
      evidences = [],
      notes = [];
    let image = null;
    const useMount = Boolean(core.FS.filesystems.WORKERFS);
    if (useMount) {
      core.FS.mkdir("sources");
      core.FS.mount(
        core.FS.filesystems.WORKERFS,
        { blobs: files.map((file, i) => ({ name: "c" + (i + 1), data: file })) },
        "/sources",
      );
    }
    for (const [i, file] of files.entries()) {
      const clip = "c" + (i + 1),
        input = useMount ? "/sources/" + clip : "input-" + clip;
      if (!useMount) {
        if (file.size > 300 * 1024 * 1024) throw Error("Choose a file under 300 MB for this browser.");
        core.FS.writeFile(input, new Uint8Array(await file.arrayBuffer()));
      }
      const digest = await fingerprint(file);
      progress(
        (kind === "learn" ? "Measuring reference" : "Analyzing clip") + " " + (i + 1) + " of " + files.length,
        0.08 + (0.13 * i) / files.length,
      );
      const m = inspect(core, run, input, clip, { keepFrames: kind === "learn", needSamples: true });
      if (kind !== "learn" && settings.screen) {
        run([
          "-i",
          input,
          "-an",
          "-vf",
          "fps=4,scale=48:32",
          "-threads",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "screen.rgb",
        ]);
        m.screen = trackScreen(core.FS.readFile("screen.rgb"), 48, 32, 4, settings.background);
        core.FS.unlink("screen.rgb");
        notes.push(
          m.screen
            ? "Tracked the foreground against the measured studio screen in " + file.name + "."
            : "Kept the original background in " +
                file.name +
                " because a consistent green or blue screen was not detected.",
        );
      }
      if (settings.faces && !m.screen) {
        try {
          const cacheKey = "face-pico-1:" + digest;
          m.faces = await readLocal(cacheKey);
          if (!m.faces) {
            m.faces = await locateFaces(core, run, m, asset);
            await saveLocal(cacheKey, m.faces);
          }
        } catch {
          notes.push("Face framing was unavailable for " + file.name + ".");
        }
      }
      if (m.raw && (m.evidence.audio?.rmsDbfs ?? -100) > -58) {
        try {
          const cacheKey = "audio-yamnet-v1:" + digest;
          m.events = await readLocal(cacheKey);
          if (!m.events) {
            progress("Listening for speech, music and other sounds", 0.25);
            m.events = await classifyAudio(m.raw, asset);
            await saveLocal(cacheKey, m.events);
          }
        } catch {
          notes.push("Sound classification was unavailable for " + file.name + ".");
        }
      }
      m.name = file.name;
      m.bytes = file.size;
      m.digest = digest;
      if (settings.visual) {
        try {
          m.semantic = (await getVisualContext(core, run, m)).map((v) => ({ ...v, clip }));
        } catch {
          notes.push("Visual scene interpretation was unavailable. Frame and audio measurements were retained.");
        }
      }
      if (kind === "learn") {
        const item = referenceCard(core, run, m, digest, file.name);
        const rate = Math.min(4, 160 / m.seconds);
        run([
          "-i",
          m.input,
          "-an",
          "-vf",
          "fps=" + rate + ",scale=" + transformSize.width + ":" + transformSize.height,
          "-threads",
          "1",
          "-pix_fmt",
          "gray",
          "-f",
          "rawvideo",
          "motion.gray",
        ]);
        const raw = core.FS.readFile("motion.gray");
        core.FS.unlink("motion.gray");
        const transforms = comparePictures(
          raw,
          rate,
          m.visual.cuts.map((c) => c.at),
        );
        if (
          transforms.length >= 3 &&
          transforms.length >= 0.28 * (raw.length / (transformSize.width * transformSize.height) - 1)
        ) {
          const scale = median(transforms.map((v) => v.scale));
          item.card.pictureTransform = {
            direction: scale > 1.015 ? "in" : scale < 0.985 ? "out" : "translate",
            scalePerSecond: Math.abs(scale - 1) * rate,
            confidence: median(transforms.map((v) => v.confidence)),
          };
        }
        item.card.soundProfile = summarizeSound(m.events ?? []);
        const centers = m.faces?.centers ?? [];
        if (centers.length >= 3 && centers.length >= 0.7 * m.faces.frames)
          item.card.facePosition = { x: median(centers.map((p) => p.x)), y: median(centers.map((p) => p.y)) };
        let visibleText = [];
        try {
          progress("Reading text in the reference", 0.29);
          visibleText = await inspectText(
            core,
            run,
            m,
            Array.from({ length: 6 }, (_, j) => (m.seconds * (j + 0.5)) / 6),
          );
          item.card.captionLayout = inferCaptionLayout(visibleText);
          item.card.cueWords ??= item.card.captionLayout?.words ?? null;
        } catch {
          notes.push("Reference text recognition was unavailable.");
        }
        refs.push(item.card);
        evidences.push({
          id: digest,
          name: file.name,
          analysis: m.evidence,
          frames: m.visual.frames,
          pictureTransforms: transforms,
          faces: m.faces,
          embeddedSubtitles: item.subtitleCues,
          soundEvents: m.events ?? [],
          soundModel,
          visibleText,
          semantics: m.semantic ?? [],
        });
        if (!image) {
          run([
            "-ss",
            String(Math.min(0.3, m.seconds / 2)),
            "-i",
            input,
            "-frames:v",
            "1",
            "-vf",
            "scale=160:90:force_original_aspect_ratio=increase,crop=160:90",
            "-q:v",
            "5",
            "cover.jpg",
          ]);
          image = "data:image/jpeg;base64," + btoa(String.fromCharCode(...core.FS.readFile("cover.jpg")));
        }
      } else {
        let words = [];
        if (supplied && i === 0) words = importSrt(supplied, m.seconds).words;
        else if (example && i === 0)
          words = JSON.parse(new TextDecoder().decode(await asset("sample-transcript.json"))).words;
        else if (instrumentalOnly(m.events ?? []))
          notes.push("Kept the instrumental audio in " + file.name + " without generating spoken subtitles.");
        else if (m.audio && (m.evidence.audio?.rmsDbfs ?? -100) > -55) {
          const key = "whisper-tiny-5332:" + digest;
          words = await readLocal(key);
          if (!words) {
            try {
              progress("Listening to clip " + (i + 1), 0.24);
              words = await model("speech", m.raw, [m.raw.buffer]);
              await saveLocal(key, words);
            } catch {
              words = [];
              notes.push(
                "Automatic speech recognition was unavailable for " + file.name + ". You can supply timed subtitles.",
              );
            }
          }
        }
        m.raw = null;
        m.words = words
          .filter((w) => w.start < m.duration && w.end > w.start)
          .map((w, j) => ({ ...w, id: clip + "-w" + (j + 1), clip, end: Math.min(w.end, m.duration) }));
        media.push(m);
      }
    }
    await closeAudioClassifier();
    if (kind === "learn") {
      const learned = makeStyle(refs, "ref-" + crypto.randomUUID(), title, image || "./assets/forest.jpg");
      self.postMessage({ format: learned, evidences, notes });
      return;
    }
    const facts = Object.fromEntries(
      ["words", "shots", "sentences", "retakes", "silences", "loudness"].map((k) => [k, []]),
    );
    for (const m of media) {
      const f = analysisFor(m, m.words);
      for (const k of Object.keys(facts))
        facts[k].push(
          ...f[k].map((x) =>
            x.id && !["words", "shots", "silences"].includes(k) ? { ...x, id: m.clip + "-" + x.id } : x,
          ),
        );
    }
    const memory = recallFeedback(await readLocal("director-feedback"), selectedFormat, facts.words.length > 0);
    const format = memory.format;
    const layouts = format.profile?.references.flatMap((r) => (r.captionLayout ? [r.captionLayout] : [])) ?? [];
    if (layouts.length)
      settings.captionStyle = {
        ink: layouts[0].ink && layouts.every((l) => l.ink === layouts[0].ink) ? layouts[0].ink : null,
        uppercase: layouts.every((l) => l.uppercase),
        center: median(layouts.map((l) => l.center)),
        height: median(layouts.map((l) => l.height)),
      };
    settings.captionStyle = { ...settings.captionStyle, ...memory.captionStyle };
    for (const rule of memory.rules) notes.push("Remembered for this style: " + feedbackChoices[rule.choice] + ".");
    const probe = {
      clips: media.map((m) => ({
        id: m.clip,
        normalized: { duration: m.duration, frames: Math.round(m.duration * 30) },
      })),
    };
    const bindings = media.map((m) => ({
      id: m.clip,
      name: m.name,
      bytes: m.bytes,
      duration: m.duration,
      hasAudio: m.audio,
    }));
    progress("Choosing scenes and building the timeline", 0.39);
    const beats = findBeats(probe, facts, format, settings);
    // A confident semantic observation is only a small tie-breaker between technical candidates.
    for (const b of beats) {
      if (
        media
          .find((m) => m.clip === b.clip)
          ?.semantic?.some((s) => s.at >= b.start && s.at < b.end && s.label === "a hands-on demonstration")
      )
        b.score += 0.35;
    }
    const { edl: initial, decisions } = buildEdit(
      title,
      "auto",
      facts,
      beats,
      localSelection(beats, settings),
      format,
      settings,
    );
    const edl = data.revision ? fromRevision(data.revision, initial, bindings) : initial;
    if (edl.audio.music && preservedMusic(edl.segments, media)) {
      delete edl.audio.music;
      const mix = decisions.find((d) => d.title === "Sound");
      if (mix)
        mix.detail =
          "Kept the existing source music and omitted a second music bed. " +
          edl.audio.sfx.length +
          " planned sound accents.";
    }
    if (memory.accent === null) edl.audio.sfx = [];
    else if (memory.accent) for (const fx of edl.audio.sfx) fx.file = memory.accent;
    if (memory.stationary) {
      for (const s of edl.segments) s.framing = { scale: 1, origin: { x: 0.5, y: 0.5 } };
      edl.transitions = edl.transitions.filter((t) => t.type !== "zoom");
    }
    // Portable cuts and recording both use half-open source-frame intervals.
    for (const seg of edl.segments) {
      seg.in = Math.round(seg.in * 30) / 30;
      seg.out = Math.round(seg.out * 30) / 30;
    }
    const dimensions = data.revision
      ? { width: data.revision.output.width, height: data.revision.output.height }
      : outputSize(settings.ratio, settings.quality);
    const signature = media.map((m) => m.digest);
    if (
      data.revision?.metadata?.sourceDigests &&
      JSON.stringify(data.revision.metadata.sourceDigests) !== JSON.stringify(signature)
    )
      throw Error("These files differ from the timeline’s originals.");
    const color = {};
    for (const field of ["luma", "contrast", "saturation"]) {
      const values = media.map((m) => m.visual.color[field]).filter((v) => v !== null);
      color[field] = values.length ? median(values) : null;
    }
    const grade = matchGrade(format, color),
      reasons = sceneReasons(edl, beats, media);
    const phrases = timelinePhrases(edl, facts.sentences);
    const broll =
      settings.broll !== false && format.profile?.preferences.broll !== false
        ? selectBroll(phrases, { engine: "browser", rejected: memory.rejected })
        : null;
    const illustration = planIllustration({
      phrases,
      motion: settings.motion && settings.broll !== false,
      hasStock: !!broll,
    });
    if (illustration)
      notes.push("Created a percentage graphic from the spoken phrase “" + illustration.sourceText + "”.");
    const iterations = [],
      limit = Math.max(0, Math.min(2, Number(settings.iterations ?? 1)));
    let adjustment = { brightness: grade.brightness, gainDb: 0 },
      rendered = null,
      previous = null,
      report = null;
    const positions = format.profile?.references.flatMap((r) => (r.facePosition ? [r.facePosition] : [])) ?? [];
    const learnedFaceTarget = positions.length
      ? { x: median(positions.map((p) => p.x)), y: median(positions.map((p) => p.y)) }
      : { x: 0.5, y: 0.38 };
    let portrait = { results: {}, observations: [] };
    if (settings.portrait) {
      progress("Loading the portrait background model", 0.41);
      try {
        portrait = await portraitMattes(core, run, edl, media, asset, settings.background, progress);
        notes.push(
          "Replaced the portrait background in " +
            Object.keys(portrait.results).length +
            " of " +
            edl.segments.length +
            " scenes. Uncertain scenes keep the original picture.",
        );
      } catch (e) {
        notes.push("Portrait background processing was unavailable. " + String(e?.message ?? "").slice(0, 160));
      }
    }
    let mixRepairs = [];
    const inspectVoice =
      Boolean(edl.audio.music || edl.audio.sfx.length) && media.some((m) => m.events?.some((w) => w.speech >= 0.8));
    for (let i = 0; i <= limit; i++) {
      const priorRender = rendered,
        priorReport = report,
        priorAdjustment = iterations.at(-1)?.adjustment;
      rendered = await render(core, run, edl, facts, media, asset, progress, {
        dimensions,
        portraits: portrait.results,
        mixRepairs,
        faceTarget: learnedFaceTarget,
        grade: { ...grade, brightness: adjustment.brightness },
        gainDb: adjustment.gainDb,
        broll,
        illustration,
        captionStyle: settings.captionStyle,
      });
      progress("Checking the finished picture and sound", 0.95);
      const measured = inspect(core, run, "reel.mp4", "result", { keepFrames: true, needSamples: true });
      const pictures = measured.visual.frames.map((f) => f.luma).filter((n) => n !== null);
      let observedCaptions, captionSampleTimes;
      if (rendered.captions.length) {
        const cues = rendered.captions;
        const indices = [...new Set([0, Math.floor(cues.length / 2), cues.length - 1])];
        try {
          captionSampleTimes = indices.map((i) => (cues[i].start + cues[i].end) / 2);
          const lines = await inspectText(core, run, measured, captionSampleTimes);
          const captionCenter =
            settings.captionStyle?.position === "center" ? 0.52 : (settings.captionStyle?.center ?? 0.71);
          observedCaptions = lines
            .filter((l) => Math.abs(l.y + l.height / 2 - captionCenter) < 0.17)
            .map((l) => ({
              start: l.at,
              end: Math.min(measured.duration, l.at + 1 / 30),
              text: l.text,
              confidence: l.confidence,
              contrastRatio: l.contrastRatio,
              bounds: {
                x: l.x * dimensions.width,
                y: l.y * dimensions.height,
                width: l.width * dimensions.width,
                height: l.height * dimensions.height,
              },
            }));
        } catch {
          notes.push("Rendered subtitle text could not be independently sampled.");
        }
      }
      report = assessRender({
        expected: {
          ...dimensions,
          fps: 30,
          frames: Math.round(rendered.seconds * 30),
          medianLuma: grade.targetLuma,
          medianShotSeconds: format.profile?.references.length ? format.shotSeconds : null,
          captions: rendered.captions.map(({ start, end, text }) => ({ start, end, text })),
        },
        actual: {
          width: measured.meta.video.width,
          height: measured.meta.video.height,
          fps: measured.meta.source.fps,
          duration: measured.duration,
          frames: measured.visual.frameCount,
          medianLuma: pictures.length ? median(pictures) / 255 : null,
          cutTimes: measured.visual.cuts.map((c) => c.at).filter((t) => t > 0 && t < measured.duration),
          observedCaptions,
          captionSampleTimes,
          truePeakDbtp: measured.truePeakDbtp,
          samplePeakDbfs: measured.evidence.audio?.samplePeakDbfs,
          clipping: fullScaleIntervals(measured.raw),
        },
      });
      let voiceReview = null;
      if (inspectVoice && measured.raw) {
        try {
          voiceReview = compareSpeechMix(edl.segments, media, await classifyAudio(measured.raw, asset));
        } catch {
          /* Unknown if the encoded audio could not be classified. */
        }
      }
      const priorVoice = iterations.at(-1)?.voiceReview;
      iterations.push({
        iteration: i,
        adjustment,
        captionStyle: settings.captionStyle,
        report,
        voiceReview,
        mixRepairs,
      });
      if (
        priorReport &&
        (priorReport.issues.length < report.issues.length ||
          (priorVoice && voiceReview && voiceReview.intervals.length > priorVoice.intervals.length))
      ) {
        rendered = priorRender;
        report = priorReport;
        adjustment = priorAdjustment;
        settings.captionStyle = iterations.at(-2)?.captionStyle;
        mixRepairs = iterations.at(-2)?.mixRepairs ?? [];
        iterations.at(-1).discarded = true;
        notes.push("Restored the earlier export because the revision introduced additional measured issues.");
        break;
      }
      const repair = suggestRepair(report, {
        ...adjustment,
        iteration: i,
        maxIterations: limit,
        ...(previous ? { previous } : {}),
        budget: { spent: 0, next: 0, limit: 0 },
      });
      const improve =
        i < limit && !settings.captionStyle?.repairWindows
          ? report.issues
              .filter((q) => ["caption-presence", "caption-contrast"].includes(q.code))
              .map((q) => ({ start: q.start, end: q.end }))
          : [];
      const lowerMusic = i < limit && !mixRepairs.length ? (voiceReview?.intervals ?? []) : [];
      if (!repair && !improve.length && !lowerMusic.length) break;
      if (lowerMusic.length) mixRepairs = lowerMusic;
      if (improve.length) settings.captionStyle = { ...settings.captionStyle, repairWindows: improve };
      previous = report.metrics;
      if (repair) adjustment = { brightness: repair.brightness, gainDb: repair.gainDb };
      progress("Revising picture or sound from the measured result", 0.45);
    }
    await closeAudioClassifier();
    if (mixRepairs.length)
      notes.push(
        "Lowered added audio over " +
          mixRepairs.map((w) => w.start.toFixed(1) + "–" + w.end.toFixed(1) + "s").join(", ") +
          " after comparing speech in the export with the source.",
      );
    const metadata = JSON.parse(
      JSON.stringify({
        sourceDigests: signature,
        approvedLook: {
          zoom: format.zoom,
          transition: settings.motion ? format.transition : "cut",
          stationary: !settings.motion || memory.stationary,
          captionWords: edl.captions.maxWordsPerPage,
          captionStyle: settings.captionStyle ?? {},
          musicDb: edl.audio.music?.gainDb ?? null,
          accent: edl.audio.sfx[0]?.file ?? null,
        },
        memory: { family: memory.family, context: memory.context, applied: memory.rules, editId: crypto.randomUUID() },
        settings,
        decisions: reasons,
        grade: { ...grade, ...adjustment },
        broll,
        illustration,
        effects: { segments: edl.segments, transitions: edl.transitions, overlays: edl.overlays, audio: edl.audio },
        faceTarget: learnedFaceTarget,
        faces: media.filter((m) => m.faces?.centers.length).map((m) => ({ clip: m.clip, ...m.faces })),
        sourceSound: media
          .filter((m) => m.events)
          .map((m) => ({ clip: m.clip, model: soundModel, summary: summarizeSound(m.events), windows: m.events })),
        portraitMattes: portrait.observations,
        screens: media.filter((m) => m.screen).map((m) => ({ clip: m.clip, ...m.screen })),
        semanticObservations: media.flatMap((m) => m.semantic ?? []),
        referenceStyle: format.id,
        referenceRevision: format.profile?.revision,
        quality: iterations,
      }),
    );
    let cut = buildPortableCut({
      title,
      output: dimensions,
      sources: bindings,
      segments: edl.segments,
      captions: rendered.captions.map((c) => ({
        clip: c.clip,
        sceneId: c.sceneId,
        start: c.sourceStart,
        end: c.sourceEnd,
        text: c.text,
      })),
      metadata,
    });
    if (data.revision) cut = { ...cut, revision: data.revision.revision };
    notes.unshift(...decisions.map((d) => d.detail));
    for (const issue of report.issues)
      notes.push(issue.start.toFixed(1) + "–" + issue.end.toFixed(1) + "s · " + issue.basis);
    if (broll) notes.push("B-roll: " + broll.reason);
    notes.push(
      "Checked " +
        report.checks.filter((c) => c.status === "pass").length +
        " delivery measurements on the exported MP4.",
    );
    let matteFiles = [];
    try {
      matteFiles = exportPortraitMasks(core, run, edl, media, portrait.results);
    } catch {
      notes.push("The portrait cut is ready, but the separate mask video could not be exported.");
    }
    self.postMessage(
      {
        result: {
          ...rendered,
          cut,
          matteFiles,
          notes,
          report,
          iterations,
          sourceSeconds: media.reduce((n, m) => n + m.seconds, 0),
        },
      },
      [rendered.bytes.buffer, ...matteFiles.map((f) => f.bytes.buffer)],
    );
  } catch (error) {
    self.postMessage({ error: error?.message || "This video could not be edited." });
  }
};
