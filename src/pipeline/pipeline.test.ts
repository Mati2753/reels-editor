import { describe, expect, it } from "vitest";
import { frameLevels, parseWavMono16, silenceThreshold } from "./analysis/audio";
import { gapsBetween, parseSilencedetect, subtract } from "./analysis/intervals";
import { cutsToShots, parseEbur128, parseScdet } from "./analysis/media";
import { assignClipIds } from "./ingest";
import { buildPrompt } from "./transcribe";
import { fingerprint, stableStringify } from "./util/state";
import { clipWords, mergeEngineWords, normalizeWord } from "./words";
import { WordSchema } from "./schemas";

describe("mergeEngineWords", () => {
  it("glues French elisions and hyphenated pronouns that Whisper splits", () => {
    const merged = mergeEngineWords([
      { text: " aujourd", start: 2.0, end: 2.3, probability: 0.9 },
      { text: "'hui,", start: 2.3, end: 2.5, probability: 0.8 },
      { text: " Mettez", start: 3.0, end: 3.2, probability: 0.95 },
      { text: "-vous", start: 3.2, end: 3.4, probability: 0.99 },
      { text: " à", start: 3.5, end: 3.6, probability: 1 },
      { text: "...", start: 3.6, end: 3.6, probability: 0.5 },
    ]);
    expect(merged).toEqual([
      { text: "aujourd'hui,", start: 2.0, end: 2.5, confidence: 0.8 },
      { text: "Mettez-vous", start: 3.0, end: 3.4, confidence: 0.95 },
      { text: "à...", start: 3.5, end: 3.6, confidence: 1 },
    ]);
  });

  it("drops empty words and leading punctuation", () => {
    expect(mergeEngineWords([{ text: " ,", start: 0, end: 0.1, probability: 1 }, { text: " ", start: 0, end: 0, probability: 1 }])).toEqual([]);
  });
});

describe("clipWords", () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.2, confidence: 1 });

  it("numbers words per clip, prefixed by the clip id", () => {
    const c1 = clipWords("c1", [w("Bonjour", 0), w("à", 0.3)]);
    const c2 = clipWords("c2", [w("Et", 0)]);
    expect([...c1, ...c2].map((x) => x.id)).toEqual(["c1-w1", "c1-w2", "c2-w1"]);
    for (const x of [...c1, ...c2]) expect(WordSchema.safeParse(x).success).toBe(true);
  });

  it("keeps the ids of a clip when another clip is re-transcribed with more words", () => {
    const before = [...clipWords("c1", [w("un", 0)]), ...clipWords("c2", [w("deux", 0), w("trois", 1)])];
    const after = [...clipWords("c1", [w("un", 0), w("euh", 0.4), w("bis", 0.8)]), ...clipWords("c2", [w("deux", 0), w("trois", 1)])];
    expect(after.filter((x) => x.clip === "c2").map((x) => x.id)).toEqual(before.filter((x) => x.clip === "c2").map((x) => x.id));
  });

  it("rejects the old cross-clip ids", () => {
    expect(WordSchema.safeParse({ id: "w3", clip: "c1", text: "x", start: 0, end: 1, confidence: 1 }).success).toBe(false);
  });
});

describe("normalizeWord", () => {
  it("lowercases, strips surrounding punctuation and unifies apostrophes", () => {
    expect(normalizeWord("Euh,")).toBe("euh");
    expect(normalizeWord("«C’est»")).toBe("c'est");
    expect(normalizeWord("à...")).toBe("à");
    expect(normalizeWord("...")).toBe("");
  });
});

describe("assignClipIds", () => {
  it("numbers new files in name order and keeps known ids", () => {
    const first = assignClipIds(["a.mp4", "b.mov"], [], 1);
    expect([...first.ids]).toEqual([
      ["a.mp4", "c1"],
      ["b.mov", "c2"],
    ]);
    const second = assignClipIds(["0-intro.mp4", "a.mp4", "b.mov"], [{ file: "a.mp4", id: "c1" }, { file: "b.mov", id: "c2" }], first.nextNumber);
    expect(second.ids.get("0-intro.mp4")).toBe("c3");
    expect(second.ids.get("a.mp4")).toBe("c1");
  });

  it("never reuses the id of a removed file", () => {
    const r = assignClipIds(["new.mp4"], [], 3);
    expect(r.ids.get("new.mp4")).toBe("c3");
    expect(r.nextNumber).toBe(4);
  });
});

describe("intervals", () => {
  it("parses silencedetect, closing a silence still open at the end", () => {
    const log = [
      "[silencedetect @ 0x1] silence_start: 0",
      "[silencedetect @ 0x1] silence_end: 0.3 | silence_duration: 0.3",
      "[silencedetect @ 0x1] silence_start: 5.58488",
    ].join("\n");
    expect(parseSilencedetect(log, 6)).toEqual([
      { start: 0, end: 0.3 },
      { start: 5.58488, end: 6 },
    ]);
  });

  it("subtracts intervals", () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 5, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(gapsBetween([{ start: 1, end: 2 }], 3)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
  });
});

describe("audio levels", () => {
  function wav(samples: number[], rate = 16000): Buffer {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => data.writeInt16LE(Math.round(s * 32767), i * 2));
    const head = Buffer.alloc(44);
    head.write("RIFF", 0, "ascii");
    head.writeUInt32LE(36 + data.length, 4);
    head.write("WAVEfmt ", 8, "ascii");
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(1, 22);
    head.writeUInt32LE(rate, 24);
    head.writeUInt32LE(rate * 2, 28);
    head.writeUInt16LE(2, 32);
    head.writeUInt16LE(16, 34);
    head.write("data", 36, "ascii");
    head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
  }

  it("reads a mono 16-bit wav and measures RMS per frame", () => {
    const tone = Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 16000));
    const { samples, sampleRate } = parseWavMono16(wav([...new Array<number>(1600).fill(0), ...tone]));
    expect(sampleRate).toBe(16000);
    const levels = frameLevels(samples, sampleRate, 0.1);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toBe(-90);
    expect(levels[1]).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
  });

  it("puts the silence threshold 15 dB over the noise floor, within [-60, -35]", () => {
    expect(silenceThreshold([...new Array<number>(50).fill(-62), ...new Array<number>(50).fill(-20)])).toBe(-47);
    expect(silenceThreshold(new Array<number>(100).fill(-20))).toBe(-35);
    expect(silenceThreshold(new Array<number>(100).fill(-90))).toBe(-60);
  });
});

describe("ffmpeg output parsers", () => {
  it("parses scdet metadata", () => {
    const text = ["frame:2    pts:228864  pts_time:14.9", "lavfi.scd.mafd=11.658", "lavfi.scd.score=11.70", "lavfi.scd.time=14.9"].join("\n");
    expect(parseScdet(text)).toEqual([{ time: 14.9, score: 11.7 }]);
  });

  it("parses the ebur128 summary", () => {
    const log = "t: 1 M: -20 S: -21 I: -19.0 LUFS\n  Summary:\n\n  Integrated loudness:\n    I:         -20.8 LUFS\n  Loudness range:\n    LRA:         2.9 LU\n  True peak:\n    Peak:       -5.9 dBFS";
    expect(parseEbur128(log)).toEqual({ integratedLufs: -20.8, loudnessRange: 2.9, truePeakDb: -5.9 });
    expect(parseEbur128("Summary:\n I:  -inf LUFS")).toEqual({ integratedLufs: null, loudnessRange: null, truePeakDb: null });
  });
});

describe("cutsToShots", () => {
  it("turns cuts into shots and folds a flash (picture comes back) into a transient", async () => {
    const same = async (): Promise<number> => 1;
    const { shots, transients } = await cutsToShots(
      "v.mp4",
      23.2,
      [
        { time: 0.3, score: 66.9 },
        { time: 0.433, score: 67 },
        { time: 14.9, score: 11.7 },
      ],
      0.5,
      12,
      same,
    );
    expect(transients).toEqual([{ start: 0.3, end: 0.433 }]);
    expect(shots).toEqual([
      { start: 0, end: 14.9, cutScore: null },
      { start: 14.9, end: 23.2, cutScore: 11.7 },
    ]);
  });

  it("keeps two quick cuts when the picture does not come back", async () => {
    const different = async (): Promise<number> => 80;
    const { shots, transients } = await cutsToShots("v.mp4", 3, [{ time: 1, score: 50 }, { time: 1.3, score: 50 }], 0.5, 12, different);
    expect(transients).toEqual([]);
    expect(shots.map((s) => s.start)).toEqual([0, 1, 1.3]);
  });
});

describe("transcription settings", () => {
  it("builds the prompt from the language's style hint and the project glossary", () => {
    expect(buildPrompt("fr", [])).toContain("euh");
    expect(buildPrompt("fr", ["Remotion", "Higgsfield"])).toMatch(/Remotion, Higgsfield\.$/);
    expect(buildPrompt("de", [])).toBe("");
  });
});

describe("fingerprint", () => {
  it("does not depend on key order and changes with any value", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});
