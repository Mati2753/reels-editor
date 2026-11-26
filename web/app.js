import { readScreenText } from "./ocr";
import { feedbackChoices, rememberFeedback } from "../src/intelligence/feedback";
import { reviseStyle } from "../src/intelligence/styles";
import { revisePortableCut, exportOpenTimelineIO } from "../src/intelligence/timeline";
import { readLocal, saveLocal, updateLocal } from "./storage";
import { presets, FormatSchema } from "../src/studio/format-model";

const helpers = new Set();
const $ = (id) => document.getElementById(id);
const displayName = (name) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 70) || "Untitled reel";
const sample = {
  title: "Alpine field notes",
  output: "./assets/sample-cut.mp4",
  source: "./assets/alpine-field-notes.mp4",
  seconds: 8.5667,
  scenes: [
    { start: 0, end: 3.0667, name: "Scene 1" },
    { start: 3.0667, end: 5.8, name: "Scene 2" },
    { start: 5.8, end: 8.5667, name: "Scene 3" },
  ],
};
const storageKey = "cutroom-reference-formats-v1";
let saved = [],
  selected = "cinematic",
  project = sample,
  worker = null,
  token = 0,
  supplied = "",
  view = "edited";
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
  saved = (stored.formats || [])
    .map((f) => FormatSchema.safeParse(f))
    .filter((r) => r.success)
    .map((r) => r.data);
  selected = stored.selected || selected;
} catch {}
function remember() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ formats: saved, selected }));
    return true;
  } catch {
    return false;
  }
}
function formats() {
  return [...presets, ...saved];
}
function current() {
  return formats().find((f) => f.id === selected) || presets[0];
}
function listFormats() {
  const select = $("format");
  select.replaceChildren(...formats().map((f) => new Option(f.name, f.id)));
  selected = current().id;
  select.value = selected;
  const style = current();
  $("pace").value = style.shotSeconds.toFixed(1);
  $("cue").value = String(style.captionWords);
  $("evidence").hidden = !style.profile?.references.length;
  $("description").textContent = style.description;
  $("style-image").src = style.image.startsWith("/assets/") ? "." + style.image : style.image;
}
function say(text, value = null) {
  $("message").hidden = !text;
  $("status").textContent = text;
  $("progress").hidden = value === null;
  if (value !== null) $("progress").value = value;
}
const busyControls = ["choose", "learn", "remake", "format", "target", "captions", "motion", "sound", "add-srt"];
function setBusy(active) {
  busyControls.forEach((id) => ($(id).disabled = active));
  $("cancel").hidden = !active;
}
function stop() {
  for (const helper of helpers) helper.terminate();
  helpers.clear();
  token++;
  if (worker) worker.terminate();
  worker = null;
  setBusy(false);
}
function showPreview(mode, play = false, at = 0) {
  const video = $("preview"),
    src = mode === "original" ? project.source : project.output;
  if (view !== mode || video.getAttribute("src") !== src) {
    video.pause();
    video.removeAttribute("poster");
    video.src = src;
    video.load();
  }
  view = mode;
  $("edited").setAttribute("aria-pressed", String(view === "edited"));
  $("original").setAttribute("aria-pressed", String(view === "original"));
  if (play) {
    const start = () => {
      video.currentTime = at;
      video.play().catch(() => {});
    };
    if (video.readyState >= 1) start();
    else video.addEventListener("loadedmetadata", start, { once: true });
  }
}
function paint() {
  $("project").textContent = project.title;
  $("meta").textContent = project === sample ? "Sample project · Vertical reel" : "Your project · Vertical reel";
  $("save").href = project.output;
  $("save").download = project.title + ".mp4";
  $("length").textContent = project.seconds.toFixed(1) + " seconds";
  $("shots").replaceChildren(
    ...project.scenes.map((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s.name;
      b.style.flex = String(s.end - s.start) + " 1 0px";
      b.title = "Play scene " + (i + 1) + " at " + s.start.toFixed(1) + " seconds";
      b.onclick = () => showPreview("edited", true, s.start);
      return b;
    }),
  );
  if (project.notes)
    $("notes").replaceChildren(
      ...project.notes.map((n) => {
        const li = document.createElement("li");
        li.textContent = n;
        return li;
      }),
    );
  const memory = project.cut?.metadata?.memory;
  $("feedback-panel").hidden = !memory;
  $("feedback-choice").replaceChildren(
    ...Object.entries(feedbackChoices)
      .filter(
        ([key]) =>
          (!key.startsWith("keep-") || !!project.cut?.metadata?.approvedLook) &&
          (key !== "reject-insert" || project.cut?.metadata?.broll),
      )
      .map(([key, label]) => new Option(label, key)),
  );
  $("timeline-tools").hidden = !project.cut;
  if (project.cut) {
    $("scene").replaceChildren(...project.cut.scenes.map((v, i) => new Option("Scene " + (i + 1), v.id)));
    setTrim();
    $("preview").style.aspectRatio = project.cut.output.width + "/" + project.cut.output.height;
    $("meta").textContent =
      project.cut.sources.length + " source clip(s) · " + project.cut.output.width + " × " + project.cut.output.height;
  }
  showPreview("edited");
}
function settings() {
  return {
    ratio: $("ratio").value,
    quality: $("quality").value,
    screen: $("screen").checked,
    portrait: $("portrait").checked,
    faces: $("faces").checked,
    background: $("background").value,
    visual: $("visual").checked,
    broll: $("broll").checked,
    iterations: Number($("iterations").value),
    format: selected,
    target: Number($("target").value),
    cuts: true,
    motion: $("motion").checked,
    captions: $("captions").checked,
    sound: $("sound").checked,
    director: "local",
    brief: "",
  };
}
function selectFile(id) {
  $(id).value = "";
  $(id).click();
}
function start(kind, files = null, revision = null) {
  const file = files?.[0] ?? null;
  stop();
  const thisRun = token;
  const existing = project;
  setBusy(true);
  say(kind === "learn" ? "Opening your reference video" : "Opening your footage", 0.01);
  const work = async () => {
    const example = kind !== "learn" && !file && !existing.file;
    const input =
      file ||
      existing.file ||
      (await (async () => {
        const res = await fetch(sample.source);
        if (!res.ok) throw Error("The sample footage could not load.");
        return new File([await res.blob()], "alpine-field-notes.mp4", { type: "video/mp4" });
      })());
    if (thisRun !== token) return;
    const inputs = files || existing.files || [input];
    const title = file
      ? displayName(input.name) + (inputs.length > 1 ? " + " + (inputs.length - 1) : "")
      : existing.title;
    worker = new Worker(new URL("edit-worker.js", document.baseURI));
    const family = current().profile?.family ?? current().id;
    const onError = (msg) => {
      void writeHistory({ date: new Date().toISOString(), family, kind, status: "failed", message: msg });
      stop();
      say(msg);
    };
    worker.onerror = (e) => onError(e.message || "The editor stopped. Please try again.");
    worker.onmessage = async ({ data }) => {
      if (thisRun !== token) return;
      if (data.model && data.port) {
        const port = data.port;
        if (data.model === "ocr") {
          port.onmessage = async ({ data: frames }) => {
            try {
              port.postMessage({ observations: await readScreenText(frames, helpers, () => thisRun === token) });
            } catch {
              port.postMessage({ error: "Local OCR is unavailable." });
            } finally {
              port.close();
            }
          };
          return;
        }
        if (!["speech", "vision"].includes(data.model)) {
          port.postMessage({ error: "Unknown model" });
          return;
        }
        try {
          const helper = new Worker(new URL(data.model + ".js", document.baseURI), { type: "module" });
          helpers.add(helper);
          helper.onmessage = ({ data: reply }) => {
            port.postMessage(reply);
            if (!reply.stage) {
              helper.terminate();
              helpers.delete(helper);
              port.close();
            }
          };
          helper.onerror = () => {
            port.postMessage({ error: "Model could not start" });
            helper.terminate();
            helpers.delete(helper);
            port.close();
          };
          port.onmessage = ({ data: payload }) =>
            helper.postMessage(payload, payload instanceof Float32Array ? [payload.buffer] : []);
        } catch {
          port.postMessage({ error: "Model worker unavailable" });
        }
        return;
      }
      if (data.stage) {
        say(data.stage, data.value);
        return;
      }
      if (data.error) {
        onError(data.error);
        return;
      }
      if (data.format) {
        if (saved.length >= 50) {
          onError("Your style library is full on this device.");
          return;
        }
        for (const e of data.evidences ?? []) await saveLocal("reference:" + e.id, e);
        saved.push(data.format);
        selected = data.format.id;
        const persisted = remember();
        listFormats();
        stop();
        say(
          persisted
            ? "Style saved. Your next video will use " + data.format.name + "."
            : "Style selected for this tab. Your browser could not save it for your next visit.",
        );
        return;
      }
      if (!data.result) return;
      const r = data.result;
      const output = URL.createObjectURL(new Blob([r.bytes], { type: "video/mp4" }));
      const source = file ? URL.createObjectURL(input) : existing.source;
      const previousProject = project;
      project = {
        title,
        output,
        source,
        files: example ? null : inputs,
        cut: r.cut,
        report: r.report,
        iterations: r.iterations,
        file: example ? null : input,
        sourceSeconds: r.sourceSeconds,
        seconds: r.seconds,
        scenes: r.scenes,
        matteFiles: r.matteFiles ?? [],
        notes: r.notes,
      };
      if (file) supplied = "";
      paint();
      void writeHistory({
        date: new Date().toISOString(),
        status: "rendered",
        cut: r.cut,
        previousEdit: (!file && existing.cut?.metadata?.memory?.editId) || null,
      });
      void saveLocal("last-result", { ...project, output: new Blob([r.bytes], { type: "video/mp4" }), example });
      stop();
      say("Your reel is ready. Press play to watch it or download your MP4.");
      if (previousProject.output.startsWith("blob:")) URL.revokeObjectURL(previousProject.output);
      if (source !== previousProject.source && previousProject.source.startsWith("blob:"))
        URL.revokeObjectURL(previousProject.source);
    };
    worker.postMessage({
      kind,
      files: inputs,
      revision,
      file: input,
      title,
      format: current(),
      settings: settings(),
      supplied: file ? "" : supplied,
      example,
    });
  };
  work().catch((e) => {
    if (token === thisRun) {
      stop();
      say(e.message || "This video could not be opened.");
    }
  });
}
$("choose").onclick = () => selectFile("file");
$("learn").onclick = () => selectFile("reference");
$("file").onchange = (e) => {
  const file = e.target.files[0];
  if (file) start("edit", Array.from(e.target.files));
};
$("reference").onchange = (e) => {
  const file = e.target.files[0];
  if (file) start("learn", Array.from(e.target.files));
};
$("format").onchange = (e) => {
  selected = e.target.value;
  remember();
  listFormats();
  say("Style selected. Choose a video or re-edit this one.");
};
$("remake").onclick = () => start("edit");
$("cancel").onclick = () => {
  stop();
  say("Edit cancelled.");
};
$("original").onclick = () => showPreview("original");
$("edited").onclick = () => showPreview("edited");
$("add-srt").onclick = () => selectFile("srt");
$("srt").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    supplied = await f.text();
    $("captions").checked = true;
    start("edit");
  } catch {
    say("The subtitle file could not be read.");
  }
};
listFormats();
paint();

function download(name, value) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    value instanceof Blob ? value : new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function setTrim() {
  const s = project.cut?.scenes.find((s) => s.id === $("scene").value);
  $("mask-download").hidden = !project.matteFiles?.some((f) => f.scene === s?.id);
  if (s) {
    $("trim-start").value = (s.inFrame / 30).toFixed(3);
    $("trim-end").value = (s.outFrame / 30).toFixed(3);
  }
}
$("scene").onchange = setTrim;
$("trim").onclick = () => {
  try {
    const rev = revisePortableCut(project.cut, [
      {
        sceneId: $("scene").value,
        inFrame: Math.round(Number($("trim-start").value) * 30),
        outFrame: Math.round(Number($("trim-end").value) * 30),
      },
    ]);
    start("edit", null, rev);
  } catch {
    say("Choose a start and end inside this source clip.");
  }
};
$("cut-json").onclick = () => download(project.title + ".cut.json", project.cut);
$("otio").onclick = () => download(project.title + ".otio", exportOpenTimelineIO(project.cut));
$("qa").onclick = () => download(project.title + "-quality.json", project.iterations);
$("remember-style").onclick = () => {
  try {
    const original = current();
    const revised = reviseStyle(
      original,
      { cadence: Number($("pace").value), captionWords: Number($("cue").value) },
      "ref-" + crypto.randomUUID(),
      "User changed shot pacing and subtitle grouping",
    );
    revised.name = original.name.replace(/ · v[0-9]+$/, "") + " · v" + revised.profile.revision;
    saved.push(revised);
    selected = revised.id;
    const ok = remember();
    listFormats();
    say(ok ? "New style version saved for future edits." : "Style changed for this session.");
  } catch {
    say("Choose a shot length from 0.8 to 12 seconds.");
  }
};
$("evidence").onclick = async () => {
  const refs = current().profile?.references || [];
  const evidence = await Promise.all(refs.map((r) => readLocal("reference:" + r.id)));
  download(current().name + "-evidence.json", { style: current(), evidence: evidence.filter(Boolean) });
};
readLocal("last-result").then((last) => {
  if (last && token === 0 && !worker && last.output instanceof Blob) {
    project = {
      ...last,
      source: last.example ? sample.source : URL.createObjectURL(last.files[0]),
      output: URL.createObjectURL(last.output),
    };
    paint();
  }
});

function writeHistory(record) {
  return updateLocal("director-history", (history) => [...(history ?? []), record].slice(-30));
}
$("remember-feedback").onclick = async () => {
  const meta = project.cut?.metadata;
  if (!meta?.memory) return;
  const example = project;
  const entry = {
    family: meta.memory.family,
    context: meta.memory.context,
    editId: meta.memory.editId,
    sample: meta.approvedLook,
    choice: $("feedback-choice").value,
    timestamp: new Date().toISOString(),
    asset: meta.broll?.assetId ?? null,
  };
  const ok = await updateLocal("director-feedback", (history) => rememberFeedback(history, entry));
  let storedExample = true;
  if (ok) {
    await writeHistory({ status: "feedback", ...entry });
    if (entry.choice.startsWith("keep-")) {
      try {
        const edited = await (await fetch(example.output)).blob();
        const files = example.files?.length
          ? example.files
          : [new File([await (await fetch(example.source)).blob()], example.title + ".mp4", { type: "video/mp4" })];
        storedExample = await updateLocal("approved-examples", (prior) =>
          [
            ...(prior ?? []).filter((v) => v.id !== entry.editId),
            { id: entry.editId, title: example.title, files, edited, date: entry.timestamp },
          ].slice(-3),
        );
        await loadExamples();
      } catch {
        storedExample = false;
      }
    }
  }
  say(
    ok
      ? storedExample
        ? "Saved. The director will use this feedback on similar videos in this style."
        : "Feedback saved. There was too little storage to keep a video example."
      : "Your browser could not save the feedback.",
  );
};
$("clear-feedback").onclick = async () => {
  const m = project.cut?.metadata?.memory;
  if (!m) return;
  const ok = await updateLocal("director-feedback", (rules) =>
    (rules ?? []).filter((r) => r.family !== m.family || r.context !== m.context),
  );
  say(ok ? "Cleared the feedback for this style and footage type." : "Your browser could not clear the feedback.");
};
$("history").onclick = async () => download("director-history.json", (await readLocal("director-history")) ?? []);

$("screen").onchange = () => {
  if ($("screen").checked) $("portrait").checked = false;
};
$("portrait").onchange = () => {
  if ($("portrait").checked) $("screen").checked = false;
};

$("mask-download").onclick = () => {
  const matte = project.matteFiles?.find((f) => f.scene === $("scene").value);
  if (matte)
    download(project.title + "-" + matte.scene + "-source-mask.mp4", new Blob([matte.bytes], { type: "video/mp4" }));
};

let approvedExamples = [],
  exampleUrl = null;
async function loadExamples() {
  approvedExamples = (await readLocal("approved-examples")) ?? [];
  $("examples-panel").hidden = !approvedExamples.length;
  $("approved-example").replaceChildren(
    ...approvedExamples
      .slice()
      .reverse()
      .map((e) => new Option(e.title + " · " + new Date(e.date).toLocaleDateString(), e.id)),
  );
  populateSources();
}
function populateSources() {
  const e = approvedExamples.find((v) => v.id === $("approved-example").value);
  $("example-source").replaceChildren(
    new Option("Director’s cut", "edit"),
    ...(e?.files ?? []).map((f, i) => new Option("Original · " + f.name, String(i))),
  );
  $("example-video").removeAttribute("src");
  $("example-video").load();
  $("example-video").hidden = true;
  if (exampleUrl) URL.revokeObjectURL(exampleUrl);
  exampleUrl = null;
}
$("approved-example").onchange = populateSources;
$("watch-example").onclick = () => {
  const e = approvedExamples.find((v) => v.id === $("approved-example").value);
  if (!e) return;
  const which = $("example-source").value,
    file = which === "edit" ? e.edited : e.files[Number(which)];
  if (exampleUrl) URL.revokeObjectURL(exampleUrl);
  exampleUrl = URL.createObjectURL(file);
  $("example-video").src = exampleUrl;
  $("example-video").hidden = false;
  $("example-video")
    .play()
    .catch(() => {});
};
loadExamples();

$("forget-example").onclick = async () => {
  const id = $("approved-example").value;
  if (await updateLocal("approved-examples", (list) => (list ?? []).filter((e) => e.id !== id))) await loadExamples();
};
