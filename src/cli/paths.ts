import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file so the CLI works from any working directory. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Folder holding all projects (never committed). */
export const PROJECTS_ROOT = fileURLToPath(new URL("../../projects/", import.meta.url));
