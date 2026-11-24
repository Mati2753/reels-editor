import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ffmpeg } from "../pipeline/util/exec";
import { learnFormat } from "./formats";

it("measures real scene boundaries, sound and embedded caption groups in a reference", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reels-format-"));
  try {
    const cues = path.join(dir, "reference.srt");
    const video = path.join(dir, "reference.mp4");
    await writeFile(
      cues,
      "1\n00:00:00,100 --> 00:00:01,800\nThree words here\n\n2\n00:00:02,100 --> 00:00:03,800\nKeep this pace\n",
    );
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=120x180:r=12:d=2",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=120x180:r=12:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=4",
      "-i",
      cues,
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-map",
      "2:a",
      "-map",
      "3:s",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-c:s",
      "mov_text",
      video,
    ]);
    const format = await learnFormat(video, "ref-test", "Two-shot style");
    expect(format.reference).toMatchObject({ shots: 2, medianShot: 2, captionCueWords: 3, flashes: 0 });
    expect(format.shotSeconds).toBe(2);
    expect(format.captionWords).toBe(3);
    expect(format.musicDb).not.toBeNull();
    expect(format.reference!.silentShare).toBeLessThan(0.1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
