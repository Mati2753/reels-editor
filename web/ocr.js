import { captionScan } from "./caption-scan";
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
    const observations = [];
    for (const frame of frames) {
      const image = new Blob([frame.bytes], { type: "image/png" });
      const bitmap = await createImageBitmap(image);
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
      const scan = frame.guide && captionScan(pixels, frame.width, frame.height, frame.guide);
      let source = image,
        transform = null;
      if (scan) {
        source = await scan.picture.convertToBlob({ type: "image/png" });
        transform = scan;
      }
      await worker.setParameters({ tessedit_pageseg_mode: scan ? PSM.SINGLE_LINE : PSM.SPARSE_TEXT });
      let result = await worker.recognize(source, {}, { blocks: true });
      if (scan && (!result.data.text.trim() || result.data.confidence < 65)) {
        transform = null;
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        result = await worker.recognize(image, {}, { blocks: true });
      }
      for (const block of result.data.blocks ?? [])
        for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines) {
            if (line.confidence < 65 || !/[\p{L}\p{N}]/u.test(line.text)) continue;
            const bounds = transform
              ? {
                  x0: Math.max(0, Math.floor(transform.left + line.bbox.x0 / transform.scale)),
                  x1: Math.min(frame.width, Math.ceil(transform.left + line.bbox.x1 / transform.scale)),
                  y0: Math.max(0, Math.floor(transform.top + line.bbox.y0 / transform.scale)),
                  y1: Math.min(frame.height, Math.ceil(transform.top + line.bbox.y1 / transform.scale)),
                }
              : line.bbox;
            const { x0, x1, y0, y1 } = bounds;
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
              ink: estimateInk(pixels, frame.width, frame.height, bounds),
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
