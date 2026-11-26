// Only the model and runtime are fetched. Audio samples stay inside this worker.
const revision = "5332fcc35e32a33b86612b9a57a89be7906102b1";
self.onmessage = async ({ data: samples }) => {
  try {
    const { pipeline, env } = await import(
      "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"
    );
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";
    const progress = (event) => {
      if (event.status === "progress" && event.total && event.file?.endsWith(".onnx")) {
        self.postMessage({
          stage: "Loading speech recognition · " + Math.round((100 * event.loaded) / event.total) + "%",
        });
      }
    };
    const recognize = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
      quantized: true,
      revision,
      progress_callback: progress,
    });
    self.postMessage({ stage: "Listening for spoken words" });
    const result = await recognize(samples, {
      chunk_length_s: 28,
      stride_length_s: 4,
      return_timestamps: "word",
      task: "transcribe",
      force_full_sequences: false,
    });
    const words = (result.chunks || [])
      .filter((c) => c.text.trim() && Number.isFinite(c.timestamp?.[0]))
      .map((c, i, a) => ({
        clip: "c1",
        id: "c1-w" + (i + 1),
        text: c.text.trim(),
        start: c.timestamp[0],
        end: c.timestamp[1] ?? a[i + 1]?.timestamp[0] ?? Math.min(samples.length / 16000, c.timestamp[0] + 0.6),
      }));
    self.postMessage({ words });
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};
