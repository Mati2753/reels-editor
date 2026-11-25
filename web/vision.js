// Model weights download to the device. Pixel data never leaves this worker.
const revision = "6b7c523703ae26e39be4b03774966f8571c7f523";
self.onmessage = async ({ data }) => {
  try {
    const { pipeline, env, RawImage } = await import(
      "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"
    );
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/";
    const classify = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32", {
      revision,
      quantized: true,
      progress_callback: (p) => {
        if (p.status === "progress" && p.total)
          self.postMessage({ stage: "Loading visual understanding · " + Math.round((p.loaded * 100) / p.total) + "%" });
      },
    });
    const labels = [
      "a person talking to the camera",
      "a hands-on demonstration",
      "a screen with text or graphics",
      "a natural landscape",
      "a product close-up",
      "a busy street or indoor scene",
    ];
    const observations = [];
    for (const frame of data) {
      const image = new RawImage(new Uint8ClampedArray(frame.rgb), frame.width, frame.height, 3);
      const ranked = await classify(image, labels);
      const top = ranked[0],
        runner = ranked[1];
      observations.push({
        clip: frame.clip,
        at: frame.at,
        label: top.score >= 0.45 && top.score - runner.score > 0.12 ? top.label : null,
        score: top.score,
        margin: top.score - runner.score,
        model: "Xenova/clip-vit-base-patch32",
        revision,
        basis: "Zero-shot comparison of six supplied descriptions on this frame",
        kind: "inference",
      });
    }
    self.postMessage({ observations });
  } catch (error) {
    self.postMessage({ error: error?.message || "Visual model unavailable." });
  }
};
