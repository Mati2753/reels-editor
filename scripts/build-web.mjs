import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.resolve(process.argv[2] || path.join(root, "dist/browser"));
await mkdir(path.join(out, "assets"), { recursive: true });
await cp(path.join(root, "assets/vision"), path.join(out, "assets/vision"), { recursive: true });
const ocr = path.join(out, "assets/ocr");
await mkdir(ocr, { recursive: true });
for (const name of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "LICENSE"]) {
  await cp(path.join(root, "node_modules/tesseract.js-core", name), path.join(ocr, name));
}
await cp(path.join(root, "node_modules/tesseract.js/dist/worker.min.js"), path.join(ocr, "worker.min.js"));
await cp(
  path.join(root, "node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt"),
  path.join(ocr, "worker.min.js.LICENSE.txt"),
);
await cp(
  path.join(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
  path.join(ocr, "eng.traineddata.gz"),
);
for (const file of ["index.html", "studio.css", "speech.js", "vision.js"]) {
  await cp(path.join(root, "web", file), path.join(out, file));
}
for (const file of [
  "sample-cut.mp4",
  "sample-cover.jpg",
  "alpine-field-notes.mp4",
  "sample-cut.json",
  "sample-transcript.json",
  "alpine.jpg",
  "forest.jpg",
  "lake.jpg",
  "dm-sans.woff2",
  "DM-Sans-OFL.txt",
]) {
  await cp(path.join(root, "assets/studio", file), path.join(out, "assets", file));
}
for (const file of [
  "fonts/Montserrat-ExtraBold.ttf",
  "fonts/Montserrat-OFL.txt",
  "music/drift.m4a",
  "sfx/pulse.wav",
  "sfx/sweep.wav",
  "LICENSES.md",
]) {
  await cp(path.join(root, "assets", file), path.join(out, "assets", path.basename(file)));
}
await cp(path.join(root, "assets/library"), path.join(out, "assets"), { recursive: true });
await cp(path.join(root, "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js"), path.join(out, "ffmpeg-core.js"));
// Each part is below the static host's single-asset limit. The editor loads these only on first use.
const binary = await readFile(path.join(root, "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"));
const midpoint = Math.ceil(binary.length / 2);
await writeFile(path.join(out, "assets/engine-0.bin"), binary.subarray(0, midpoint));
await writeFile(path.join(out, "assets/engine-1.bin"), binary.subarray(midpoint));
await cp(path.join(root, "web/FFmpeg-COPYING.txt"), path.join(out, "assets/FFmpeg-COPYING.txt"));
await build({
  entryPoints: [path.join(root, "web/app.js"), path.join(root, "web/edit-worker.js")],
  outdir: out,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
});
