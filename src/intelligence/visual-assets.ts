import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const fraction = z.number().min(0).max(1);
const seconds = z.number().nonnegative();
const rgb = z.string().regex(/^#[0-9A-F]{6}$/);
const bounds = z
  .object({ x: fraction, y: fraction, width: fraction.positive(), height: fraction.positive() })
  .refine((b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001, "Text box exceeds the measured frame");

export const VisualAssetOptionsSchema = z
  .strictObject({
    timestamps: z.array(seconds).min(1).max(48).optional(),
    maxFrames: z.number().int().min(1).max(48).default(16),
    language: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,12}(?:\+[a-z][a-z0-9_]{1,12}){0,3}$/)
      .default("eng"),
    minConfidence: fraction.default(0.65),
    semanticLabels: z
      .array(z.string().trim().min(1).max(80))
      .min(2)
      .max(12)
      .refine(
        (labels) => new Set(labels.map((label) => label.toLowerCase())).size === labels.length,
        "Choose distinct visual labels",
      )
      .optional(),
  })
  .refine((o) => !o.timestamps || new Set(o.timestamps).size <= o.maxFrames, "Requested times exceed the frame budget");

const line = z.object({
  text: z.string().min(1),
  confidence: fraction,
  box: bounds,
  words: z.array(z.object({ text: z.string().min(1), confidence: fraction, box: bounds })).min(1),
  colors: z
    .object({
      ink: rgb,
      background: rgb,
      contrastRatio: z.number().min(1).max(21.01),
      backgroundAgreement: fraction,
      inkCoverage: fraction,
      method: z.literal("word-box-pixel-clusters"),
    })
    .nullable(),
});

export const VisualAssetReportSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    duration: seconds.positive(),
    startSeconds: z.number(),
    streamIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    timeBase: z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }),
  }),
  requestedSeconds: z.array(seconds).min(1).max(48),
  samples: z
    .array(
      z.object({
        pts: z.number().int(),
        seconds,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        lines: z.array(line),
        semanticRanks: z.array(z.object({ label: z.string(), relativeScore: fraction, logit: z.number() })),
      }),
    )
    .min(1)
    .max(48),
  cues: z.array(
    z.object({
      text: z.string(),
      firstSeen: seconds,
      lastSeen: seconds,
      previousSample: seconds.nullable(),
      nextSample: seconds.nullable(),
      observations: z.number().int().positive(),
      confidence: fraction,
      box: bounds,
    }),
  ),
  captionStyle: z
    .object({
      status: z.literal("inferred"),
      basis: z.string(),
      distinctLines: z.number().int().min(2),
      centerX: fraction,
      centerY: fraction,
      relativeTextHeight: fraction,
      medianWordsPerLine: z.number().positive(),
      estimatedInk: rgb.nullable(),
      fontFamily: z.null(),
      animation: z.null(),
    })
    .nullable(),
  semantics: z.object({
    status: z.enum(["disabled", "ready", "unavailable"]),
    model: z.string(),
    revision: z.string(),
    labels: z.array(z.string()),
    reason: z.string().nullable(),
  }),
  unresolved: z.array(z.string()),
  runtime: z.object({ ocr: z.string(), ffmpeg: z.string(), seconds, language: z.string(), minConfidence: fraction }),
});

export type VisualAssetOptions = z.input<typeof VisualAssetOptionsSchema>;
export type VisualAssetReport = z.infer<typeof VisualAssetReportSchema>;

const script = fileURLToPath(new URL("../../scripts/inspect-reference-frames.py", import.meta.url));

/** The caller controls allowedDirectory. A service must pass its authorized media directory. */
export async function inspectVisualAssets(
  file: string,
  options: VisualAssetOptions = {},
  allowedDirectory?: string,
): Promise<VisualAssetReport> {
  const input = VisualAssetOptionsSchema.parse(options);
  if (!file || /^(?:[a-z][\w+.-]*:\/\/|(?:data|file|pipe|concat):)/i.test(file)) {
    throw new Error("Choose a local video file.");
  }
  const source = await realpath(file);
  if (allowedDirectory) {
    const relative = path.relative(await realpath(allowedDirectory), source);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw new Error("The selected file is outside this project's media directory.");
    }
  }
  if (!(await stat(source)).isFile() || /\.(?:m3u8?|ffconcat)$/i.test(source)) {
    throw new Error("Choose a local video file in a supported media container.");
  }
  const python =
    process.env.REELS_VISUAL_PYTHON ||
    process.env.REELS_PYTHON ||
    (process.platform === "win32" ? "python" : "python3");
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      python,
      [script, source],
      { encoding: "utf8", windowsHide: true, timeout: 300_000, maxBuffer: 24 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr.trim().slice(-700) ||
                "The reference-image worker could not start or finish. Check Python and its local dependencies.",
            ),
          );
        } else resolve(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(input));
  });
  return VisualAssetReportSchema.parse(JSON.parse(output));
}
