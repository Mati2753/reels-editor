import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AudioEvidenceSchema,
  FrameEvidenceSchema,
  ReferenceEvidenceSchema,
  REFERENCE_FRAME_FILTER,
  audioEvidence,
  frameEvidence,
  makeReferenceEvidence,
} from "./evidence";

function fixture(rows: Array<{ t: number; y: number; score?: number; delta?: number }>, origin = 0) {
  return rows
    .map(({ t, y, score = 0, delta = 0 }, index) =>
      [
        `frame:${index} pts:${Math.round((origin + t) * 24000)} pts_time:${(t + origin).toFixed(7)}`,
        `lavfi.scd.score=${score}`,
        `lavfi.signalstats.YAVG=${y}`,
        `lavfi.signalstats.YLOW=${Math.max(0, y - 8)}`,
        `lavfi.signalstats.YHIGH=${Math.min(255, y + 8)}`,
        "lavfi.signalstats.UAVG=128",
        "lavfi.signalstats.VAVG=130",
        "lavfi.signalstats.SATAVG=7",
        `lavfi.signalstats.YDIF=${delta}`,
      ].join("\n"),
    )
    .join("\n");
}
function ffmpeg(args: string[], filter = REFERENCE_FRAME_FILTER) {
  return execFileSync(
    "ffmpeg",
    [
      "-nostdin",
      "-loglevel",
      "error",
      "-filter_threads",
      "1",
      ...args,
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      filter + ",metadata=mode=print:file=-",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 8_000_000 },
  );
}
const source = { width: 512, height: 288, duration: 1, fps: 24, frameRate: "24/1", timeBase: "1/24000" };

describe("reference evidence", () => {
  it("decodes the bundled footage at native rate, reports scored cut candidates and preserves exact frame ticks", () => {
    const path = fileURLToPath(new URL("../../assets/studio/alpine-field-notes.mp4", import.meta.url));
    const output = frameEvidence(ffmpeg(["-i", path]), 12, { keepFrames: true });
    expect(output.frameCount).toBe(360);
    expect(output.missingFrameNumbers).toBe(0);
    expect(output.cuts.map((e) => e.at)).toEqual([4, 8]);
    expect(output.cuts.every((e) => e.status === "inferred" && e.score !== null && e.score > 12)).toBe(true);
    expect(output.cuts[0]!.confidence).not.toBe(output.cuts[1]!.confidence);
    expect(output.frames![1]!.ptsTicks).toBe("512");
    expect(output.frames![1]!.sourcePts).toBeCloseTo(1 / 30, 5);
    expect(output.color.contrast).toBeGreaterThan(20);
    expect(output.motion.median).toBeGreaterThanOrEqual(0);
    expect(FrameEvidenceSchema.safeParse(output).success).toBe(true);
  });
  it("preserves irregular presentation spacing, fractional first PTS and a 64-bit tick string", () => {
    const data = ffmpeg(
      ["-f", "lavfi", "-i", "testsrc2=size=128x80:rate=10:duration=1"],
      "select='not(between(n,3,4))',setpts=PTS+13," + REFERENCE_FRAME_FILTER,
    );
    const result = frameEvidence(data, 1, { keepFrames: true });
    expect(result.firstPts).toBeCloseTo(1.3, 5);
    expect(result.frameCount).toBe(8);
    expect(result.frames!.map((r) => r.at)).toEqual([0, 0.1, 0.2, 0.5, 0.6, 0.7, 0.8, 0.9]);
    const huge = "9223372036854775001";
    const one = frameEvidence("frame:0 pts:" + huge + " pts_time:-2.5\nlavfi.signalstats.YAVG=12", 1, {
      keepFrames: true,
    });
    expect(one.frames![0]!.ptsTicks).toBe(huge);
    expect(one.frames![0]!.at).toBe(0);
    expect(one.color.chromaU).toBeNull();
    expect(one.motion.median).toBeNull();
  });
  it("weights picture levels by presentation duration, preserving timecode separately", () => {
    const text = fixture(
      [
        { t: 0, y: 20 },
        { t: 0.1, y: 120 },
        { t: 0.4, y: 120 },
      ],
      7.5,
    );
    const r = frameEvidence(text, 0.6, { keepFrames: true });
    expect(r.frames!.map((f) => f.at)).toEqual([0, 0.1, 0.4]);
    expect(r.firstPts).toBe(7.5);
    expect(r.color.luma).toBeCloseTo((20 * 0.1 + 120 * 0.5) / 0.6, 3);
    expect(r.color.chromaU).toBe(128);
    expect(r.color.contrast).toBe(16);
    expect(r.frames![1]!.sourcePts).toBe(7.6);
  });
  it("labels brief recoverable brightness flashes and dark-ended ramps as inferences", () => {
    const f = frameEvidence(
      fixture([
        { t: 0, y: 70 },
        { t: 0.04, y: 235, score: 50, delta: 165 },
        { t: 0.08, y: 235 },
        { t: 0.12, y: 72, score: 42, delta: 163 },
        { t: 0.16, y: 70 },
      ]),
      0.2,
    );
    expect(f.transitions).toContainEqual(
      expect.objectContaining({ kind: "flash", start: 0.04, end: 0.12, status: "inferred" }),
    );
    expect(f.cuts).toHaveLength(0);
    const a = frameEvidence(fixture([16, 27, 40, 55, 70, 88, 90, 90, 90].map((y, i) => ({ t: i * 0.04, y }))), 0.36);
    expect(a.transitions.map((s) => s.kind)).toEqual(["fade-in"]);
    const b = frameEvidence(fixture([87, 78, 65, 50, 39, 25, 16].map((y, i) => ({ t: i * 0.04, y }))), 0.28);
    expect(b.transitions.map((s) => s.kind)).toEqual(["fade-out"]);
  });
  it("rejects empty or nonmonotonic records and retains unknown fields as null", () => {
    expect(() => frameEvidence("", 1)).toThrow(/measurements/);
    expect(() =>
      frameEvidence(
        fixture([
          { t: 0.2, y: 30 },
          { t: 0.1, y: 40 },
        ]),
        1,
      ),
    ).toThrow(/order/);
    expect(() => frameEvidence(fixture([{ t: 0, y: 30 }]), 0)).toThrow(/duration/);
    const r = frameEvidence(
      "frame:1 pts:7 pts_time:0\nlavfi.signalstats.YAVG=68\nframe:4 pts:11 pts_time:0.2\nlavfi.signalstats.YAVG=70",
      1,
    );
    expect(r.missingFrameNumbers).toBe(2);
    expect(r.color.saturation).toBeNull();
  });
  it("keeps unmeasured LUFS absent, omits bulky traces and discloses incomplete coverage", () => {
    const visual = frameEvidence(
      fixture([
        { t: 0, y: 16 },
        { t: 0.04, y: 30 },
        { t: 0.08, y: 42 },
      ]),
      0.12,
      { keepFrames: true },
    );
    const r = makeReferenceEvidence({ source, visual, audio: null });
    expect(r.integratedLufs).toBeNull();
    expect(r.unknowns.join(" ")).toContain("only the reported portion");
    expect("frames" in r.visual).toBe(false);
    expect(r.provenance.loudness).toBeNull();
    expect(ReferenceEvidenceSchema.safeParse({ ...r, source: { ...source, width: 0 } }).success).toBe(false);
    expect(ReferenceEvidenceSchema.safeParse({ ...r, integratedLufs: NaN }).success).toBe(false);
    expect(makeReferenceEvidence({ source, visual, audio: null, integratedLufs: -17.8 }).integratedLufs).toBe(-17.8);
  });
});

function clicks(times: number[], duration: number, sr = 16000) {
  const pcm = new Float32Array(Math.round(sr * duration));
  for (const at of times) {
    const from = Math.round(at * sr);
    for (let i = 0; i < Math.round(sr * 0.05) && from + i < pcm.length; i++)
      pcm[from + i] = 0.8 * Math.exp(-i / (sr * 0.008)) * Math.cos((2 * Math.PI * 120 * i) / sr);
  }
  return pcm;
}
describe("mono audio evidence", () => {
  it("measures full-scale sample count, peak and RMS in dBFS independently of loudness", () => {
    const r = audioEvidence(Float32Array.from([1, -1, 0.5, -0.5, 0, 0, 0, 0]), 8000);
    expect(r.clippedSamples).toBe(2);
    expect(r.clippedShare).toBe(0.25);
    expect(r.samplePeakDbfs).toBe(0);
    expect(r.rmsDbfs).toBeCloseTo(10 * Math.log10(2.5 / 8), 2);
    expect(AudioEvidenceSchema.safeParse(r).success).toBe(true);
  });
  it("recovers the pulse of a known click track and timestamps independent amplitude onsets", () => {
    const targets = Array.from({ length: 16 }, (_, i) => 0.25 + 0.5 * i);
    const r = audioEvidence(clicks(targets, 8.5), 16000);
    expect(r.tempo?.bpm).toBeCloseTo(120, 0);
    expect(r.tempo!.confidence).toBeGreaterThan(0.62);
    expect(r.onsets.length).toBe(targets.length);
    for (const [i, t] of targets.entries()) expect(Math.abs(r.onsets[i]!.at - t)).toBeLessThan(0.03);
    expect(r.tempo?.status).toBe("inferred");
  });
  it("abstains on silence, steady tone and a sparse irregular series, and rejects invalid PCM", () => {
    const r = audioEvidence(new Float32Array(16000), 16000);
    expect(r.samplePeakDbfs).toBeNull();
    expect(r.rmsDbfs).toBeNull();
    expect(r.envelope.every((n) => n === null)).toBe(true);
    expect(r.tempo).toBeNull();
    expect(
      audioEvidence(
        Float32Array.from({ length: 48000 }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 200 * i) / 16000)),
        16000,
      ).tempo,
    ).toBeNull();
    expect(audioEvidence(clicks([0.3, 1.14, 2.8, 4.31], 5), 16000).tempo).toBeNull();
    expect(() => audioEvidence(Float32Array.of(NaN), 16000)).toThrow(/non-finite/);
    expect(() => audioEvidence(new Float32Array(0), 0)).toThrow(/sample rate/);
  });
});
