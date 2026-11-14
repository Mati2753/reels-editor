import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, isValidSlug, ProjectError } from "./new";

describe("isValidSlug", () => {
  it.each(["demo", "my-reel", "reel-2026-11", "a", "x".repeat(64)])("accepts %j", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(["", "Demo", "my_reel", "my reel", "-demo", "demo-", "a--b", "../demo", "demo/x", ".", "é", "x".repeat(65)])(
    "rejects %j",
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});

describe("createProject", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "reels-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the project folder with raw/, work/ and out/", async () => {
    const projectsRoot = path.join(root, "projects");
    const dir = await createProject("demo", projectsRoot);

    expect(dir).toBe(path.join(projectsRoot, "demo"));
    expect((await readdir(dir)).sort()).toEqual(["out", "raw", "work"]);
    for (const sub of ["raw", "work", "out"]) {
      expect((await stat(path.join(dir, sub))).isDirectory()).toBe(true);
    }
  });

  it("refuses an invalid slug without creating anything", async () => {
    const projectsRoot = path.join(root, "projects");
    await expect(createProject("../escape", projectsRoot)).rejects.toBeInstanceOf(ProjectError);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("does not overwrite an existing project", async () => {
    const dir = await createProject("demo", root);
    const marker = path.join(dir, "raw", "clip.mp4");
    await writeFile(marker, "keep me");

    await expect(createProject("demo", root)).rejects.toThrow(/already exists/);
    await expect(readdir(path.join(dir, "raw"))).resolves.toEqual(["clip.mp4"]);
  });
});
