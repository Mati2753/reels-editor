import path from "node:path";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { productionFiles } from "./production-assets";
import { z } from "zod";
import { run, ffprobeJson } from "../pipeline/util/exec";

export const MediaOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("frame"), at: z.number().nonnegative() }),
  z.object({
    operation: z.literal("trim"),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  }),
  z.object({
    operation: z.literal("apply-library-asset"),
    assetId: z.enum(["lut-amber", "texture-paper", "object-crystal", "overlay-glint"]),
    start: z.number().nonnegative().default(0),
    end: z.number().positive().optional(),
  }),
  z.object({ operation: z.literal("grade"), lut: z.string().min(1) }),
  z.object({
    operation: z.literal("reframe"),
    width: z.number().int().min(64).max(3840).multipleOf(2),
    height: z.number().int().min(64).max(3840).multipleOf(2),
    centerX: z.number().min(0).max(1),
    centerY: z.number().min(0).max(1),
  }),
]);
export const MediaResultSchema = z.object({
  file: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z.string(),
});
export async function projectFile(root: string, name: string) {
  const base = await realpath(root),
    file = await realpath(path.resolve(base, name));
  const relative = path.relative(base, file);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw Error("Choose media inside the projects folder.");
  return file;
}
export async function projectMedia(root: string, name: string, op: z.input<typeof MediaOperationSchema>) {
  const action = MediaOperationSchema.parse(op),
    input = await projectFile(root, name);
  const base = await realpath(root);
  const gen = path.join(base, "generated");
  await mkdir(gen, { recursive: true });
  await projectFile(base, "generated");
  const dir = await mkdtemp(path.join(gen, "media-"));
  try {
    const protocols = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mpegts"];
    const meta = (await ffprobeJson([...protocols, "-show_entries", "format=duration", input])) as {
      format: { duration: string };
    };
    const duration = Number(meta.format.duration);
    if (!(duration > 0)) throw Error("A known input duration is required.");
    const isFrame = action.operation === "frame";
    const filename = path.join(dir, isFrame ? "frame.png" : "clip.mp4");
    const args = ["-hide_banner", "-nostdin", "-loglevel", "error", ...protocols, "-i", input];
    if (action.operation === "frame") {
      if (action.at >= duration) throw Error("Frame time is outside the video.");
      args.push("-ss", String(action.at), "-frames:v", "1", "-threads", "1");
    } else {
      if (action.operation === "trim") {
        if (action.end <= action.start || action.end > duration + 0.001)
          throw Error("Choose a trim range inside the source.");
        args.push("-ss", String(action.start), "-t", String(action.end - action.start));
      }
      if (action.operation === "grade") {
        const lut = await projectFile(base, action.lut);
        if (path.extname(lut).toLowerCase() !== ".cube") throw Error("Choose a .cube LUT.");
        const { copyFile } = await import("node:fs/promises");
        await copyFile(lut, path.join(dir, "grade.cube"));
        args.push("-vf", "lut3d=file=grade.cube");
      }
      if (action.operation === "apply-library-asset") {
        const end = action.end ?? duration;
        if (end <= action.start || end > duration + 0.001) throw Error("Choose an asset range inside the source.");
        const id = action.assetId;
        const resource = fileURLToPath(new URL("../../assets/production/" + productionFiles[id], import.meta.url));
        const enable = "enable='gte(t," + action.start + ")*lt(t," + end + ")'";
        if (id === "lut-amber") {
          const { copyFile } = await import("node:fs/promises");
          await copyFile(resource, path.join(dir, "grade.cube"));
          args.push("-vf", "lut3d=file=grade.cube:" + enable);
        } else {
          if (id === "texture-paper") args.push("-loop", "1", "-framerate", "30");
          else args.push("-stream_loop", "-1");
          args.push("-i", resource);
          const size = id === "texture-paper" ? "w=iw:h=ih" : "w='min(iw,ih)*0.42':h=ow";
          const graph =
            "[1:v]setpts=PTS-STARTPTS+" +
            action.start +
            "/TB[placed];" +
            "[placed][0:v]scale2ref=" +
            size +
            "[layer][base];[base][layer]overlay=" +
            "x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:shortest=1:" +
            enable +
            "[result]";
          args.push("-filter_complex", graph, "-t", String(duration));
        }
      }
      if (action.operation === "reframe") {
        const { width: w, height: h, centerX: x, centerY: y } = action;
        args.push(
          "-vf",
          `scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${w}:${h}:x='clip(iw*${x}-ow/2,0,iw-ow)':y='clip(ih*${y}-oh/2,0,ih-oh)',setsar=1`,
        );
      }
      args.push(
        "-map",
        action.operation === "apply-library-asset" && action.assetId !== "lut-amber" ? "[result]" : "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
      );
    }
    await run("ffmpeg", [...args, filename], { cwd: dir });
    const info = (await ffprobeJson(["-select_streams", "v:0", "-show_streams", filename])) as {
      streams: { width: number; height: number; codec_name: string }[];
    };
    const video = info.streams[0]!;
    return MediaResultSchema.parse({
      file: path.relative(base, filename),
      width: video.width,
      height: video.height,
      codec: video.codec_name,
    });
  } catch (error) {
    await rm(dir, { force: true, recursive: true });
    throw error;
  }
}
