import { describe, expect, it } from "vitest";
import { makeStyle, matchGrade, outputSize, reviseStyle } from "./styles";
import type { StyleSource } from "./style-model";
const ref: StyleSource = {
  id: "a",
  name: "A",
  seconds: 12,
  frames: 360,
  fps: 30,
  width: 720,
  height: 1280,
  shots: 3,
  cadence: 4,
  pauseShare: 0.25,
  motion: 3,
  flashes: 0,
  fades: 0,
  lufs: -18,
  cueWords: 3,
  tempo: null,
  luma: 110,
  medianLuma: 112,
  contrast: 120,
  saturation: 18,
  confidence: 0.82,
  hasAudio: true,
};
describe("saved styles", () => {
  it("combines different measured references and gives repeated references one vote", () => {
    const f = makeStyle([ref, ref, { ...ref, id: "b", cadence: 2 }], "learned", "Blend", "preview");
    expect(f.profile?.references).toHaveLength(2);
    expect(f.shotSeconds).toEqual(3);
    expect(f.transition).toBe("cut");
  });
  it("keeps previous settings when recording a correction and supports an explicit silent mix", () => {
    const f = makeStyle([ref], "learned", "Style", "preview");
    const revised = reviseStyle(f, { musicDb: null, cadence: 2 }, "new", "Quicker, without music");
    expect(revised.profile?.revision).toBe(2);
    expect(revised.profile?.parent).toBe(f.id);
    expect(revised.musicDb).toBeNull();
    expect(f.shotSeconds).toBe(4);
    expect(() => reviseStyle(f, { zoom: 5 }, "bad", "invalid")).toThrow();
  });
  it("constrains the applied grade and distinguishes empty evidence", () => {
    const f = makeStyle([ref], "learned", "Style", "preview");
    expect(matchGrade(f, { luma: 0, contrast: 0, saturation: 0 }).brightness).toBe(0.08);
    expect(matchGrade(f, { luma: null, contrast: null, saturation: null }).brightness).toBe(0);
    expect(() => makeStyle([], "empty", "no", "")).toThrow();
  });
  it("produces even pixels for all three frame shapes", () => {
    expect(outputSize("square", "draft")).toEqual({ width: 360, height: 360 });
    expect(outputSize("horizontal", "high")).toEqual({ width: 1920, height: 1080 });
    expect(outputSize()).toEqual({ width: 720, height: 1280 });
  });
});
