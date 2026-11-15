import { describe, expect, it } from "vitest";
import { defaultBrand } from "../brand";
import type { ResolvedEdl } from "../edl/resolved";
import { boldStyle } from "../remotion/captions/styles";
import { previewFrames } from "./keyframes";

const tok = (word: string, fromFrame: number, toFrame: number, emphasis?: "color") => ({ word, text: word, fromFrame, toFrame, width: 100, ...(emphasis ? { emphasis } : {}) });

const edl: ResolvedEdl = {
  version: 1,
  title: "t",
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 90,
  brand: defaultBrand,
  captionStyle: boldStyle,
  segments: [
    { type: "clip", id: "a", clip: "c1", src: "media/c1/source.mp4", sourceWidth: 1080, sourceHeight: 1920, fromFrame: 0, durationInFrames: 40, trimBefore: 0, playbackRate: 1, framing: { scale: 1, origin: { x: 0.5, y: 0.5 }, move: { toScale: 1.1, ease: "easeInOut" } } },
    { type: "clip", id: "b", clip: "c1", src: "media/c1/source.mp4", sourceWidth: 1080, sourceHeight: 1920, fromFrame: 40, durationInFrames: 50, trimBefore: 60, playbackRate: 1, framing: { scale: 1.2, origin: { x: 0.5, y: 0.5 } } },
  ],
  transitions: [],
  overlays: [],
  captions: {
    enabled: true,
    pages: [
      { fromFrame: 3, durationInFrames: 30, position: "lower-third", fontSize: 72, lines: [[tok("c1-w1", 3, 12), tok("c1-w2", 12, 33, "color")]], box: { x: 300, y: 1250, width: 480, height: 105 } },
      { fromFrame: 45, durationInFrames: 40, position: "lower-third", fontSize: 72, lines: [[tok("c1-w3", 45, 60)], [tok("c1-w4", 60, 85)]], box: { x: 300, y: 1200, width: 480, height: 190 } },
    ],
  },
  audio: { voice: { targetLufs: -14, denoise: false }, sfx: [] },
};

describe("previewFrames", () => {
  it("takes segment starts, the end of a zoom, the first page, emphasis, overrides, the largest page and the last frame", () => {
    const frames = previewFrames(edl, new Set(["c1-w4"]));
    const at = (f: number) => frames.find((x) => x.frame === f)?.reasons ?? [];
    expect(at(2)).toEqual(["start of a"]);
    expect(at(39)).toEqual(["end of the zoom of a"]);
    expect(at(4)).toEqual(["first caption page"]);
    expect(at(13)).toEqual(['emphasis "c1-w2" (color)']);
    expect(at(42)).toEqual(["start of b"]);
    expect(at(61)).toEqual(['override "c1-w4"']);
    expect(at(65)).toEqual(["largest caption page"]);
    expect(at(89)).toEqual(["last frame"]);
    expect(frames.map((f) => f.frame)).toEqual([...frames.map((f) => f.frame)].sort((a, b) => a - b));
  });
});
