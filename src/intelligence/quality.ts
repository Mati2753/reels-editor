import { z } from "zod";

const positive = z.number().positive();
const positiveInteger = positive.int();
const unit = z.number().min(0).max(1);
const bounds = z.object({ x: z.number(), y: z.number(), width: positive, height: positive });
const cue = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string().max(8000).optional(),
  bounds: bounds.optional(),
});
const observation = cue.extend({
  timingVerified: z.boolean().optional(),
  confidence: unit.optional(),
  contrastRatio: z.number().min(1).max(21).optional(),
});
const clipped = z.object({ start: z.number().nonnegative(), end: positive, samples: positiveInteger });
const frameSpec = z.object({ width: positiveInteger, height: positiveInteger, fps: positive });

/** Times are seconds on the output video. Cut times exclude the clip's endpoints.
 * Median luma uses the same normalized [0,1] convention in both records.
 * A null/omitted measurement means unknown, while [] means the detector ran.
 * For clipping, count decoded samples at/above full scale (not samples near full scale).
 * Supply caption observations only when extracted from the rendered picture. Set timingVerified
 * only when both boundaries of a complete displayed cue were measured. A sampled OCR hit alone
 * establishes neither the full reading window nor voice-to-word synchronization. */
export const RenderQualityInputSchema = z
  .object({
    expected: frameSpec.extend({
      frames: positiveInteger,
      medianLuma: unit.nullish(),
      medianShotSeconds: positive.nullish(),
      peakCeilingDbtp: z.number().min(-12).max(0).default(-1),
      captions: z.array(cue).max(5000).nullish(),
    }),
    actual: frameSpec.extend({
      duration: positive,
      frames: positiveInteger.nullish(),
      medianLuma: unit.nullish(),
      cutTimes: z.array(z.number().nonnegative()).max(100_000).nullish(),
      truePeakDbtp: z.number().nullish(),
      samplePeakDbfs: z.number().nullish(),
      clipping: z.array(clipped).max(50_000).nullish(),
      observedCaptions: z.array(observation).max(5000).nullish(),
    }),
  })
  .superRefine(({ actual }, ctx) => {
    if (actual.cutTimes?.some((t) => !(t > 0 && t < actual.duration))) {
      ctx.addIssue({
        code: "custom",
        path: ["actual", "cutTimes"],
        message: "Cut boundaries must be inside the rendered video.",
      });
    }
    if (actual.clipping?.some((s) => s.end <= s.start || s.end > actual.duration + 1 / actual.fps)) {
      ctx.addIssue({
        code: "custom",
        path: ["actual", "clipping"],
        message: "Clipping spans must be nonempty and inside the output.",
      });
    }
    if (
      actual.observedCaptions?.some((c) => c.start < 0 || c.end <= c.start || c.end > actual.duration + 1 / actual.fps)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["actual", "observedCaptions"],
        message: "Observation times must belong to the rendered video.",
      });
    }
  });

const code = z.enum([
  "frame-size",
  "frame-rate",
  "frame-count",
  "duration",
  "picture-level",
  "cut-cadence",
  "true-peak",
  "sample-clipping",
  "caption-timing",
  "caption-presence",
  "caption-layout",
  "caption-contrast",
]);
const issueSchema = z.object({
  code,
  severity: z.enum(["warning", "error"]),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  confidence: unit,
  basis: z.string(),
  fix: z.string(),
});
const checkSchema = z.object({ id: code, status: z.enum(["pass", "issue", "unmeasured"]), basis: z.string() });
const metricsSchema = z.object({
  lumaDelta: z.number().nullable(),
  medianShotSeconds: positive.nullable(),
  peakExcessDb: z.number().nonnegative().nullable(),
  clippedSamples: z.number().int().nonnegative().nullable(),
});
export const RenderQualityReportSchema = z.object({
  status: z.enum(["pass", "review", "fail"]),
  checks: z.array(checkSchema),
  issues: z.array(issueSchema),
  metrics: metricsSchema,
  omittedIssueCount: z.number().int().nonnegative(),
});
export type RenderQualityInput = z.input<typeof RenderQualityInputSchema>;
export type RenderQualityReport = z.infer<typeof RenderQualityReportSchema>;
type Issue = z.infer<typeof issueSchema>;
type Check = z.infer<typeof checkSchema>;
type Code = Issue["code"];
type Cue = z.infer<typeof cue>;
const round = (value: number, decimals = 3) => Number(value.toFixed(decimals));
const within = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

function shotMedian(interior: number[], duration: number): number {
  const times = [0, ...[...new Set(interior)].sort((a, b) => a - b), duration];
  const spans = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .sort((a, b) => a - b);
  const m = Math.floor(spans.length / 2);
  return spans.length % 2 ? spans[m]! : (spans[m - 1]! + spans[m]!) / 2;
}

function textTokens(s: string) {
  return new Set(
    s
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}

/** A partial OCR match can confirm that a line was present. Exact OCR spelling is optional. */
function captionMatches(expected: Cue, seen: Cue, frame: number): boolean {
  const overlap = Math.min(expected.end, seen.end) - Math.max(expected.start, seen.start);
  if (overlap <= 0 || overlap + frame < 0.45 * Math.min(expected.end - expected.start, seen.end - seen.start))
    return false;
  if (!expected.text?.trim() || !seen.text?.trim()) return true;
  const a = textTokens(expected.text),
    b = textTokens(seen.text);
  if (!a.size || !b.size) return expected.text.trim() === seen.text.trim();
  const shared = [...a].filter((t) => b.has(t)).length;
  return shared > 0 && shared / Math.min(a.size, b.size) >= 0.6;
}

function outside(box: z.infer<typeof bounds>, width: number, height: number) {
  // Allow subpixel measurement rounding.
  return box.x < -0.5 || box.y < -0.5 || box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5;
}

export function assessRender(input: RenderQualityInput): RenderQualityReport {
  const { expected, actual } = RenderQualityInputSchema.parse(input);
  const checks: Check[] = [],
    issues: Issue[] = [];
  const flagged = new Set<Code>();
  let errors = 0,
    warnings = 0,
    missingRequired = false,
    omittedIssueCount = 0;
  const end = actual.duration,
    frame = 1 / expected.fps,
    plannedDuration = expected.frames * frame;
  const flag = (
    id: Code,
    severity: Issue["severity"],
    start: number,
    stop: number,
    confidence: number,
    basis: string,
    fix: string,
  ) => {
    flagged.add(id);
    if (severity === "error") errors++;
    else warnings++;
    if (issues.length >= 256) {
      omittedIssueCount++;
      return;
    }
    const from = within(start, 0, end);
    issues.push({
      code: id,
      severity,
      start: round(from, 6),
      end: round(within(stop, from, end), 6),
      confidence,
      basis,
      fix,
    });
  };
  const done = (id: Code, basis: string) => checks.push({ id, status: flagged.has(id) ? "issue" : "pass", basis });
  const unknown = (id: Code, basis: string, required = false) => {
    checks.push({ id, status: "unmeasured", basis });
    if (required) missingRequired = true;
  };
  const measure = (id: Code, ok: boolean, basis: string, fix: string) => {
    if (!ok) flag(id, "error", 0, end, 1, basis, fix);
    done(id, basis);
  };

  measure(
    "frame-size",
    expected.width === actual.width && expected.height === actual.height,
    `Probed ${actual.width}×${actual.height} pixels. Planned ${expected.width}×${expected.height}.`,
    "Render using the planned canvas dimensions.",
  );
  measure(
    "frame-rate",
    Math.abs(actual.fps - expected.fps) <= 0.005,
    `Probed video rate ${round(actual.fps, 4)} fps. Planned ${round(expected.fps, 4)} fps.`,
    "Check the exported video stream time base and encoder frame rate.",
  );
  if (actual.frames == null) unknown("frame-count", "Decoded or counted frame total was unavailable.", true);
  else
    measure(
      "frame-count",
      expected.frames === actual.frames,
      `Counted ${actual.frames} output frames. The planned timeline has ${expected.frames}.`,
      "Rebuild the affected timeline range at integer frame boundaries.",
    );
  measure(
    "duration",
    Math.abs(end - plannedDuration) <= frame + 0.002,
    `Probed video duration ${round(end)} s. Planned ${round(plannedDuration)} s with a one-frame tolerance.`,
    "Check the final video stream boundary and timeline duration.",
  );

  let lumaDelta: number | null = null;
  if (expected.medianLuma == null || actual.medianLuma == null) {
    unknown(
      "picture-level",
      "Comparison requires measured output luma and a comparable target in the same color range.",
      expected.medianLuma != null,
    );
  } else {
    lumaDelta = round(expected.medianLuma - actual.medianLuma, 6);
    const basis = `Median normalized luma ${round(actual.medianLuma)} against target ${round(expected.medianLuma)}. Review threshold 0.10.`;
    if (Math.abs(lumaDelta) > 0.1)
      flag(
        "picture-level",
        "warning",
        0,
        end,
        0.78,
        basis,
        "Review the exposure difference and try a small brightness correction if the source composition supports it.",
      );
    done("picture-level", basis);
  }

  const medianShotSeconds = actual.cutTimes == null ? null : shotMedian(actual.cutTimes, end);
  if (expected.medianShotSeconds == null || medianShotSeconds == null) {
    unknown(
      "cut-cadence",
      "Comparison requires a measured reference cadence and observed cuts in the output.",
      expected.medianShotSeconds != null,
    );
  } else if (end < expected.medianShotSeconds * 1.6) {
    unknown(
      "cut-cadence",
      "The output is shorter than 1.6 target shots. The cadence comparison has insufficient coverage.",
    );
  } else {
    const tolerance = Math.max(0.35, expected.medianShotSeconds * 0.35);
    const basis = `Detected median shot ${round(medianShotSeconds)} s, target ${round(expected.medianShotSeconds)} s, tolerance ${round(tolerance)} s.`;
    if (Math.abs(medianShotSeconds - expected.medianShotSeconds) > tolerance)
      flag(
        "cut-cadence",
        "warning",
        0,
        end,
        0.72,
        basis,
        "Review beat choices against speech and story boundaries before changing cut timing.",
      );
    done("cut-cadence", basis);
  }

  let peakExcessDb: number | null = null;
  if (actual.truePeakDbtp == null) unknown("true-peak", "No oversampled true-peak measurement was supplied.");
  else {
    peakExcessDb = round(Math.max(0, actual.truePeakDbtp - expected.peakCeilingDbtp));
    const basis = `Measured true peak ${round(actual.truePeakDbtp, 2)} dBTP, delivery ceiling ${expected.peakCeilingDbtp} dBTP (0.1 dB tolerance).`;
    if (peakExcessDb > 0.1)
      flag(
        "true-peak",
        actual.truePeakDbtp > 0 ? "error" : "warning",
        0,
        end,
        0.99,
        basis,
        "Lower the final mix gain and measure the encoded output again.",
      );
    done("true-peak", basis);
  }
  let clippedSamples: number | null = null;
  if (actual.clipping != null) {
    clippedSamples = actual.clipping.reduce((sum, span) => sum + span.samples, 0);
    for (const span of actual.clipping)
      flag(
        "sample-clipping",
        "error",
        span.start,
        span.end,
        0.99,
        `${span.samples} decoded audio samples reached or exceeded digital full scale in this interval.`,
        "Reduce mix gain before encoding and check the same interval again.",
      );
    done(
      "sample-clipping",
      `Decoded full-scale scan counted ${clippedSamples} samples in ${actual.clipping.length} intervals.`,
    );
  } else if (actual.samplePeakDbfs != null && actual.samplePeakDbfs >= 0) {
    const basis = `Measured sample peak ${round(actual.samplePeakDbfs, 2)} dBFS reached full scale. The time and sample count were unavailable.`;
    flag(
      "sample-clipping",
      "warning",
      0,
      end,
      0.85,
      basis,
      "Measure full-scale intervals and lower the mix if necessary.",
    );
    done("sample-clipping", basis);
  } else if (actual.samplePeakDbfs != null) {
    done(
      "sample-clipping",
      `Measured maximum sample amplitude ${round(actual.samplePeakDbfs, 2)} dBFS stayed below full scale. This check covers sample peaks.`,
    );
  } else unknown("sample-clipping", "Decoded clipping spans and sample peaks were unavailable.");

  const authored = expected.captions;
  const observed = actual.observedCaptions;
  if (authored == null) unknown("caption-timing", "No authored single-track cue timings were supplied.");
  else {
    let prevEnd = 0;
    for (const item of [...authored].sort((a, b) => a.start - b.start)) {
      if (item.start < 0 || item.end <= item.start || item.end > end + frame / 2)
        flag(
          "caption-timing",
          "error",
          item.start,
          item.end,
          1,
          `Authored cue spans ${round(item.start)}–${round(item.end)} s in a ${round(end)} s video.`,
          "Place the cue on valid output frames within the picture.",
        );
      if (item.end > item.start && item.start < prevEnd - frame / 2)
        flag(
          "caption-timing",
          "warning",
          item.start,
          Math.min(prevEnd, item.end),
          0.98,
          "Authored single-track caption cues overlap by more than half a frame.",
          "Review their reading windows and move the shared boundary.",
        );
      prevEnd = Math.max(prevEnd, item.end);
    }
  }

  if (authored == null || observed == null) {
    unknown(
      "caption-presence",
      "Rendered-picture text detections and authored expected cues are both needed.",
      Boolean(authored?.length),
    );
  } else {
    const seen = [...observed].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const item of [...authored].sort((a, b) => a.start - b.start)) {
      if (item.end <= item.start) continue;
      while (cursor < seen.length && seen[cursor]!.end <= item.start) cursor++;
      let matched = false;
      for (let j = cursor; j < seen.length && seen[j]!.start < item.end; j++) {
        const candidate = seen[j]!;
        if ((candidate.confidence ?? 1) < 0.5 || !captionMatches(item, candidate, frame)) continue;
        matched = true;
        if (candidate.timingVerified && item.text && candidate.text) {
          const drift = Math.max(Math.abs(candidate.start - item.start), Math.abs(candidate.end - item.end));
          if (drift > Math.max(0.12, 2 * frame))
            flag(
              "caption-timing",
              "warning",
              item.start,
              Math.max(item.end, candidate.end),
              candidate.confidence ?? 0.83,
              `Measured cue boundaries differ from its authored window by up to ${round(drift)} s.`,
              "Review the measured subtitle boundaries against the edit and its audio.",
            );
        }
        break;
      }
      if (!matched)
        flag(
          "caption-presence",
          "warning",
          item.start,
          item.end,
          0.65,
          "The picture detector reported no matching text during this authored cue.",
          "Inspect the rendered frames and repair caption rendering or timing if the cue is missing.",
        );
    }
    done(
      "caption-presence",
      `Compared ${authored.length} authored cues with ${observed.length} rendered-picture detections.`,
    );
  }
  if (authored != null)
    done(
      "caption-timing",
      `Checked ${authored.length} authored cues. Rendered observations with independently measured cue boundaries: ${observed?.filter((c) => c.timingVerified).length ?? 0}.`,
    );
  const measuredBounds = (observed ?? []).filter((c) => c.bounds);
  const authoredBounds = (authored ?? []).filter((c) => c.bounds);
  for (const c of authoredBounds) {
    if (outside(c.bounds!, expected.width, expected.height))
      flag(
        "caption-layout",
        "warning",
        c.start,
        c.end,
        0.95,
        "Authored text bounds extend outside the planned canvas.",
        "Fit the authored caption to the target canvas and inspect the result.",
      );
  }
  for (const c of measuredBounds) {
    if (outside(c.bounds!, actual.width, actual.height))
      flag(
        "caption-layout",
        "warning",
        c.start,
        c.end,
        c.confidence ?? 0.85,
        "Detected text bounds extend beyond the output picture.",
        "Move or resize the caption and check the corresponding rendered frames.",
      );
  }
  if (measuredBounds.length === 0 && !flagged.has("caption-layout"))
    unknown("caption-layout", `Rendered text bounds unavailable. Authored boxes checked: ${authoredBounds.length}.`);
  else
    done(
      "caption-layout",
      `Compared ${authoredBounds.length} authored boxes and ${measuredBounds.length} observed boxes with their canvases.`,
    );
  const contrast = (observed ?? []).filter((c) => c.contrastRatio != null);
  if (!contrast.length)
    unknown("caption-contrast", "No local foreground/background contrast measurements were supplied.");
  else {
    for (const c of contrast)
      if (c.contrastRatio! < 3)
        flag(
          "caption-contrast",
          "warning",
          c.start,
          c.end,
          c.confidence ?? 0.8,
          `Observed caption contrast ratio ${round(c.contrastRatio!, 2)} was below the 3:1 large-text review threshold.`,
          "Adjust the outline, backplate or caption color and remeasure.",
        );
    done("caption-contrast", `Checked local contrast for ${contrast.length} caption observations.`);
  }

  return RenderQualityReportSchema.parse({
    status: errors ? "fail" : warnings || missingRequired ? "review" : "pass",
    checks,
    issues,
    omittedIssueCount,
    metrics: { lumaDelta, medianShotSeconds, peakExcessDb, clippedSamples },
  });
}

export const RepairLimitsSchema = z.object({
  iteration: z.number().int().nonnegative().default(0),
  maxIterations: z.number().int().nonnegative().default(1),
  brightness: z.number().min(-0.08).max(0.08).default(0),
  gainDb: z.number().min(-6).max(0).default(0),
  previous: metricsSchema.partial().optional(),
  budget: z
    .object({ spent: z.number().nonnegative(), next: z.number().nonnegative(), limit: z.number().nonnegative() })
    .optional(),
});
export const RenderRepairSchema = z.object({
  brightness: z.number().min(-0.08).max(0.08),
  gainDb: z.number().min(-6).max(0),
  issues: z.array(code).min(1),
});
export type RenderRepair = z.infer<typeof RenderRepairSchema>;

/** Returns absolute cumulative FFmpeg brightness and mix gain. At most three re-renders.
 * Supply the preceding measurements to stop adjustments that do not improve the evidence. */
export function suggestRepair(
  report: RenderQualityReport,
  options: z.input<typeof RepairLimitsSchema> = {},
): RenderRepair | null {
  const result = RenderQualityReportSchema.parse(report),
    limits = RepairLimitsSchema.parse(options);
  if (limits.iteration >= Math.min(3, limits.maxIterations)) return null;
  if (limits.budget && limits.budget.spent + limits.budget.next - limits.budget.limit > 1e-9) return null;
  const flagged = new Set(result.checks.filter((c) => c.status === "issue").map((c) => c.id));
  let { brightness, gainDb } = limits;
  const changes: Code[] = [];
  const { lumaDelta, peakExcessDb, clippedSamples } = result.metrics;
  const old = limits.previous;
  if (
    flagged.has("picture-level") &&
    lumaDelta != null &&
    (old?.lumaDelta == null || Math.abs(lumaDelta) < Math.abs(old.lumaDelta) - 0.005)
  ) {
    brightness = round(within(brightness + within(lumaDelta * 0.5, -0.04, 0.04), -0.08, 0.08), 4);
    if (brightness !== limits.brightness) changes.push("picture-level");
  }
  const canReducePeak =
    flagged.has("true-peak") &&
    peakExcessDb != null &&
    (old?.peakExcessDb == null || peakExcessDb < old.peakExcessDb - 0.05);
  const canReduceClips =
    flagged.has("sample-clipping") &&
    (old == null || (clippedSamples != null && (old.clippedSamples == null || clippedSamples < old.clippedSamples)));
  if (canReducePeak || canReduceClips) {
    const reduction = within(Math.max(canReducePeak ? peakExcessDb! + 0.3 : 0, canReduceClips ? 1.5 : 0), 0.5, 3);
    gainDb = round(within(gainDb - reduction, -6, 0), 3);
    if (gainDb !== limits.gainDb) {
      if (canReducePeak) changes.push("true-peak");
      if (canReduceClips) changes.push("sample-clipping");
    }
  }
  return changes.length ? RenderRepairSchema.parse({ brightness, gainDb, issues: changes }) : null;
}
