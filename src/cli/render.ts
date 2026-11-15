import type { Command } from "commander";
import path from "node:path";
import { requireProject } from "../pipeline/project";
import { preview } from "../render/preview";
import { edlTarget, formatIssues, validateProject } from "../render/project";
import { render } from "../render/render";
import { PROJECTS_ROOT, REPO_ROOT } from "./paths";

const EDL_HELP = "EDL file to use instead of projects/<slug>/edl.json (outputs are named after it)";
const BROWSER_HELP = "Chrome / headless shell to use (default: REELS_BROWSER_EXECUTABLE, else the one Remotion downloads)";

export function registerRender(program: Command): void {
  program
    .command("validate")
    .description("check edl.json against its schema, the facts and the rules of docs/EDL.md")
    .argument("<slug>", "project identifier")
    .option("--edl <file>", EDL_HELP)
    .action(async (slug: string, opts: { edl?: string }) => {
      const paths = await requireProject(PROJECTS_ROOT, slug);
      const r = await validateProject(paths, edlTarget(paths, opts.edl));
      const errors = r.issues.filter((i) => i.severity === "error");
      if (r.issues.length > 0) console.log(formatIssues(r.issues));
      if (r.resolved) {
        const e = r.resolved;
        console.log(`${e.segments.length} segments, ${e.captions.pages.length} caption pages, ${e.durationInFrames} frames (${(e.durationInFrames / e.fps).toFixed(2)} s)`);
      }
      console.log(errors.length === 0 ? `validate: ok (${r.issues.length} warning(s))` : `validate: ${errors.length} error(s)`);
      if (errors.length > 0) process.exitCode = 1;
    });

  program
    .command("preview")
    .description("render stills at the key instants of the EDL into out/preview/")
    .argument("<slug>", "project identifier")
    .option("--browser-executable <path>", BROWSER_HELP)
    .option("--at <seconds...>", "extra instants, seconds of output")
    .option("--edl <file>", EDL_HELP)
    .action(async (slug: string, opts: { browserExecutable?: string; at?: string[]; edl?: string }) => {
      const paths = await requireProject(PROJECTS_ROOT, slug);
      const r = await preview(paths, edlTarget(paths, opts.edl), { ...(opts.browserExecutable ? { browserExecutable: opts.browserExecutable } : {}), at: (opts.at ?? []).map(Number) }, (m) => console.log(m));
      console.log(`preview: ${r.rendered.length} still(s) rendered, ${r.skipped.length} up to date in ${path.relative(REPO_ROOT, r.dir)}/`);
    });

  program
    .command("render")
    .description("render the Reel to out/<slug>.mp4 (voice normalized to the EDL's loudness target)")
    .argument("<slug>", "project identifier")
    .option("--browser-executable <path>", BROWSER_HELP)
    .option("--concurrency <n>", "frames rendered in parallel (default: half the CPU cores)")
    .option("--edl <file>", EDL_HELP)
    .action(async (slug: string, opts: { browserExecutable?: string; concurrency?: string; edl?: string }) => {
      const paths = await requireProject(PROJECTS_ROOT, slug);
      const r = await render(
        paths,
        edlTarget(paths, opts.edl),
        { ...(opts.browserExecutable ? { browserExecutable: opts.browserExecutable } : {}), ...(opts.concurrency ? { concurrency: Number(opts.concurrency) } : {}) },
        (m) => console.log(m),
      );
      console.log(`render: ${path.relative(REPO_ROOT, r.output)} (${r.frames} frames, ${r.seconds.toFixed(2)} s)`);
    });
}
