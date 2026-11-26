// Native FFmpeg timestamps determine the sampled source interval. Inference runs entirely in this worker.
import { portraitModel, evaluateMatte } from "../src/intelligence/portrait-matte";
const { size, rate } = portraitModel,
  plane = size * size;
let opening;
async function session(asset) {
  if (!opening)
    opening = (async () => {
      const root = new URL("assets/portrait/", self.location.href).href;
      importScripts(root + "ort.wasm.min.js");
      self.ort.env.wasm.numThreads = 1;
      self.ort.env.wasm.wasmPaths = root;
      const chunks = await Promise.all([asset("portrait/model-0.bin"), asset("portrait/model-1.bin")]);
      const bytes = new Uint8Array(chunks[0].length + chunks[1].length);
      bytes.set(chunks[0]);
      bytes.set(chunks[1], chunks[0].length);
      return self.ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    })();
  return opening;
}
export async function portraitMattes(core, run, edl, media, asset, background, progress) {
  const results = {},
    observations = [];
  if (!/^#[0-9a-f]{6}$/i.test(background)) throw Error("Choose a valid background color.");
  const model = await session(asset);
  const tensor = new self.ort.Tensor("float32", new Float32Array(3 * plane), [1, 3, size, size]);
  for (const [ordinal, seg] of edl.segments.entries()) {
    const src = media.find((m) => m.clip === seg.clip),
      seconds = seg.out - seg.in;
    const started = performance.now();
    const name = "portrait-" + ordinal + ".gray",
      rows = [];
    const output = core.FS.open(name, "w");
    let written = 0,
      accepted = true;
    try {
      for (let offset = 0; offset < seconds - 0.001; offset += 2) {
        const n = Math.ceil(Math.min(2, seconds - offset) * rate - 0.00001);
        run([
          "-ss",
          String(seg.in + offset),
          "-i",
          src.input,
          "-map",
          "0:v:0",
          "-an",
          "-vf",
          "fps=" + rate + ":round=up,scale=" + size + ":" + size,
          "-frames:v",
          String(n),
          "-threads",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "portrait.rgb",
        ]);
        const rgb = core.FS.readFile("portrait.rgb");
        core.FS.unlink("portrait.rgb");
        for (let frame = 0; frame < Math.floor(rgb.length / (3 * plane)); frame++) {
          const base = frame * plane * 3,
            input = tensor.data;
          for (let k = 0; k < plane; k++)
            for (let ch = 0; ch < 3; ch++) input[ch * plane + k] = rgb[base + k * 3 + ch] / 127.5 - 1;
          const outputs = await model.run({ input: tensor });
          const at = seg.in + offset + frame / rate;
          const face = src.faces?.centers.find((p) => Math.abs(p.at - at) < 0.5 / src.faces.rate);
          const {
            mask: matte,
            foreground,
            background,
            faceAlpha,
            accepted: valid,
          } = evaluateMatte(outputs.output.data, size, face);
          outputs.output.dispose();
          rows.push({ at, foreground, background, faceAlpha });
          if (!valid) {
            accepted = false;
            break;
          }
          core.FS.write(output, matte, 0, matte.length);
          written++;
        }
        progress(
          "Separating the portrait in scene " + (ordinal + 1) + " of " + edl.segments.length,
          0.41 + (0.035 * (ordinal + Math.min(1, (offset + 2) / seconds))) / edl.segments.length,
        );
        if (!accepted) break;
      }
    } finally {
      core.FS.close(output);
    }
    accepted = accepted && written >= Math.max(1, Math.floor(seconds * rate) - 1);
    observations.push({
      scene: seg.id,
      clip: seg.clip,
      sourceIn: seg.in,
      sourceOut: seg.out,
      accepted,
      model: portraitModel,
      processingMs: Math.round(performance.now() - started),
      observations: rows,
    });
    if (accepted) results[seg.id] = { file: name, size, rate, background };
    else core.FS.unlink(name);
  }
  tensor.dispose();
  return { results, observations };
}

export function exportPortraitMasks(core, run, edl, media, portraits) {
  const files = [];
  for (const seg of edl.segments) {
    const matte = portraits[seg.id];
    if (!matte) continue;
    const video = media.find((m) => m.clip === seg.clip).meta.video;
    const rotation = Number(video.side_data_list?.find((s) => s.rotation != null)?.rotation ?? video.tags?.rotate ?? 0);
    const [a, b] = String(video.sample_aspect_ratio ?? "1:1")
      .split(":")
      .map(Number);
    let ratio = (video.width / video.height) * (a > 0 && b > 0 ? a / b : 1);
    if (Math.abs(rotation) % 180 === 90) ratio = 1 / ratio;
    const width = ratio >= 1 ? 512 : Math.max(2, Math.round(256 * ratio) * 2);
    const height = ratio <= 1 ? 512 : Math.max(2, Math.round(256 / ratio) * 2);
    run([
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-s",
      size + "x" + size,
      "-framerate",
      String(rate),
      "-i",
      matte.file,
      "-vf",
      "scale=" + width + ":" + height + ",setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=0.25",
      "-frames:v",
      String(Math.max(1, Math.round((seg.out - seg.in) * 30))),
      "-threads",
      "1",
      "-c:v",
      "libx264",
      "-crf",
      "12",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "matte-export.mp4",
    ]);
    files.push({
      scene: seg.id,
      clip: seg.clip,
      start: seg.in,
      end: seg.out,
      bytes: core.FS.readFile("matte-export.mp4"),
    });
    core.FS.unlink("matte-export.mp4");
  }
  return files;
}
