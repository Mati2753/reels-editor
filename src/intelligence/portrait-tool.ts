import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { projectFile } from "./project-media";
import { evaluateMatte, portraitModel } from "./portrait-matte";
import { ffprobeJson, run } from "../pipeline/util/exec";

export const PortraitToolInput = z.object({
  file: z.string().min(1),
  start: z.number().nonnegative().default(0),
  end: z.number().positive().optional(),
  background: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#26334a"),
});
export const PortraitToolOutput = z.object({
  status: z.enum(["ready", "uncertain"]),
  frames: z.int().nonnegative(),
  mask: z.string().nullable(),
  composite: z.string().nullable(),
  measurements: z.string(),
  seconds: z.number().positive(),
});
const command = promisify(execFile);
const restrict = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mpegts"];
const modelDir = fileURLToPath(new URL("../../assets/portrait/", import.meta.url));
const { size, rate } = portraitModel;
async function worker() {
  const model = Buffer.concat(
    await Promise.all([0, 1].map((i) => readFile(path.join(modelDir, "model-" + i + ".bin")))),
  );
  if (createHash("sha256").update(model).digest("hex") !== portraitModel.sha256)
    throw Error("The bundled portrait model failed its integrity check.");
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  return { session, ort };
}
export async function generatePortrait(root: string, input: z.input<typeof PortraitToolInput>) {
  const args = PortraitToolInput.parse(input);
  const file = await projectFile(root, args.file);
  const info = (await ffprobeJson([
    ...restrict,
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration:format=duration",
    file,
  ])) as { streams: { width: number; height: number; duration?: string }[]; format: { duration: string } };
  const video = info.streams[0];
  const duration = Number(video?.duration) || Number(info.format.duration),
    end = args.end ?? duration;
  if (!video || !Number.isFinite(duration) || end > duration + 0.001 || end - args.start < 1 / rate)
    throw Error("Choose a portrait range inside the video of at least one eighth of a second.");
  const seconds = end - args.start;
  await mkdir(path.join(root, "generated"), { recursive: true });
  const dir = await mkdtemp(path.join(await projectFile(root, "generated"), "portrait-"));
  const name = (n: string) => path.join(dir, n),
    relative = (n: string) => path.relative(root, name(n));
  const raw = name("alpha.gray"),
    observations: { at: number; foreground: number; background: number }[] = [];
  try {
    const { session, ort } = await worker();
    const plane = size * size,
      tensor = new ort.Tensor("float32", new Float32Array(plane * 3), [1, 3, size, size]);
    const handle = await open(raw, "wx");
    let accepted = true,
      count = 0;
    try {
      for (let offset = 0; offset < seconds - 0.001 && accepted; offset += 2) {
        const length = Math.ceil(Math.min(2, seconds - offset) * rate - 0.00001);
        const { stdout: rgb } = await command(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            ...restrict,
            "-ss",
            String(args.start + offset),
            "-i",
            file,
            "-map",
            "0:v:0",
            "-vf",
            `fps=${rate}:round=up,scale=${size}:${size}`,
            "-frames:v",
            String(length),
            "-pix_fmt",
            "rgb24",
            "-threads",
            "1",
            "-f",
            "rawvideo",
            "pipe:1",
          ],
          { encoding: "buffer", maxBuffer: plane * 3 * length + 4096 },
        );
        for (let f = 0; f < Math.floor(rgb.length / (3 * plane)); f++) {
          for (let k = 0; k < plane; k++)
            for (let c = 0; c < 3; c++) tensor.data[c * plane + k] = rgb[(f * plane + k) * 3 + c]! / 127.5 - 1;
          const prediction = await session.run({ input: tensor });
          const out = prediction.output!;
          const evidence = evaluateMatte(out.data as Float32Array, size);
          out.dispose();
          observations.push({
            at: args.start + offset + f / rate,
            foreground: evidence.foreground,
            background: evidence.background,
          });
          if (!evidence.accepted) {
            accepted = false;
            break;
          }
          await handle.writeFile(evidence.mask);
          count++;
        }
      }
    } finally {
      await handle.close();
      tensor.dispose();
      await session.release();
    }
    accepted = accepted && count >= Math.max(1, Math.floor(seconds * rate) - 1);
    await writeFile(
      name("measurements.json"),
      JSON.stringify({ model: portraitModel, sourceIn: args.start, sourceOut: end, accepted, observations }),
    );
    const result = {
      status: accepted ? "ready" : "uncertain",
      frames: count,
      mask: null as string | null,
      composite: null as string | null,
      measurements: relative("measurements.json"),
      seconds,
    };
    if (accepted) {
      const maskInput = [
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-s",
        size + "x" + size,
        "-framerate",
        String(rate),
        "-i",
        raw,
      ];
      const start = [
        "-v",
        "error",
        "-nostdin",
        "-filter_complex_threads",
        "1",
        ...restrict,
        "-ss",
        String(args.start),
        "-t",
        String(seconds),
        "-i",
        file,
        ...maskInput,
      ];
      const encoded = [
        "-threads",
        "1",
        "-c:v",
        "libx264",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
      ];
      const align = "[0:v]fps=30,setpts=PTS-STARTPTS";
      const color = args.background.replace("#", "0x");
      // Scale the predicted plane back to the dimensions of FFmpeg's rotated display picture.
      await run("ffmpeg", [
        ...start,
        "-filter_complex",
        align +
          ",split[subject][under];[under]drawbox=x=0:y=0:w=iw:h=ih:color=" +
          color +
          ":t=fill[bg];[1:v][subject]scale2ref[mask][pic];[pic][mask]alphamerge[fg];[bg][fg]overlay[out]",
        "-map",
        "[out]",
        "-map",
        "0:a:0?",
        ...encoded,
        "-c:a",
        "aac",
        "-t",
        String(seconds),
        name("composite.mp4"),
      ]);
      await run("ffmpeg", [
        ...start,
        "-filter_complex",
        align +
          "[ref];[1:v][ref]scale2ref[mask][unused];[unused]nullsink;[mask]fps=30,tpad=stop_mode=clone:stop_duration=0.25[out]",
        "-map",
        "[out]",
        ...encoded,
        "-t",
        String(seconds),
        name("mask.mp4"),
      ]);
      result.mask = relative("mask.mp4");
      result.composite = relative("composite.mp4");
    }
    return PortraitToolOutput.parse(result);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(raw, { force: true });
  }
}
