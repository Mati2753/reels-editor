import { describe, expect, it } from "vitest";
import { presets } from "../studio/format-model";
import { rememberFeedback, recallFeedback } from "./feedback";
import { inferCaptionLayout } from "./caption-layout";
import { trackScreen } from "./screen";
import { assessRender } from "./quality";

const original = presets[0]!;
const entry = {
  family: original.id,
  context: "speech",
  choice: "quiet-music",
  asset: null,
  editId: "edit-1",
  timestamp: "2025-01-02T01:00:00Z",
};
describe("editing evidence", () => {
  it("retrieves applicable preferences without mutating the template or accumulating the gain", () => {
    const history = rememberFeedback(rememberFeedback([], entry), entry);
    expect(history).toHaveLength(1);
    expect(recallFeedback(history, original, true).format.musicDb).toBe(original.musicDb! - 8);
    expect(recallFeedback(history, original, false).rules).toHaveLength(0);
    expect(recallFeedback(history, presets[1]!, true).rules).toHaveLength(0);
    expect(() => rememberFeedback([], { ...entry, choice: "reject-insert" })).toThrow();
  });
  it("infers caption bands only from different legible text at multiple times", () => {
    const line = { at: 0.5, confidence: 0.91, x: 0.25, y: 0.65, width: 0.5, height: 0.09, text: "A bright morning" };
    const next = { ...line, at: 1.5, text: "Another day" };
    expect(inferCaptionLayout([line, next])?.center).toBeCloseTo(0.695);
    expect(inferCaptionLayout([line, { ...line, at: 1.5 }])).toBeNull();
    expect(inferCaptionLayout([line, { ...next, confidence: 0.1 }])).toBeNull();
  });
  it("tracks coherent foreground motion and abstains for a gray surround", () => {
    const data = new Uint8Array(16 * 16 * 3 * 4);
    for (let f = 0; f < 4; f++)
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const i = ((f * 16 + y) * 16 + x) * 3;
          const fg = y > 4 && y < 12 && x >= 3 + f && x < 7 + f;
          data[i + Number(!fg)] = 220;
        }
    const found = trackScreen(data, 16, 16, 4, "#334455");
    expect(found?.color).toBe("#00dc00");
    expect(found!.centers.at(-1)!.x).toBeGreaterThan(found!.centers[0]!.x);
    expect(trackScreen(data.fill(128), 16, 16, 4, "#334455")).toBeNull();
    expect(() => trackScreen(data, 16, 16, 0, "#invalid")).toThrow();
  });
  it("keeps unsampled captions out of sampled OCR failure counts", () => {
    const format = { width: 360, height: 640, fps: 30 };
    const result = assessRender({
      expected: {
        ...format,
        frames: 120,
        captions: [
          { start: 0, end: 1, text: "hello" },
          { start: 2, end: 3, text: "future" },
        ],
      },
      actual: {
        ...format,
        duration: 4,
        captionSampleTimes: [0.5],
        observedCaptions: [{ start: 0.5, end: 0.54, text: "hello" }],
      },
    });
    expect(result.issues.filter((i) => i.code === "caption-presence")).toEqual([]);
    expect(result.checks.find((c) => c.id === "caption-presence")?.basis).toContain("1 of 2");
  });
});
