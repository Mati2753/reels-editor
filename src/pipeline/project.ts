import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";

export class PipelineError extends Error {
  override name = "PipelineError";
}

export interface ProjectPaths {
  slug: string;
  dir: string;
  raw: string;
  work: string;
  out: string;
  probe: string;
  transcript: string;
  analysis: string;
  frames: string;
  renderWorkspace?: string;
}

export function projectPaths(projectsRoot: string, slug: string): ProjectPaths {
  const dir = path.resolve(projectsRoot, slug);
  const work = path.join(dir, "work");
  return {
    slug,
    dir,
    raw: path.join(dir, "raw"),
    work,
    out: path.join(dir, "out"),
    probe: path.join(work, "probe.json"),
    transcript: path.join(work, "transcript.json"),
    analysis: path.join(work, "analysis.json"),
    frames: path.join(work, "frames"),
  };
}

export async function requireProject(projectsRoot: string, slug: string): Promise<ProjectPaths> {
  const paths = projectPaths(projectsRoot, slug);
  try {
    if ((await stat(paths.dir)).isDirectory()) {
      return paths;
    }
  } catch {
    // fall through
  }
  throw new PipelineError(`Project "${slug}" not found at ${paths.dir}; create it with "reels new ${slug}".`);
}

/** Reads and validates a JSON file written by an earlier step. */
export async function readJson<T extends z.ZodType>(file: string, schema: T, hint: string): Promise<z.infer<T>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new PipelineError(`${path.basename(file)} is missing: ${hint}`);
  }
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new PipelineError(`${file} does not match its schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts", ".3gp"]);

export async function listRawVideos(rawDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(rawDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith(".") && VIDEO_EXTENSIONS.has(path.extname(n).toLowerCase()))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export { ms } from "../edl/time";
