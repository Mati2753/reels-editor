import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../pipeline/util/exec";
import { projectMedia } from "./project-media";
let base = "",
  root = "";
beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "edit-tools-"));
  root = path.join(base, "project");
  await mkdir(root);
  await run("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=96x64:d=1:r=20",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    path.join(root, "clip.mp4"),
  ]);
  await writeFile(path.join(base, "private"), "private");
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});
describe("native project media tools", () => {
  it("writes a real frame, trim, crop and graded clip", async () => {
    const frame = await projectMedia(root, "clip.mp4", { operation: "frame", at: 0.2 });
    expect((await readFile(path.join(root, frame.file))).subarray(1, 4).toString()).toBe("PNG");
    expect((await projectMedia(root, "clip.mp4", { operation: "trim", start: 0.25, end: 0.75 })).codec).toBe("h264");
    expect(
      (
        await projectMedia(root, "clip.mp4", {
          operation: "reframe",
          width: 64,
          height: 96,
          centerX: 0.7,
          centerY: 0.4,
        })
      ).height,
    ).toBe(96);
    await writeFile(
      path.join(root, "identity.cube"),
      "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
    );
    expect((await projectMedia(root, "clip.mp4", { operation: "grade", lut: "identity.cube" })).width).toBe(96);
  });
  it("renders the bundled LUT, texture, mesh rendition and transparent VFX with the native processor", async () => {
    for (const assetId of ["lut-amber", "texture-paper", "object-crystal", "overlay-glint"] as const) {
      const clip = await projectMedia(root, "clip.mp4", {
        operation: "apply-library-asset",
        assetId,
        start: 0.15,
        end: 0.75,
      });
      expect(clip).toMatchObject({ width: 96, codec: "h264" });
    }
    await expect(
      projectMedia(root, "clip.mp4", {
        operation: "apply-library-asset",
        assetId: "lut-amber",
        start: 2,
      }),
    ).rejects.toThrow(/range/);
  }, 30000);
  it("rejects outside files and empty ranges", async () => {
    await expect(projectMedia(root, "../private", { operation: "frame", at: 0 })).rejects.toThrow(/inside/);
    await expect(projectMedia(root, "clip.mp4", { operation: "trim", start: 0.9, end: 0.2 })).rejects.toThrow(/range/);
  });
});
