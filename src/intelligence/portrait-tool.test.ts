import { it, expect } from "vitest";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { generatePortrait } from "./portrait-tool";
import { ffprobeJson, run } from "../pipeline/util/exec";
it("decodes native source media, emits a real face matte and abstains on blank footage", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "portrait-matte-"));
  try {
    await copyFile(new URL("../../examples/portrait-matte/source.mp4", import.meta.url), path.join(root, "person.mp4"));
    await expect(generatePortrait(root, { file: "person.mp4", start: 9, end: 10 })).rejects.toThrow(/range/);
    const res = await generatePortrait(root, { file: "person.mp4", start: 0.5, end: 1 });
    expect(res.status).toBe("ready");
    expect((await stat(path.join(root, res.mask!))).size).toBeGreaterThan(500);
    const probe = (await ffprobeJson([
      "-show_entries",
      "stream=codec_name,nb_frames",
      path.join(root, res.composite!),
    ])) as { streams: { codec_name: string; nb_frames: string }[] };
    expect(probe.streams[0]).toMatchObject({ codec_name: "h264", nb_frames: "15" });
    expect(probe.streams[1]?.codec_name).toBe("aac");
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=120x96:d=0.5",
      "-threads",
      "1",
      path.join(root, "blank.mp4"),
    ]);
    const blank = await generatePortrait(root, { file: "blank.mp4" });
    expect(blank.status).toBe("uncertain");
    expect(blank.mask).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
