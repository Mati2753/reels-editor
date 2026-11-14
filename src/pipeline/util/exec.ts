import { spawn } from "node:child_process";

export class CommandError extends Error {
  override name = "CommandError";
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a program without a shell and collects its output.
 * Rejects with the tail of stderr when the exit code is not 0.
 */
export function run(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(new CommandError(`"${command}" was not found on PATH.`));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = stderr.trim().split("\n").slice(-15).join("\n");
        reject(new CommandError(`${command} exited with code ${code}:\n${tail}`));
      }
    });
  });
}

/** ffmpeg with the flags every pipeline call shares (no banner, no prompt). */
export function ffmpeg(args: readonly string[]): Promise<RunResult> {
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args]);
}

export async function ffprobeJson(args: readonly string[]): Promise<unknown> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-of", "json", ...args]);
  return JSON.parse(stdout) as unknown;
}
