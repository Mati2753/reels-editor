import { bundle } from "@remotion/bundler";
import { openBrowser, selectComposition, type ChromiumOptions } from "@remotion/renderer";
import { readdir, readFile, rm, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEDIA_DIR } from "../edl/resolve";
import type { ResolvedEdl } from "../edl/resolved";
import type { ProjectPaths } from "../pipeline/project";
import type { Probe } from "../pipeline/schemas";
import { fingerprint } from "../pipeline/util/state";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ENTRY_POINT = path.join(REPO_ROOT, "src", "remotion", "index.ts");

export const COMPOSITION_ID = "Reel";

/**
 * Chrome used by Remotion. On a normal machine Remotion downloads its own headless shell;
 * set REELS_BROWSER_EXECUTABLE (or pass --browser-executable) to use an installed one.
 */
export function browserExecutable(option?: string): string | null {
  return option ?? process.env.REELS_BROWSER_EXECUTABLE ?? null;
}

export const chromiumOptions: ChromiumOptions = {};

/** Work folder of the renderer: projects/<slug>/work/render/. */
export function renderDir(paths: ProjectPaths): string {
  return path.join(paths.work, "render");
}

/**
 * Public directory of the bundle: media/<clip> is a symbolic link to the clip's folder in
 * work/, so the clips are served at the paths the resolver gave them (media/c1/source.mp4)
 * without copying any video. Links point to folders: Remotion's file server refuses a link
 * to a file.
 */
async function preparePublicDir(paths: ProjectPaths, probe: Probe): Promise<string> {
  const dir = path.join(renderDir(paths), "public");
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, MEDIA_DIR), { recursive: true });
  const folders = new Set(probe.clips.map((c) => path.dirname(c.normalized.video)));
  for (const f of folders) await symlink(path.join(paths.work, f), path.join(dir, MEDIA_DIR, f), "dir");
  return dir;
}

export async function bundleReel(paths: ProjectPaths, probe: Probe, log: (m: string) => void): Promise<string> {
  const publicDir = await preparePublicDir(paths, probe);
  const outDir = path.join(renderDir(paths), "bundle");
  await rm(outDir, { recursive: true, force: true });
  log("bundling the composition...");
  return bundle({ entryPoint: ENTRY_POINT, rootDir: REPO_ROOT, publicDir, outDir, onSymlinkDetected: () => undefined });
}

export async function selectReel(serveUrl: string, edl: ResolvedEdl, browser: string | null, puppeteerInstance?: Awaited<ReturnType<typeof openBrowser>>) {
  return selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: { edl },
    browserExecutable: browser,
    chromiumOptions,
    logLevel: "error",
    ...(puppeteerInstance ? { puppeteerInstance } : {}),
  });
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out.sort();
}

/** Fingerprint of everything the pixels depend on besides the EDL: renderer code and fonts. */
export async function rendererFingerprint(): Promise<string> {
  const files = [
    ...(await listFiles(path.join(REPO_ROOT, "src", "remotion"))),
    ...(await listFiles(path.join(REPO_ROOT, "src", "brand"))),
    ...(await listFiles(path.join(REPO_ROOT, "assets", "fonts"))),
    path.join(REPO_ROOT, "src", "edl", "framing.ts"),
    path.join(REPO_ROOT, "package-lock.json"),
  ];
  const parts: string[] = [];
  for (const f of files) parts.push(path.relative(REPO_ROOT, f), fingerprint((await readFile(f)).toString("base64")));
  return fingerprint(parts);
}
