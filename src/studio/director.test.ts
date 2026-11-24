import { describe, expect, it } from "vitest";
import { validateEdl } from "../edl/validate";
import { measureText } from "../edl/measure";
import { DEFAULT_ANALYZE } from "../pipeline/analyze";
import type { Analysis, Probe, TimedWord } from "../pipeline/schemas";
import { buildEdit, findBeats, localSelection, SettingsSchema } from "./director";
import { presets } from "./formats";
import { importSrt } from "./subtitles";

const probe: Probe = {
  version: 1,
  clips: [
    {
      id: "c1",
      file: "source.mp4",
      sha256: "test",
      raw: {
        codec: "h264",
        width: 720,
        height: 1280,
        rotation: 0,
        fps: 30,
        nominalFps: 30,
        variableFrameRate: false,
        frameInterval: { min: 0.033, max: 0.034 },
        duration: 35,
        audio: null,
      },
      normalized: {
        video: "c1/source.mp4",
        audio: "c1/audio.wav",
        width: 720,
        height: 1280,
        fps: 30,
        frames: 1050,
        duration: 35,
        audioSampleRate: 48000,
      },
    },
  ],
};
const word = (n: number, text: string, start: number, end: number): TimedWord => ({
  id: `c1-w${n}`,
  clip: "c1",
  text,
  start,
  end,
});
const facts: Analysis = {
  version: 1,
  params: { ...DEFAULT_ANALYZE, retakeWindow: 20 },
  words: [
    word(1, "First", 0.22, 1.8),
    word(2, "take.", 1.8, 3.1),
    word(3, "First", 4, 5.223),
    word(4, "take.", 5.223, 6.4),
    word(5, "Keep", 9, 10),
    word(6, "30%", 10, 12),
    word(7, "more.", 12, 13),
    word(8, "Why?", 27, 29),
  ],
  silences: [{ id: "gap", clip: "c1", start: 13, end: 26.9, duration: 13.9, after: "c1-w7", before: "c1-w8" }],
  retakes: [
    {
      id: "r1",
      clip: "c1",
      attempt: { from: "c1-w1", to: "c1-w2", start: 0.22, end: 3.1, text: "First take." },
      restart: { from: "c1-w3", start: 4 },
      matchedWords: 2,
    },
  ],
  shots: [
    { id: "sh1", clip: "c1", start: 0, end: 9, cutScore: null },
    { id: "sh2", clip: "c1", start: 9, end: 35, cutScore: 34 },
  ],
  sounds: [],
  frames: [],
  fillers: [],
  loudness: [],
  sentences: [],
  transients: [],
};
const format = presets[0]!;
const defaults = SettingsSchema.parse({});

describe("automatic direction", () => {
  it("removes a retake and a long pause, anchors numbers and passes the renderer’s word boundary checks", () => {
    const beats = findBeats(probe, facts, format, defaults);
    const { edl } = buildEdit("A better take", "en", facts, beats, localSelection(beats, defaults), format, defaults);
    const result = validateEdl(edl, { probe, analysis: facts }, { measure: measureText });
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.kept.has("c1-w1")).toBe(false);
    expect(result.kept.has("c1-w7")).toBe(true);
    expect(edl.overlays.some((o) => o.component === "BigNumber" && "word" in o.at && o.at.word === "c1-w6")).toBe(true);
    expect(edl.audio.music?.duck).toBe(true);
    expect(result.resolved!.durationInFrames).toBeLessThan(22 * 30);
  });
  it("respects disabled tools and keeps the source order up to the duration cap", () => {
    const settings = SettingsSchema.parse({ cuts: false, motion: false, captions: false, sound: false, target: 15 });
    const beats = findBeats(probe, facts, format, settings);
    const { edl } = buildEdit("Test", "en", facts, beats, localSelection(beats, settings), format, settings);
    const rendered = validateEdl(edl, { probe, analysis: facts }, { measure: measureText });
    expect(rendered.ok).toBe(true);
    expect(rendered.resolved!.durationInFrames).toBe(450);
    expect(edl.segments[0]).toMatchObject({ in: 0, out: 15, framing: { scale: 1 } });
    expect([edl.overlays, edl.transitions, edl.audio.sfx]).toEqual([[], [], []]);
    expect(edl.captions.enabled).toBe(false);
    expect(edl.audio.music).toBeUndefined();
  });
  it("applies measured pace to different visual footage and keeps silent references quiet", () => {
    const visual = { ...facts, words: [], silences: [], retakes: [] };
    const learned = {
      ...format,
      shotSeconds: 1.8,
      musicDb: null,
      captionWords: 2,
      reference: { duration: 8, shots: 5, medianShot: 1.8, silentShare: null, lufs: null, motion: 4, flashes: 0 },
    };
    const beats = findBeats(probe, visual, learned, defaults);
    expect(beats.length).toBeGreaterThan(findBeats(probe, visual, format, defaults).length);
    const { edl } = buildEdit("Visual", "und", visual, beats, localSelection(beats, defaults), learned, defaults);
    expect(edl.captions.maxWordsPerPage).toBe(2);
    expect(edl.audio.sfx).toHaveLength(0);
    expect(validateEdl(edl, { probe, analysis: visual }, { measure: measureText }).ok).toBe(true);
  });
  it("rejects a Claude selection referring to another project", () => {
    const beats = findBeats(probe, facts, format, defaults);
    expect(() => buildEdit("Test", "en", facts, beats, { ids: ["unknown"] }, format, defaults)).toThrow(
      /outside this footage/,
    );
  });
});

describe("imported subtitles", () => {
  it("reads multiline CRLF cues and assigns stable word IDs on the source clock", () => {
    const result = importSrt("\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nOne\r\n<i>two.</i>\r\n", 5);
    expect(result.words.map((w) => [w.id, w.text, w.start, w.end])).toEqual([
      ["c1-w1", "One", 1, 1.75],
      ["c1-w2", "two.", 1.75, 2.5],
    ]);
  });
  it("rejects cues beyond the video and malformed input", () => {
    expect(() => importSrt("1\n00:00:03,000 --> 00:00:07,000\nHello", 5)).toThrow(/within/);
    expect(() => importSrt("Hello", 5)).toThrow(/SRT/);
  });
});
