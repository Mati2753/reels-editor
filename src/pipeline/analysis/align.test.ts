import { describe, expect, it } from "vitest";
import { refineWordBounds, soundRegions, type EnergyTrack } from "./align";

/** 10 ms frames, -70 dB everywhere except the given [start, end) second ranges at -20 dB. */
function track(loud: [number, number][], seconds = 5): EnergyTrack {
  const levels = new Array<number>(Math.round(seconds * 100)).fill(-70);
  for (const [a, b] of loud) for (let f = Math.round(a * 100); f < Math.round(b * 100); f++) levels[f] = -20;
  return { levels, step: 0.01, thresholdDb: -45 };
}

describe("soundRegions", () => {
  it("drops clicks and bridges short dips", () => {
    const t = track([
      [0.5, 0.51], // 10 ms click: dropped
      [1.0, 1.2],
      [1.25, 1.4], // 50 ms dip (stop consonant): bridged
      [2.0, 2.3],
    ]);
    expect(soundRegions(t, { minSound: 0.02, bridge: 0.1 })).toEqual([
      { start: 1.0, end: 1.4 },
      { start: 2.0, end: 2.3 },
    ]);
  });
});

describe("refineWordBounds", () => {
  it("moves a start that Whisper put inside a long silence onto the onset", () => {
    const t = track([[1.0, 1.4]]);
    expect(refineWordBounds([{ start: 0.7, end: 1.4 }], t)).toEqual([{ start: 1.0, end: 1.4 }]);
  });

  it("skips a clap that lies between Whisper's start and the word", () => {
    const t = track([
      [0.3, 0.4],
      [0.9, 1.0],
    ]);
    expect(refineWordBounds([{ start: 0, end: 0.98 }], t)).toEqual([{ start: 0.9, end: 1.0 }]);
  });

  it("extends an end cut short before a pause, and trims an end that runs into silence", () => {
    const t = track([
      [1.0, 2.0],
      [3.0, 3.5],
    ]);
    const out = refineWordBounds(
      [
        { start: 1.0, end: 1.7 },
        { start: 3.0, end: 3.9 },
      ],
      t,
    );
    expect(out).toEqual([
      { start: 1.0, end: 2.0 },
      { start: 3.0, end: 3.5 },
    ]);
  });

  it("leaves bounds between words of continuous speech alone", () => {
    const t = track([[1.0, 2.0]]);
    const words = [
      { start: 1.0, end: 1.3 },
      { start: 1.3, end: 1.6 },
      { start: 1.6, end: 2.0 },
    ];
    expect(refineWordBounds(words, t)).toEqual(words);
  });

  it("does not pull a start back over the previous word, nor push an end past the next one", () => {
    const t = track([[1.0, 2.0]]);
    const words = [
      { start: 1.0, end: 1.2 },
      { start: 1.35, end: 1.5 }, // whisper gap inside continuous sound
      { start: 1.6, end: 1.8 },
    ];
    // Only the last word, followed by silence, reaches the end of the sound.
    expect(refineWordBounds(words, t)).toEqual([words[0], words[1], { start: 1.6, end: 2.0 }]);
  });

  it("does not move a bound further than maxShift", () => {
    const t = track([[1.0, 3.0]]);
    expect(refineWordBounds([{ start: 2.0, end: 2.2 }], t)).toEqual([{ start: 2.0, end: 2.2 }]);
  });

  it("keeps Whisper's bounds when the audio shows no sound inside the word", () => {
    const t = track([]);
    expect(refineWordBounds([{ start: 1.0, end: 1.3 }], t)).toEqual([{ start: 1.0, end: 1.3 }]);
  });
});
