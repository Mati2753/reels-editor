import { ffmpeg, run } from "../util/exec";
import { ms } from "../project";
import type { Interval } from "./intervals";

export interface Cut {
  time: number;
  score: number;
}

/** Parses `metadata=print` output of `scdet` (one block per scene-change frame). */
export function parseScdet(text: string): Cut[] {
  const cuts: Cut[] = [];
  let score: number | null = null;
  for (const line of text.split("\n")) {
    const s = /lavfi\.scd\.score=([\d.]+)/.exec(line);
    if (s?.[1] !== undefined) score = Number(s[1]);
    const t = /lavfi\.scd\.time=([\d.]+)/.exec(line);
    if (t?.[1] !== undefined && score !== null) {
      cuts.push({ time: ms(Number(t[1])), score: Math.round(score * 10) / 10 });
      score = null;
    }
  }
  return cuts;
}

/** Scene changes of a video: ffmpeg `scdet` on a downscaled copy (score 0-100). */
export async function detectCuts(video: string, threshold: number): Promise<Cut[]> {
  const { stdout } = await run("ffmpeg", [
    "-hide_banner", "-nostdin", "-i", video, "-an",
    "-vf", `scale=270:-2,scdet=threshold=${threshold}:sc_pass=1,metadata=print:file=-`,
    "-f", "null", "-",
  ]);
  return parseScdet(stdout);
}

/** Mean absolute difference (0-255) between two small grey thumbnails taken at t1 and t2. */
export async function frameDifference(video: string, t1: number, t2: number): Promise<number> {
  const grab = async (t: number): Promise<Buffer> => {
    const { stdout } = await runBinary("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(Math.max(0, t)), "-i", video, "-frames:v", "1", "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "-"]);
    return stdout;
  };
  const [a, b] = await Promise.all([grab(t1), grab(t2)]);
  const n = Math.min(a.length, b.length);
  if (n === 0) return 255;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / n;
}

async function runBinary(command: string, args: string[]): Promise<{ stdout: Buffer }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out) }) : reject(new Error(`${command} exited with ${code}`))));
  });
}

/**
 * Turns detected cuts into shots. Two cuts less than `minShot` apart around a picture that
 * comes back to what it was (camera flash, glitch, a hand passing) are a transient, not a
 * shot: both are dropped and the span is reported as a transient.
 */
export async function cutsToShots(
  video: string,
  duration: number,
  cuts: readonly Cut[],
  minShot: number,
  sameThreshold: number,
  difference: (video: string, t1: number, t2: number) => Promise<number> = frameDifference,
): Promise<{ shots: { start: number; end: number; cutScore: number | null }[]; transients: Interval[] }> {
  const kept: Cut[] = [];
  const transients: Interval[] = [];
  const frame = 1 / 30;
  for (let i = 0; i < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (a && b && b.time - a.time < minShot) {
      // ffmpeg -ss lands on the first frame at or after the time: aim between frames.
      const diff = await difference(video, a.time - 1.5 * frame, b.time + 0.5 * frame);
      if (diff < sameThreshold) {
        transients.push({ start: a.time, end: b.time });
        i += 1;
        continue;
      }
    }
    if (a) kept.push(a);
  }
  const shots: { start: number; end: number; cutScore: number | null }[] = [];
  let start = 0;
  let score: number | null = null;
  for (const c of kept) {
    if (c.time <= start) continue;
    shots.push({ start: ms(start), end: c.time, cutScore: score });
    start = c.time;
    score = c.score;
  }
  shots.push({ start: ms(start), end: ms(duration), cutScore: score });
  return { shots, transients };
}

export interface LoudnessSummary {
  integratedLufs: number | null;
  loudnessRange: number | null;
  truePeakDb: number | null;
}

export function parseEbur128(log: string): LoudnessSummary {
  const summary = log.slice(log.lastIndexOf("Summary:"));
  const grab = (re: RegExp): number | null => {
    const m = re.exec(summary);
    const v = m?.[1] !== undefined ? Number(m[1]) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  return {
    integratedLufs: grab(/I:\s+(-?[\d.]+) LUFS/),
    loudnessRange: grab(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDb: grab(/Peak:\s+(-?[\d.]+) dBFS/),
  };
}

/** EBU R128 loudness of a file's first audio stream. */
export async function measureLoudness(file: string): Promise<LoudnessSummary> {
  const { stderr } = await ffmpeg(["-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  return parseEbur128(stderr);
}

/** Silent intervals according to ffmpeg `silencedetect`. */
export async function detectSilence(wav: string, thresholdDb: number, minDuration: number): Promise<string> {
  const { stderr } = await ffmpeg(["-i", wav, "-af", `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, "-f", "null", "-"]);
  return stderr;
}

/** One JPEG, 540 px wide, of the frame shown at `time`. */
export async function extractFrame(video: string, time: number, out: string): Promise<void> {
  await ffmpeg(["-ss", time.toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", out]);
}
