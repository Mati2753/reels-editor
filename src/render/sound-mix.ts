import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedEdl } from "../edl/resolved";

const assets = fileURLToPath(new URL("../../assets/", import.meta.url));

/** Construct the finishing mix from validated, resolved EDL events only. Input 0 is the picture and voice. */
export function soundMix(edl: ResolvedEdl, voiceFilter: string) {
  const inputs: string[] = [];
  const filters = [`[0:a]${voiceFilter},aresample=48000,aformat=channel_layouts=stereo[voice]`];
  const tracks = ["[voice]"];
  const seconds = edl.durationInFrames / edl.fps;
  const { music, sfx } = edl.audio;
  let index = 1;
  if (music) {
    inputs.push("-stream_loop", "-1", "-ss", String(music.startFrame / edl.fps), "-i", path.join(assets, music.file));
    const fade = Math.min(seconds, music.fadeOutFrames / edl.fps);
    const fadeFilter = fade ? `,afade=t=out:st=${seconds - fade}:d=${fade}` : "";
    filters.push(
      `[${index++}:a]aresample=48000,atrim=duration=${seconds},asetpts=PTS-STARTPTS,volume=${music.gainDb}dB${fadeFilter}[bed]`,
    );
    if (music.duck) {
      filters.push(
        "[voice]asplit[main][side]",
        "[bed][side]sidechaincompress=threshold=0.035:ratio=5:attack=15:release=250[ducked]",
      );
      tracks[0] = "[main]";
      tracks.push("[ducked]");
    } else tracks.push("[bed]");
  }
  for (const cue of sfx) {
    const n = index++;
    inputs.push("-i", path.join(assets, cue.file));
    const delay = Math.round((cue.fromFrame * 48000) / edl.fps);
    filters.push(`[${n}:a]aresample=48000,volume=${cue.gainDb}dB,adelay=${delay}S:all=1[fx${n}]`);
    tracks.push(`[fx${n}]`);
  }
  filters.push(
    `${tracks.join("")}amix=inputs=${tracks.length}:duration=first:normalize=0,alimiter=limit=0.89125:level=0:latency=1[mix]`,
  );
  return { inputs, filters: filters.join(";") };
}
