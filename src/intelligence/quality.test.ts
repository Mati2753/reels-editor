import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../cli/paths";
import { ffmpeg, ffprobeJson } from "../pipeline/util/exec";
import { measureLoudness } from "../pipeline/analysis/media";
import { assessRender, suggestRepair, type RenderQualityInput } from "./quality";

const frameSpec = { width: 720, height: 1280, fps: 30, frames: 300 };
const clean = {
  expected: { ...frameSpec, medianLuma: 0.48, medianShotSeconds: 2 },
  actual: {
    ...frameSpec,
    duration: 10,
    medianLuma: 0.49,
    cutTimes: [2, 4, 6, 8],
    truePeakDbtp: -2,
    samplePeakDbfs: -2.6,
    clipping: [],
  },
} satisfies RenderQualityInput;
const issues = (input: RenderQualityInput) => assessRender(input).issues.map((i) => i.code);
const present = { start: 1, end: 2, text: "First light", bounds: { x: 20, y: 100, width: 230, height: 50 } };

describe("post-render quality evidence", () => {
  it("keeps optional unmeasured checks distinct from passing delivery checks", () => {
    const r = assessRender(clean);
    expect(r.status).toBe("pass");
    expect(r.issues).toHaveLength(0);
    expect(r.metrics).toEqual({ lumaDelta: -0.01, medianShotSeconds: 2, peakExcessDb: 0, clippedSamples: 0 });
    expect(r.checks).toContainEqual(expect.objectContaining({ id: "caption-presence", status: "unmeasured" }));
  });
  it("requires observed frames and tells an unknown focus/grade, scan and sound apart from a successful one", () => {
    const r = assessRender({ expected: clean.expected, actual: { width: 720, height: 1280, fps: 30, duration: 10 } });
    expect(r.status).toBe("review");
    expect(r.issues).toHaveLength(0);
    for (const id of ["frame-count", "picture-level", "cut-cadence", "sample-clipping", "true-peak"]) {
      expect(r.checks.find((c) => c.id === id)?.status).toBe("unmeasured");
    }
    expect(suggestRepair(r)).toBeNull();
  });
  it("reports mismatched dimensions, frame rate, decoded count and duration independently", () => {
    const input = {
      ...clean,
      actual: { ...clean.actual, width: 1280, height: 720, frames: 299, fps: 30000 / 1001, duration: 10.12 },
    };
    const r = assessRender(input);
    expect(r.status).toBe("fail");
    expect(r.issues.map((i) => i.code)).toEqual(["frame-size", "frame-rate", "frame-count", "duration"]);
    expect(suggestRepair(r)).toBeNull();
    const duration = 300 / (30000 / 1001);
    expect(
      assessRender({
        expected: { ...frameSpec, fps: 30000 / 1001 },
        actual: { ...frameSpec, fps: 29.97, duration: duration + 0.025 },
      }).status,
    ).toBe("pass");
  });
  it("evaluates only observed interior cuts; a scan that found no cuts is different from an absent scan", () => {
    expect(
      assessRender({ ...clean, actual: { ...clean.actual, cutTimes: [8, 2, 6, 4, 2] } }).metrics.medianShotSeconds,
    ).toBe(2);
    expect(issues({ ...clean, actual: { ...clean.actual, cutTimes: [] } })).toContain("cut-cadence");
    const r = assessRender({ ...clean, expected: { ...clean.expected, medianShotSeconds: 9 } });
    expect(r.checks.find((c) => c.id === "cut-cadence")?.status).toBe("unmeasured");
    expect(issues({ ...clean, actual: { ...clean.actual, medianLuma: 0.58 } })).not.toContain("picture-level");
  });
  it("separates true-peak exceedances from full-scale samples and timestamps observed clipping intervals", () => {
    const input = {
      ...clean,
      actual: {
        ...clean.actual,
        truePeakDbtp: 0.8,
        clipping: [
          { start: 1.2, end: 1.25, samples: 8 },
          { start: 8, end: 8.01, samples: 3 },
        ],
      },
    };
    const r = assessRender(input);
    expect(r.metrics.peakExcessDb).toBe(1.8);
    expect(r.metrics.clippedSamples).toBe(11);
    const clips = r.issues.filter((i) => i.code === "sample-clipping");
    expect(clips.map((i) => [i.start, i.end])).toEqual([
      [1.2, 1.25],
      [8, 8.01],
    ]);
    expect(clips[0]?.basis).toContain("8 decoded audio samples");
    expect(r.issues.find((i) => i.code === "true-peak")?.severity).toBe("error");
    const sampleOnly = assessRender({
      ...clean,
      actual: { ...clean.actual, clipping: null, samplePeakDbfs: -0.1, truePeakDbtp: null },
    });
    expect(sampleOnly.metrics.peakExcessDb).toBeNull();
    expect(sampleOnly.checks.find((c) => c.id === "true-peak")?.status).toBe("unmeasured");
    expect(sampleOnly.checks.find((c) => c.id === "sample-clipping")?.status).toBe("pass");
    expect(
      issues({
        ...clean,
        expected: { ...clean.expected, peakCeilingDbtp: -2 },
        actual: { ...clean.actual, truePeakDbtp: -1.7 },
      }),
    ).toContain("true-peak");
  });
  it("treats authored layout, observed visibility and independent timing as separate evidence", () => {
    const input = { ...clean, expected: { ...clean.expected, captions: [present] } };
    const unknown = assessRender(input);
    expect(unknown.status).toBe("review");
    expect(unknown.checks.find((c) => c.id === "caption-layout")?.status).toBe("unmeasured");
    const missing = assessRender({ ...input, actual: { ...clean.actual, observedCaptions: [] } });
    expect(missing.issues.find((i) => i.code === "caption-presence")).toMatchObject({
      start: 1,
      end: 2,
      confidence: 0.65,
    });
    const observed = { ...present, text: "FIRST, light!", start: 1.3, end: 2.3, confidence: 0.9, contrastRatio: 4.6 };
    expect(assessRender({ ...input, actual: { ...clean.actual, observedCaptions: [observed] } }).status).toBe("pass");
    const drift = assessRender({
      ...input,
      actual: { ...clean.actual, observedCaptions: [{ ...observed, timingVerified: true }] },
    });
    expect(drift.issues.map((i) => i.code)).toEqual(["caption-timing"]);
    expect(
      issues({ ...input, actual: { ...clean.actual, observedCaptions: [{ ...present, text: "Closing sound" }] } }),
    ).toContain("caption-presence");
    expect(
      issues({ ...input, actual: { ...clean.actual, observedCaptions: [{ ...present, confidence: 0.1 }] } }),
    ).toContain("caption-presence");
  });
  it("finds invalid or overlapping authored windows and observed contrast or off-canvas text", () => {
    const input = {
      ...clean,
      expected: {
        ...clean.expected,
        captions: [
          { start: 1, end: 3 },
          { start: 2, end: 4 },
          { start: 9.5, end: 11 },
        ],
      },
      actual: {
        ...clean.actual,
        observedCaptions: [{ ...present, bounds: { x: 630, y: 300, width: 180, height: 80 }, contrastRatio: 2.4 }],
      },
    };
    const r = assessRender(input);
    expect(r.status).toBe("fail");
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: "caption-timing", start: 2, end: 3, severity: "warning" }),
    );
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: "caption-timing", start: 9.5, end: 10, severity: "error" }),
    );
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "caption-layout", start: 1, end: 2 }));
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "caption-contrast", start: 1, end: 2 }));
  });
  it("rejects contradictory measurement domains and malformed repair constraints", () => {
    for (const actual of [
      { ...clean.actual, cutTimes: [0, 5] },
      { ...clean.actual, cutTimes: [15] },
      { ...clean.actual, frames: 0 },
      { ...clean.actual, medianLuma: 1.2 },
      { ...clean.actual, clipping: [{ start: 5, end: 4, samples: 2 }] },
      { ...clean.actual, observedCaptions: [{ start: 2, end: 2, confidence: 1 }] },
      { ...clean.actual, truePeakDbtp: NaN },
    ]) {
      expect(() => assessRender({ ...clean, actual })).toThrow();
    }
    expect(() => suggestRepair(assessRender(clean), { gainDb: 2 })).toThrow();
    expect(() => suggestRepair(assessRender(clean), { iteration: -1 })).toThrow();
  });
  it("limits report length while retaining total counts and severity", () => {
    const count = 321;
    const clipping = Array.from({ length: count }, (_, i) => ({ start: i / 100, end: (i + 1) / 100, samples: 1 }));
    const r = assessRender({ ...clean, actual: { ...clean.actual, clipping } });
    expect(r.issues).toHaveLength(256);
    expect(r.omittedIssueCount).toBe(65);
    expect(r.metrics.clippedSamples).toBe(count);
    expect(r.status).toBe("fail");
  });
});

describe("bounded automatic repairs", () => {
  const damaged = () =>
    assessRender({
      ...clean,
      actual: {
        ...clean.actual,
        medianLuma: 0.15,
        truePeakDbtp: 3.5,
        clipping: [{ start: 2, end: 2.2, samples: 400 }],
      },
    });
  it("recommends cumulative, bounded values and declines additional adjustments at the limits", () => {
    const result = damaged();
    expect(suggestRepair(result)).toEqual({
      brightness: 0.04,
      gainDb: -3,
      issues: ["picture-level", "true-peak", "sample-clipping"],
    });
    expect(suggestRepair(result, { brightness: 0.07, gainDb: -5.5 })).toMatchObject({ brightness: 0.08, gainDb: -6 });
    expect(suggestRepair(result, { brightness: 0.08, gainDb: -6 })).toBeNull();
    expect(suggestRepair(assessRender({ ...clean, actual: { ...clean.actual, medianLuma: 0.85 } }))).toMatchObject({
      brightness: -0.04,
      gainDb: 0,
    });
  });
  it("respects configured iteration, absolute iteration, estimated cost and no-improvement stops", () => {
    const result = damaged();
    for (const options of [
      { maxIterations: 0 },
      { iteration: 1 },
      { iteration: 3, maxIterations: 64 },
      { budget: { spent: 0.2, next: 0.25, limit: 0.3 } },
      { previous: result.metrics },
    ]) {
      expect(suggestRepair(result, options)).toBeNull();
    }
    expect(
      suggestRepair(result, { iteration: 2, maxIterations: 3, budget: { spent: 0.1, next: 0.2, limit: 0.3 } }),
    ).not.toBeNull();
    const partlyBetter = assessRender({
      ...clean,
      actual: { ...clean.actual, medianLuma: 0.2, truePeakDbtp: 3.5, clipping: [{ start: 2, end: 2.2, samples: 400 }] },
    });
    expect(
      suggestRepair(partlyBetter, {
        iteration: 1,
        maxIterations: 3,
        brightness: 0.04,
        gainDb: -3,
        previous: result.metrics,
      }),
    ).toEqual({ brightness: 0.08, gainDb: -3, issues: ["picture-level"] });
  });
});

const sample = path.join(REPO_ROOT, "assets", "studio", "sample-cut.mp4");

async function luma(file: string) {
  const { stdout } = await ffmpeg([
    "-v",
    "error",
    "-threads",
    "1",
    "-i",
    file,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    "scale=96:-2:out_range=tv,format=yuv420p,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
    "-f",
    "null",
    "-",
  ]);
  const values = [...stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => (Number(m[1]) - 16) / 219).sort((a, b) => a - b);
  const m = Math.floor(values.length / 2);
  if (!values.length) throw Error("No frame luma was decoded.");
  return values.length % 2 ? values[m]! : (values[m]! + values[m - 1]!) / 2;
}

it("checks a bundled rendered movie through native probes and oversampled audio measurements", async () => {
  const data = (await ffprobeJson([
    "-count_frames",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate,nb_read_frames,duration",
    sample,
  ])) as {
    streams: { width: number; height: number; avg_frame_rate: string; nb_read_frames: string; duration: string }[];
  };
  const video = data.streams[0]!,
    [n, d] = video.avg_frame_rate.split("/").map(Number);
  const audio = await measureLoudness(sample);
  expect(audio.truePeakDb).not.toBeNull();
  const r = assessRender({
    expected: { width: 1080, height: 1920, fps: 30, frames: 257 },
    actual: {
      width: video.width,
      height: video.height,
      fps: n! / d!,
      frames: Number(video.nb_read_frames),
      duration: Number(video.duration),
      truePeakDbtp: audio.truePeakDb,
      medianLuma: await luma(sample),
    },
  });
  expect(r.status).toBe("pass");
  expect(r.checks.find((c) => c.id === "true-peak")?.status).toBe("pass");
  expect(r.checks.find((c) => c.id === "frame-count")?.basis).toContain("257");
}, 30000);

it("applies a bounded picture repair to an actual encoded crop of the demo and measures the decoded improvement", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-render-qa-"));
  try {
    const render = async (name: string, offset: number) => {
      const out = path.join(dir, name + ".mp4");
      await ffmpeg([
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        sample,
        "-t",
        "1",
        "-an",
        "-vf",
        "scale=144:256,eq=brightness=" + offset.toFixed(3),
        "-threads",
        "1",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        out,
      ]);
      return luma(out);
    };
    const desired = await render("target", 0);
    const dim = await render("dark", -0.21);
    const input = (medianLuma: number) => ({
      expected: { width: 144, height: 256, fps: 30, frames: 30, medianLuma: desired },
      actual: { width: 144, height: 256, fps: 30, frames: 30, duration: 1, medianLuma },
    });
    const first = assessRender(input(dim));
    const proposal = suggestRepair(first);
    expect(proposal?.issues).toContain("picture-level");
    const revised = assessRender(input(await render("revised", -0.21 + proposal!.brightness)));
    expect(Math.abs(revised.metrics.lumaDelta!)).toBeLessThan(Math.abs(first.metrics.lumaDelta!) - 0.015);
    expect(Math.abs(proposal!.brightness)).toBeLessThanOrEqual(0.04);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
