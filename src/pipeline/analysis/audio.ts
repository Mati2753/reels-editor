import { readFile } from "node:fs/promises";

/** Reads a 16-bit PCM mono WAV (what ingest writes) into samples in [-1, 1]. */
export async function readWavMono16(file: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = await readFile(file);
  return parseWavMono16(buf);
}

export function parseWavMono16(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (channels !== 1 || bits !== 16) {
        throw new Error(`expected mono 16-bit PCM, got ${channels} channel(s) ${bits}-bit`);
      }
      const end = Math.min(buf.length, body + size);
      const n = Math.floor((end - body) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(body + 2 * i) / 32768;
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

export const DB_FLOOR = -90;

/** RMS level of consecutive frames of `frameSeconds`, in dBFS (floored at -90). */
export function frameLevels(samples: Float32Array, sampleRate: number, frameSeconds: number): number[] {
  const size = Math.max(1, Math.round(sampleRate * frameSeconds));
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i] ?? 0;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / (end - start));
    out.push(rms > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(rms)) : DB_FLOOR);
  }
  return out;
}

/**
 * Level under which a frame counts as silent: 15 dB above the noise floor (10th
 * percentile of the 10 ms levels), kept between -60 and -35 dBFS so a clip without any
 * pause, or a very clean one, still gets a sensible value.
 */
export function silenceThreshold(levels10ms: readonly number[]): number {
  if (levels10ms.length === 0) return -45;
  const sorted = [...levels10ms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? DB_FLOOR;
  return Math.round(Math.min(-35, Math.max(-60, floor + 15)));
}
