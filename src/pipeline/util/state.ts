import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Bookkeeping that makes every pipeline step idempotent.
 *
 * A step records, for each unit of work (a clip, a whole file...), the fingerprint of
 * everything that unit depends on: input contents, options, and the step's algorithm
 * version. On the next run a unit is redone only if its fingerprint changed or its
 * outputs are missing. State lives in `work/.state/<step>.json`.
 */
export class StepState {
  private constructor(
    private readonly file: string,
    private readonly entries: Record<string, string>,
    private readonly fileHashes: Record<string, { size: number; mtimeMs: number; sha256: string }>,
  ) {}

  static async load(workDir: string, step: string): Promise<StepState> {
    const file = path.join(workDir, ".state", `${step}.json`);
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as {
        entries?: Record<string, string>;
        fileHashes?: Record<string, { size: number; mtimeMs: number; sha256: string }>;
      };
      return new StepState(file, data.entries ?? {}, data.fileHashes ?? {});
    } catch {
      return new StepState(file, {}, {});
    }
  }

  get(key: string): string | undefined {
    return this.entries[key];
  }

  set(key: string, value: string): void {
    this.entries[key] = value;
  }

  delete(key: string): void {
    delete this.entries[key];
  }

  keys(): string[] {
    return Object.keys(this.entries);
  }

  /**
   * sha256 of a file's content, memoised on (size, mtime) so large raw videos are
   * hashed once, not on every run.
   */
  async hashFile(filePath: string): Promise<string> {
    const info = await stat(filePath);
    const memo = this.fileHashes[filePath];
    if (memo && memo.size === info.size && memo.mtimeMs === info.mtimeMs) {
      return memo.sha256;
    }
    const sha256 = await sha256File(filePath);
    this.fileHashes[filePath] = { size: info.size, mtimeMs: info.mtimeMs, sha256 };
    return sha256;
  }

  async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeAtomic(this.file, JSON.stringify({ entries: this.entries, fileHashes: this.fileHashes }, null, 2) + "\n");
  }
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** Stable fingerprint of JSON-serialisable values (object keys sorted). */
export function fingerprint(...parts: unknown[]): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Writes through a temporary file so an interrupted run never leaves half a file. */
export async function writeAtomic(filePath: string, content: string | Buffer): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, content);
  await rename(tmp, filePath);
}

/** Writes JSON only when its content changed, so mtimes stay meaningful. Returns true if written. */
export async function writeJsonIfChanged(filePath: string, data: unknown): Promise<boolean> {
  const content = JSON.stringify(data, null, 2) + "\n";
  try {
    if ((await readFile(filePath, "utf8")) === content) {
      return false;
    }
  } catch {
    // missing: write it
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, content);
  return true;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
