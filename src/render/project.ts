import { readFile } from "node:fs/promises";
import path from "node:path";
import { measureText } from "../edl/measure";
import type { Issue } from "../edl/issues";
import type { ResolvedEdl } from "../edl/resolved";
import { validateEdl, type ValidationResult } from "../edl/validate";
import { PipelineError, readJson, type ProjectPaths } from "../pipeline/project";
import { AnalysisSchema, ProbeSchema } from "../pipeline/schemas";

/**
 * The EDL a command works on: projects/<slug>/edl.json by default (outputs named after the
 * slug), or another file given with --edl (outputs named after the file: a variant or a
 * test montage of the same footage).
 */
export interface EdlTarget {
  file: string;
  name: string;
}

export function edlTarget(paths: ProjectPaths, file?: string): EdlTarget {
  if (!file) return { file: path.join(paths.dir, "edl.json"), name: paths.slug };
  const abs = path.resolve(file);
  return { file: abs, name: path.basename(abs).replace(/(\.edl)?\.json$/, "") };
}

/** Reads the EDL, probe.json and analysis.json and validates the EDL against them. */
export async function validateProject(paths: ProjectPaths, target: EdlTarget = edlTarget(paths)): Promise<ValidationResult> {
  const probe = await readJson(paths.probe, ProbeSchema, `run "reels ingest ${paths.slug}" first.`);
  const analysis = await readJson(paths.analysis, AnalysisSchema, `run "reels analyze ${paths.slug}" first.`);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(target.file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new PipelineError(`${target.file} is not valid JSON: ${error.message}`);
    throw new PipelineError(`${target.file} is missing: the director writes the EDL in projects/${paths.slug}/edl.json (see docs/EDL.md).`);
  }
  return validateEdl(json, { probe, analysis }, { measure: measureText });
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((i) => `  ${i.severity === "error" ? "error  " : "warning"} [${i.rule}] ${i.path}: ${i.message}`).join("\n");
}

/** Validates and returns the resolved EDL, or throws with every error. */
export async function resolvedProject(paths: ProjectPaths, target: EdlTarget, log: (m: string) => void): Promise<ResolvedEdl> {
  const result = await validateProject(paths, target);
  const warnings = result.issues.filter((i) => i.severity === "warning");
  if (warnings.length > 0) log(`${warnings.length} warning(s):\n${formatIssues(warnings)}`);
  if (!result.ok || !result.resolved) {
    throw new PipelineError(`${path.basename(target.file)} has errors, fix them first:\n${formatIssues(result.issues.filter((i) => i.severity === "error"))}`);
  }
  return result.resolved;
}
