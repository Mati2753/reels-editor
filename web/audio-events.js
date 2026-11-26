import { inferSoundWindows } from "../src/intelligence/audio-events";
import { localModelRuntime } from "./model-runtime";
let ready;
async function open(asset) {
  if (!ready)
    ready = (async () => {
      const ort = localModelRuntime();
      const [bytes, map] = await Promise.all([asset("audio-model/yamnet.bin"), asset("audio-model/labels.json")]);
      return {
        ort,
        session: await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] }),
        labels: JSON.parse(new TextDecoder().decode(map)),
      };
    })();
  return ready;
}
export async function classifyAudio(pcm, asset) {
  if (!pcm?.length) return [];
  const { session, labels, ort } = await open(asset);
  return inferSoundWindows(pcm, labels, async (chunk) => {
    const wave = new ort.Tensor("float32", chunk, [chunk.length]);
    try {
      const output = (await session.run({ waveform: wave }, ["output_0"])).output_0;
      try {
        return output.data.slice();
      } finally {
        output.dispose();
      }
    } finally {
      wave.dispose();
    }
  });
}
export async function closeAudioClassifier() {
  if (!ready) return;
  const current = ready;
  ready = undefined;
  try {
    await (await current).session.release();
  } catch {
    /* A failed load has no live session. */
  }
}
