import { writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeReferenceFile } from "../intelligence/native-reference";
import { type Format } from "./format-model";
export { FormatSchema,presets,type Format } from "./format-model";
import { ffprobeJson } from "../pipeline/util/exec";

export async function inspectVideo(file: string) {
  const data = (await ffprobeJson([
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    "mov,matroska,webm,avi,mpegts",
    "-show_streams",
    "-show_format",
    file,
  ])) as {
    streams: {
      codec_type: string;
      codec_name?: string;
      duration?: string;
      width?: number;
      height?: number;
      disposition?: { attached_pic?: number };
    }[];
    format: { duration?: string };
  };
  const video = data.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(video?.duration) || Number(data.format.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Choose a video with a readable picture and duration.");
  }
  const subtitle = data.streams.findIndex(
    (s) => s.codec_type === "subtitle" && ["mov_text", "subrip", "webvtt", "ass", "ssa"].includes(s.codec_name ?? ""),
  );
  return { duration, hasAudio: data.streams.some((s) => s.codec_type === "audio"), subtitle };
}

export async function learnFormat(file:string,id:string,name:string,evidenceDir?:string):Promise<Format> {
  const result=await analyzeReferenceFile(file,id,name,Boolean(evidenceDir));
  if(evidenceDir)await writeFile(path.join(evidenceDir,"evidence.json"),JSON.stringify({analysis:result.evidence,frames:result.frames}));
  return result.format;
}
