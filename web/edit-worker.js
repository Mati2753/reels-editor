import { findBeats, localSelection, buildEdit } from "../src/studio/director";
import { importSrt } from "../src/studio/subtitles";
import { median } from "../src/studio/format-model";
import { inspect, learn, analysisFor } from "./facts";
import { render } from "./render";

const progress = (stage, value) => self.postMessage({ stage, value });
const getAsset = async (name) => {
  const res = await fetch(new URL("assets/" + name, self.location.href));
  if (!res.ok) throw Error("A studio asset could not load. Please try again.");
  return new Uint8Array(await res.arrayBuffer());
};

async function loadVideoEngine() {
  const coreURL = new URL("ffmpeg-core.js", self.location.href).href;
  importScripts(coreURL);
  const parts = await Promise.all([getAsset("engine-0.bin"), getAsset("engine-1.bin")]);
  const wasmBinary = new Uint8Array(parts[0].length + parts[1].length);
  wasmBinary.set(parts[0]);
  wasmBinary.set(parts[1], parts[0].length);
  const locator = btoa(JSON.stringify({ wasmURL: coreURL.replace(/\.js$/, ".wasm"), workerURL: "" }));
  return self.createFFmpegCore({ wasmBinary, mainScriptUrlOrBlob: coreURL + "#" + locator });
}

async function listen(samples) {
  const child = new Worker(new URL("speech.js", self.location.href), { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      let timer;
      const wait = () => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(Error("Speech recognition timed out.")), 120000);
      };
      wait();
      child.onmessage = ({ data }) => {
        if (data.stage) {
          progress(data.stage, 0.29);
          wait();
          return;
        }
        clearTimeout(timer);
        if (data.error) reject(Error(data.error));
        else resolve(data.words ?? []);
      };
      child.onerror = (e) => {
        clearTimeout(timer);
        reject(Error(e.message));
      };
      child.postMessage(samples, [samples.buffer]);
    });
  } finally {
    child.terminate();
  }
}

self.onmessage = async ({ data: { kind, file, format, settings, title, supplied, example } }) => {
  try {
    progress("Opening the editing engine", 0.04);
    const core = await loadVideoEngine();
    // WORKERFS reads File slices on demand instead of copying the full upload into RAM.
    let mounted = false;
    if (core.FS.filesystems.WORKERFS) {
      core.FS.mkdir("source");
      core.FS.mount(core.FS.filesystems.WORKERFS, { blobs: [{ name: "clip", data: file }] }, "/source");
      core.FS.symlink("/source/clip", "input");
      mounted = true;
    }
    if (!mounted) {
      if (file.size > 300 * 1024 * 1024) throw Error("Choose a video under 300 MB for this browser.");
      core.FS.writeFile("input", new Uint8Array(await file.arrayBuffer()));
    }
    function run(args, tick) {
      const lines = [];
      core.setLogger((e) => lines.push(e.message));
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
            lines
              .slice(-6)
              .filter((x) => !x.includes("Aborted"))
              .join(" ")
              .slice(-530),
        );
      return lines.join("\n");
    }
    progress(kind === "learn" ? "Measuring the reference video" : "Finding scene changes and pauses", 0.14);
    const media = inspect(core, run);
    if (kind === "learn") {
      let cueWords = null;
      const probe = JSON.parse(core.FS.readFile("probe.json", { encoding: "utf8" }));
      const subs = probe.streams.find(
        (s) => s.codec_type === "subtitle" && ["mov_text", "subrip", "webvtt", "ass", "ssa"].includes(s.codec_name),
      );
      if (subs) {
        try {
          run(["-i", "input", "-map", "0:" + subs.index, "-f", "srt", "ref.srt"]);
          const counts = core.FS.readFile("ref.srt", { encoding: "utf8" })
            .trim()
            .split(/\r?\n\s*\n/)
            .map(
              (s) =>
                s
                  .split(/\r?\n/)
                  .slice(2)
                  .join(" ")
                  .replace(/<[^>]*>/g, "")
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean).length,
            )
            .filter(Boolean);
          if (counts.length) cueWords = median(counts);
        } catch {}
      }
      const result = learn(title, media, cueWords);
      try {
        run([
          "-i",
          "input",
          "-frames:v",
          "1",
          "-vf",
          "scale=128:72:force_original_aspect_ratio=increase,crop=128:72",
          "-q:v",
          "6",
          "cover.jpg",
        ]);
        result.image = "data:image/jpeg;base64," + btoa(String.fromCharCode(...core.FS.readFile("cover.jpg")));
      } catch {}
      self.postMessage({ format: result });
      return;
    }
    if (media.duration < 4.99) throw Error("Choose a video at least five seconds long.");
    let words = [],
      note = "";
    if (supplied) words = importSrt(supplied, media.seconds).words;
    else if (example) words = JSON.parse(new TextDecoder().decode(await getAsset("sample-transcript.json"))).words;
    else if (media.audio && media.mean > -55 && settings.captions) {
      progress("Preparing automatic subtitles", 0.24);
      try {
        words = await listen(media.raw);
      } catch {
        note =
          "Automatic subtitles were unavailable for this edit. You can attach an SRT subtitle file in Edit settings.";
      }
    }
    words = words
      .filter((w) => w.start < media.duration && w.end > w.start)
      .map((w) => ({ ...w, end: Math.min(w.end, media.duration) }));
    if (settings.captions && !note && !words.length)
      note = media.audio ? "No spoken words were detected." : "The source has no audio track.";
    const facts = analysisFor(media, words);
    const probe = {
      clips: [{ id: "c1", normalized: { duration: media.duration, frames: Math.round(media.duration * 30) } }],
    };
    progress("Choosing the cut", 0.42);
    const beats = findBeats(probe, facts, format, settings);
    const { edl, decisions } = buildEdit(
      title,
      "auto",
      facts,
      beats,
      localSelection(beats, settings),
      format,
      settings,
    );
    const rendered = await render(core, run, edl, facts, media, getAsset, progress);
    const notes = decisions.map((d) => d.detail);
    if (note) notes.push(note);
    if (media.seconds > media.duration) notes.push("The director used the first three minutes of this video.");
    self.postMessage({ result: { ...rendered, notes, sourceSeconds: media.seconds } }, [rendered.bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error?.message || "This video could not be edited." });
  }
};
