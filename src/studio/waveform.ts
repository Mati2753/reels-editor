import { ffmpeg } from "../pipeline/util/exec";

export async function waveform(input: string, png: string) {
  await ffmpeg([
    "-i",
    input,
    "-filter_complex",
    "aformat=channel_layouts=mono,showwavespic=s=960x56:colors=0x93c8b7:scale=sqrt",
    "-frames:v",
    "1",
    png,
  ]);
}
