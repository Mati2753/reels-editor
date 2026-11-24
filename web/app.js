import { presets, FormatSchema } from "../src/studio/format-model";

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
  showPreview("edited");
}
function settings() {
  return {
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
function start(kind, file = null) {
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
    const title = file ? displayName(input.name) : existing.title;
    worker = new Worker(new URL("edit-worker.js", document.baseURI));
    const onError = (msg) => {
      stop();
      say(msg);
    };
    worker.onerror = (e) => onError(e.message || "The editor stopped. Please try again.");
    worker.onmessage = ({ data }) => {
      if (thisRun !== token) return;
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
        file: example ? null : input,
        sourceSeconds: r.sourceSeconds,
        seconds: r.seconds,
        scenes: r.scenes,
        notes: r.notes,
      };
      if (file) supplied = "";
      paint();
      stop();
      say("Your reel is ready. Press play to watch it or download your MP4.");
      if (previousProject.output.startsWith("blob:")) URL.revokeObjectURL(previousProject.output);
      if (source !== previousProject.source && previousProject.source.startsWith("blob:"))
        URL.revokeObjectURL(previousProject.source);
    };
    worker.postMessage({
      kind,
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
  if (file) start("edit", file);
};
$("reference").onchange = (e) => {
  const file = e.target.files[0];
  if (file) start("learn", file);
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
