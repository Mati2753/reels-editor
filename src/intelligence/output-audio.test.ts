import { expect, it } from "vitest";
import { scanDeliverySamples } from "./output-audio";

it("counts both channels even when opposing peaks cancel in a mono listening track", () => {
  const stereo = new Float32Array(48000 * 2);
  stereo.set([1.1, -1.1], 48000);
  const result = scanDeliverySamples(stereo, 2, 48000);
  expect(result.clipping).toEqual([{ start: 0.5, end: 0.5 + 1 / 48000, samples: 2 }]);
  expect(result.samplePeakDbfs).toBeGreaterThan(0);
  expect(scanDeliverySamples(new Float32Array([0.9, 0.9]), 2, 44100).clipping).toEqual([]);
  expect(() => scanDeliverySamples(new Float32Array(3), 2, 44100)).toThrow();
  expect(() => scanDeliverySamples(new Float32Array([NaN]), 1, 16000)).toThrow();
});
