import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { soundModel, inferSoundWindows } from "./audio-events";
export async function recognizeSound(pcm: Float32Array) {
  const base = new URL("../../assets/audio-model/", import.meta.url);
  const [bytes, map, ort] = await Promise.all([
    readFile(new URL("yamnet.bin", base)),
    readFile(new URL("labels.json", base), "utf8"),
    import("onnxruntime-web/wasm"),
  ]);
  if (createHash("sha256").update(bytes).digest("hex") !== soundModel.sha256)
    throw Error("The acoustic model failed its integrity check.");
  ort.env.wasm.numThreads = 1;
  const model = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  try {
    return await inferSoundWindows(pcm, JSON.parse(map), async (chunk) => {
      const wave = new ort.Tensor("float32", chunk, [chunk.length]);
      try {
        const result = (await model.run({ waveform: wave }, ["output_0"])).output_0!;
        try {
          return (result.data as Float32Array).slice();
        } finally {
          result.dispose();
        }
      } finally {
        wave.dispose();
      }
    });
  } finally {
    await model.release();
  }
}
