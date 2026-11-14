import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Sub-folders created inside every project, see docs/ARCHITECTURE.md. */
export const PROJECT_SUBDIRS = ["raw", "work", "out"] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 64;

/** A slug is lowercase ASCII letters and digits, optionally separated by single hyphens. */
export function isValidSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

export class ProjectError extends Error {
  override name = "ProjectError";
}

/**
 * Creates `<projectsRoot>/<slug>/` with its sub-folders.
 * Refuses an invalid slug and never touches an existing project.
 * Returns the absolute path of the new project.
 */
export async function createProject(slug: string, projectsRoot: string): Promise<string> {
  if (!isValidSlug(slug)) {
    throw new ProjectError(
      `Invalid slug "${slug}": use lowercase letters, digits and single hyphens (max ${SLUG_MAX_LENGTH} characters), e.g. "my-reel-2".`,
    );
  }

  const projectDir = path.resolve(projectsRoot, slug);
  await mkdir(projectsRoot, { recursive: true });

  try {
    // Non-recursive: fails atomically if the project already exists.
    await mkdir(projectDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new ProjectError(`Project "${slug}" already exists at ${projectDir}; nothing was changed.`);
    }
    throw error;
  }

  for (const sub of PROJECT_SUBDIRS) {
    await mkdir(path.join(projectDir, sub));
  }
  return projectDir;
}
