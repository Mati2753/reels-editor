import { openBrowser, renderStill } from "@remotion/renderer";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { readJson, type ProjectPaths } from "../pipeline/project";
import { ProbeSchema } from "../pipeline/schemas";
import { exists, fingerprint, StepState, writeJsonIfChanged } from "../pipeline/util/state";
import { previewFrames } from "./keyframes";
import { resolvedProject, type EdlTarget } from "./project";
import { browserExecutable, bundleReel, chromiumOptions, rendererFingerprint, selectReel } from "./remotion";

/** Bump when the choice of instants or the still format changes. */
const PREVIEW_VERSION = 1;

export interface PreviewOptions {
  browserExecutable?: string;
  /** Extra instants, seconds of output. */
  at?: number[];
}

/**
 * `reels preview <slug>`: stills of the instants that matter into out/preview/, with
 * out/preview/index.json listing why each one was taken. A still is rendered again only
 * when the EDL, the clips or the renderer changed.
 */
export async function preview(paths: ProjectPaths, target: EdlTarget, options: PreviewOptions, log: (m: string) => void): Promise<{ rendered: string[]; skipped: string[]; dir: string }> {
  const edl = await resolvedProject(paths, target, log);
  const probe = await readJson(paths.probe, ProbeSchema, `run "reels ingest ${paths.slug}" first.`);
  const raw = JSON.parse(await readFile(target.file, "utf8")) as { captions?: { overrides?: { word: string }[] } };
  const overridden = new Set((raw.captions?.overrides ?? []).map((o) => o.word));
  const frames = previewFrames(edl, overridden);
  for (const s of options.at ?? []) frames.push({ frame: Math.min(edl.durationInFrames - 1, Math.round(s * edl.fps)), reasons: ["asked"] });

  const own = target.name === paths.slug;
  const dir = path.join(paths.out, own ? "preview" : `preview-${target.name}`);
  await mkdir(dir, { recursive: true });
  const state = await StepState.load(paths.work, own ? "preview" : `preview-${target.name}`);
  const base = fingerprint(PREVIEW_VERSION, edl, probe.clips.map((c) => c.sha256), await rendererFingerprint());
  const name = (f: number, i: number) => `${String(i + 1).padStart(2, "0")}-f${String(f).padStart(5, "0")}.jpg`;
  const wanted = frames.map((f, i) => ({ ...f, file: name(f.frame, i), key: fingerprint(base, f.frame) }));

  const todo: typeof wanted = [];
  for (const w of wanted) {
    if (state.get(w.file) === w.key && (await exists(path.join(dir, w.file)))) continue;
    todo.push(w);
  }
  for (const f of await readdir(dir)) {
    if (f.endsWith(".jpg") && !wanted.some((w) => w.file === f)) await rm(path.join(dir, f));
  }
  for (const k of state.keys()) if (!wanted.some((w) => w.file === k)) state.delete(k);

  if (todo.length > 0) {
    const browser = browserExecutable(options.browserExecutable);
    const serveUrl = await bundleReel(paths, probe, log);
    const instance = await openBrowser("chrome", { browserExecutable: browser, chromiumOptions, logLevel: "error" });
    try {
      const composition = await selectReel(serveUrl, edl, browser, instance);
      for (const w of todo) {
        await renderStill({ composition, serveUrl, frame: w.frame, output: path.join(dir, w.file), imageFormat: "jpeg", jpegQuality: 88, inputProps: { edl }, puppeteerInstance: instance, overwrite: true, logLevel: "error" });
        state.set(w.file, w.key);
        log(`${w.file}  ${(w.frame / edl.fps).toFixed(2)} s  ${w.reasons.join("; ")}`);
      }
    } finally {
      await instance.close({ silent: true });
    }
  }
  await writeJsonIfChanged(
    path.join(dir, "index.json"),
    wanted.map((w) => ({ file: w.file, frame: w.frame, time: Math.round((w.frame / edl.fps) * 1000) / 1000, reasons: w.reasons })),
  );
  await state.save();
  return { rendered: todo.map((t) => t.file), skipped: wanted.filter((w) => !todo.includes(w)).map((w) => w.file), dir };
}
