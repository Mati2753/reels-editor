import { estimateInk } from "../src/intelligence/caption-layout";
import { createWorker, PSM } from "tesseract.js";

// One local worker per batch. Image bytes and OCR results never leave the browser.
export async function readScreenText(frames, helpers, active) {
  const path = new URL("assets/ocr/", document.baseURI);
  const worker = await createWorker("eng", 1, {
    workerPath: new URL("worker.min.js", path).href,
    corePath: path.href,
    langPath: path.href.replace(/\/$/, ""),
    workerBlobURL: false,
  });
  if (!active()) {
    await worker.terminate();
    return [];
  }
  helpers.add(worker);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const observations = [];
    for (const frame of frames) {
      const image = new Blob([frame.bytes], { type: "image/png" });
      const { data } = await worker.recognize(image, {}, { blocks: true });
      const bitmap = await createImageBitmap(image);
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
      for (const block of data.blocks ?? [])
        for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines) {
            if (line.confidence < 65 || !line.text.trim()) continue;
            const { x0, y0, x1, y1 } = line.bbox;
            const levels = [];
            const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
            for (let y = y0; y < y1; y += 2)
              for (let x = x0; x < x1; x += 2) {
                const i = (y * frame.width + x) * 4;
                levels.push(
                  0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]),
                );
              }
            levels.sort((a, b) => a - b);
            const contrastRatio = levels.length
              ? (levels[Math.floor(levels.length * 0.9)] + 0.05) / (levels[Math.floor(levels.length * 0.1)] + 0.05)
              : undefined;
            observations.push({
              ink: estimateInk(pixels, frame.width, frame.height, line.bbox),
              contrastRatio,
              at: frame.at,
              text: line.text.trim(),
              confidence: line.confidence / 100,
              x: x0 / frame.width,
              y: y0 / frame.height,
              width: (x1 - x0) / frame.width,
              height: (y1 - y0) / frame.height,
            });
          }
    }
    return observations;
  } finally {
    if (helpers.delete(worker)) await worker.terminate();
  }
}
