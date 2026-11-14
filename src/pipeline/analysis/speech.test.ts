import { describe, expect, it } from "vitest";
import { crossAudioWithWords, detectFillers, detectRetakes, findImmediateRepetitions, groupSentences, type SpeechWord } from "./speech";

/** Builds consecutive words: [text, start, end] triples. */
function words(spec: [string, number, number][], clip = "c1", firstId = 1): SpeechWord[] {
  return spec.map(([text, start, end], i) => ({ id: `w${firstId + i}`, clip, text, start, end }));
}

describe("groupSentences", () => {
  it("splits on terminal punctuation, including an ellipsis", () => {
    const w = words([
      ["Bonjour", 0, 0.4],
      ["à", 0.45, 0.5],
      ["tous.", 0.55, 0.9],
      ["Mettez-vous", 1.0, 1.3],
      ["face", 1.35, 1.6],
      ["à...", 1.65, 1.9],
      ["Voilà", 2.0, 2.3],
      ["!", 2.3, 2.3],
    ]);
    const s = groupSentences(w, 1.0);
    expect(s.map((x) => x.text)).toEqual(["Bonjour à tous.", "Mettez-vous face à...", "Voilà !"]);
    expect(s[0]).toMatchObject({ id: "s1", from: "w1", to: "w3", start: 0, end: 0.9, wordCount: 3 });
  });

  it("splits on a long pause when Whisper gives no punctuation", () => {
    const s = groupSentences(words([["un", 0, 0.2], ["deux", 0.3, 0.5], ["trois", 1.6, 1.8]]), 1.0);
    expect(s.map((x) => x.text)).toEqual(["un deux", "trois"]);
  });

  it("never crosses a clip boundary", () => {
    const w = [...words([["un", 0, 0.2]], "c1", 1), ...words([["deux", 0.1, 0.3]], "c2", 2)];
    expect(groupSentences(w, 1.0).map((x) => [x.clip, x.text])).toEqual([
      ["c1", "un"],
      ["c2", "deux"],
    ]);
  });
});

describe("findImmediateRepetitions", () => {
  const clips = (n: number): string[] => new Array<string>(n).fill("c1");

  it("finds single words and groups of up to three words", () => {
    expect(findImmediateRepetitions(["le", "le", "chat"], clips(3))).toEqual([{ index: 0, size: 1 }]);
    expect(findImmediateRepetitions(["ça", "change", "ça", "change", "tout"], clips(5))).toEqual([{ index: 0, size: 2 }]);
    expect(findImmediateRepetitions(["a", "b", "c", "a", "b", "c"], clips(6))).toEqual([{ index: 0, size: 3 }]);
  });

  it("ignores correct French pronoun doubles and repeats across clips", () => {
    expect(findImmediateRepetitions(["nous", "nous", "sommes"], clips(3))).toEqual([]);
    expect(findImmediateRepetitions(["vous", "vous", "levez"], clips(3))).toEqual([]);
    expect(findImmediateRepetitions(["oui", "oui"], ["c1", "c2"])).toEqual([]);
  });
});

describe("detectFillers", () => {
  it("reports hesitations, discourse markers and immediate repetitions with their word ids", () => {
    const w = words([
      ["Euh,", 0, 0.2],
      ["du", 0.3, 0.4],
      ["coup,", 0.4, 0.6],
      ["ça", 0.7, 0.8],
      ["change,", 0.8, 1.0],
      ["ça", 1.05, 1.15],
      ["change", 1.15, 1.35],
      ["tout.", 1.4, 1.6],
      ["Voilà.", 2.0, 2.4],
      ["E,", 2.5, 2.6],
    ]);
    const f = detectFillers(w);
    expect(f.map((x) => [x.kind, x.text, x.words])).toEqual([
      ["hesitation", "Euh,", ["w1"]],
      ["discourse", "du coup,", ["w2", "w3"]],
      ["repetition", "ça change,", ["w4", "w5"]],
      ["discourse", "Voilà.", ["w9"]],
      ["hesitation", "E,", ["w10"]],
    ]);
    expect(f.map((x) => x.id)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
    expect(f[1]).toMatchObject({ start: 0.3, end: 0.6 });
  });

  it("does not flag ordinary words that contain a filler", () => {
    const f = detectFillers(words([["coup", 0, 0.2], ["de", 0.3, 0.4], ["fait", 0.4, 0.6], ["euhphorie", 0.7, 0.9]]));
    expect(f).toEqual([]);
  });

  it("leaves out repetitions inside an excluded span (a retake)", () => {
    const w = words([["le", 0, 0.1], ["le", 0.2, 0.3]]);
    expect(detectFillers(w, new Set(["w1"]))).toEqual([]);
  });
});

describe("detectRetakes", () => {
  const take = words([
    ["la", 6.0, 6.1],
    ["lumière.", 6.1, 6.5],
    ["Mettez-vous", 7.0, 7.3],
    ["toujours", 7.35, 7.6],
    ["face", 7.65, 7.9],
    ["à...", 8.0, 8.1],
    ["Mettez-vous", 8.8, 9.1],
    ["toujours", 9.15, 9.4],
    ["face", 9.45, 9.6],
    ["à", 9.62, 9.66],
    ["une", 9.7, 9.8],
    ["fenêtre.", 9.85, 10.3],
  ]);

  it("finds a sentence restarted with the same words", () => {
    const r = detectRetakes(take, groupSentences(take, 1.0));
    expect(r).toEqual([
      {
        id: "r1",
        clip: "c1",
        attempt: { from: "w3", to: "w6", start: 7.0, end: 8.1, text: "Mettez-vous toujours face à..." },
        restart: { from: "w7", start: 8.8 },
        matchedWords: 4,
      },
    ]);
  });

  it("finds a restart after a pause even without punctuation", () => {
    const w = take.map((x) => ({ ...x, text: x.text.replace(/[.]+$/, "") }));
    const r = detectRetakes(w, groupSentences(w, 1.0));
    expect(r.map((x) => [x.attempt.from, x.attempt.to, x.restart.from])).toEqual([["w3", "w6", "w7"]]);
  });

  it("ignores sentences that only share their first word, or that are too far apart", () => {
    const w = words([
      ["La", 0, 0.2],
      ["première", 0.2, 0.6],
      ["astuce.", 0.6, 1.0],
      ["La", 1.5, 1.7],
      ["deuxième", 1.7, 2.1],
      ["astuce.", 2.1, 2.5],
      ["La", 20, 20.2],
      ["deuxième", 20.2, 20.6],
    ]);
    expect(detectRetakes(w, groupSentences(w, 1.0))).toEqual([]);
  });

  it("ignores a long complete sentence that happens to start like the next one", () => {
    const w = words([
      ["Je", 0, 0.1],
      ["vais", 0.1, 0.3],
      ["vous", 0.3, 0.4],
      ["montrer", 0.4, 0.7],
      ["trois", 0.7, 0.9],
      ["astuces", 0.9, 1.3],
      ["simples", 1.3, 1.6],
      ["aujourd'hui.", 1.6, 2.0],
      ["Je", 2.5, 2.6],
      ["vais", 2.6, 2.8],
      ["commencer.", 2.8, 3.2],
    ]);
    expect(detectRetakes(w, groupSentences(w, 1.0))).toEqual([]);
  });
});

describe("crossAudioWithWords", () => {
  const w = words([
    ["un", 0.5, 0.9],
    ["deux", 2.0, 2.4],
  ]);
  const levels = new Array<number>(300).fill(-70);
  for (let f = 120; f < 130; f++) levels[f] = -20; // a clap at 1.2-1.3 s

  it("keeps silent intervals free of words, and reports sound without words", () => {
    const silent = [
      { start: 0, end: 0.48 },
      { start: 0.92, end: 1.2 },
      { start: 1.3, end: 2.0 },
      { start: 2.4, end: 3.0 },
    ];
    const { silences, sounds } = crossAudioWithWords("c1", 3, silent, w, levels, 0.25, 0.08);
    expect(silences).toEqual([
      { clip: "c1", start: 0, end: 0.48, duration: 0.48, after: null, before: "w1" },
      { clip: "c1", start: 0.92, end: 1.2, duration: 0.28, after: "w1", before: "w2" },
      { clip: "c1", start: 1.3, end: 2.0, duration: 0.7, after: "w1", before: "w2" },
      { clip: "c1", start: 2.4, end: 3, duration: 0.6, after: "w2", before: null },
    ]);
    expect(sounds).toEqual([{ clip: "c1", start: 1.2, end: 1.3, duration: 0.1, peakDb: -20, isolated: true }]);
  });

  it("cuts the part of a silence that a word overlaps, and drops what becomes too short", () => {
    // Whisper (or a quiet word) puts a word inside what the audio calls silence.
    const { silences } = crossAudioWithWords("c1", 3, [{ start: 0.3, end: 1.0 }], w, levels, 0.25, 0.08);
    expect(silences).toEqual([]);
    const long = crossAudioWithWords("c1", 3, [{ start: 0.1, end: 1.5 }], w, levels, 0.25, 0.08);
    expect(long.silences.map((s) => [s.start, s.end])).toEqual([
      [0.1, 0.5],
      [0.9, 1.5],
    ]);
  });

  it("marks a sound that touches a word as not isolated", () => {
    const { sounds } = crossAudioWithWords("c1", 3, [{ start: 0, end: 0.5 }, { start: 1.1, end: 3 }], w, levels, 0.25, 0.08);
    expect(sounds.map((s) => [s.start, s.end, s.isolated])).toEqual([[0.9, 1.1, false]]);
  });
});
