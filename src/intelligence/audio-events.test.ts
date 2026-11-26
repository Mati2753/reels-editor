import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recognizeSound } from "./native-sound";
import { preservedMusic, soundWindows, summarizeSound } from "./audio-events";
it("separates original speech and a music bed using a real packaged AudioSet graph", async () => {
  const samples = (file: string) => {
    const path = fileURLToPath(new URL("../../" + file, import.meta.url));
    const b = execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-i",
      path,
      "-t",
      "4",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "pipe:1",
    ]);
    return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  };
  const voice = await recognizeSound(samples("assets/studio/alpine-field-notes.mp4"));
  const music = await recognizeSound(samples("assets/music/drift.m4a"));
  expect(summarizeSound(voice)!.speechShare).toBeGreaterThan(0.5);
  expect(summarizeSound(music)!.musicShare).toBeGreaterThan(0.7);
  const seg = [{ clip: "a", in: 0, out: 3 }];
  expect(preservedMusic(seg, [{ clip: "a", events: music }])).toBe(true);
  expect(preservedMusic(seg, [{ clip: "a", events: voice }])).toBe(false);
  expect(preservedMusic(seg, [{ clip: "b", events: music }])).toBe(false);
}, 20000);
it("rejects invalid or nonfinite class scores", () => {
  const labels = Array.from({ length: 521 }, (_, i) => String(i));
  expect(() => soundWindows(new Float32Array(10), labels, 0, 20000)).toThrow();
  const values = new Float32Array(521);
  values[0] = NaN;
  expect(() => soundWindows(values, labels, 0, 16000)).toThrow();
});

import { compareSpeechMix } from "./audio-events";
it("flags sustained lost speech only when the encoded track gains music at the same source time", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    start: i * 0.48,
    end: i * 0.48 + 0.975,
    speech: 0.94,
    music: 0.01,
    silence: 0,
    labels: [],
  }));
  const segments = [{ clip: "c1", in: 0, out: 4.5 }],
    sources = [{ clip: "c1", events: rows }];
  const output = rows.map((w, i) => (i === 2 || i === 3 ? { ...w, speech: 0.12, music: 0.8 } : w));
  expect(compareSpeechMix(segments, sources, output).intervals[0]).toMatchObject({ start: 0.96, observations: 2 });
  expect(compareSpeechMix(segments, sources, rows).intervals).toEqual([]);
  expect(compareSpeechMix(segments, [{ clip: "other", events: rows }], output).checked).toBe(0);
});
