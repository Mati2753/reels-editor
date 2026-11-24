import type { Transcript, Word } from "../pipeline/schemas";
import { ms } from "../pipeline/project";

/** SRT times belong to cues. Distribute words within each cue for the word-level EDL. */
export function importSrt(text: string, duration: number): Transcript {
  const words: Word[] = [];
  const stamp = (h: string, m: string, s: string, f: string) =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(f.padEnd(3, "0")) / 1000;
  let previous = 0;
  for (const block of text
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)) {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]?.trim() ?? "")) lines.shift();
    const match =
      /^(\d+):([0-5]\d):([0-5]\d)[.,](\d{1,3})\s*-->\s*(\d+):([0-5]\d):([0-5]\d)[.,](\d{1,3})(?:\s.*)?$/.exec(
        lines.shift()?.trim() ?? "",
      );
    if (!match) throw new Error("Use an SRT file with numbered, timestamped subtitle cues.");
    const start = stamp(match[1]!, match[2]!, match[3]!, match[4]!);
    const end = stamp(match[5]!, match[6]!, match[7]!, match[8]!);
    if (start < previous || end <= start || end > duration + 0.12)
      throw new Error("Subtitle cues must be in order, within the footage, and must not overlap.");
    previous = end;
    const tokens = lines
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const span = Math.min(end, duration) - start;
    tokens.forEach((word, i) =>
      words.push({
        id: `c1-w${words.length + 1}`,
        clip: "c1",
        text: word,
        start: ms(start + (span * i) / tokens.length),
        end: ms(start + (span * (i + 1)) / tokens.length),
        confidence: 1,
      }),
    );
  }
  if (!words.length) throw new Error("The subtitle file contains no text.");
  return { language: "und", engine: { name: "SRT", model: "cue interpolation" }, words };
}
