import type { Command } from "commander";
import { analyze, DEFAULT_ANALYZE } from "../pipeline/analyze";
import { requireProject } from "../pipeline/project";
import { PROJECTS_ROOT } from "./paths";

export function registerAnalyze(program: Command): void {
  const d = DEFAULT_ANALYZE;
  program
    .command("analyze")
    .description("measure silences, shots, loudness, fillers, retakes, sentences and key frames into work/analysis.json")
    .argument("<slug>", "project identifier")
    .option("--min-silence <s>", "shortest silence reported, seconds", String(d.minSilence))
    .option("--silence-db <dBFS>", "force the silence threshold instead of measuring it per clip")
    .option("--scene-threshold <0-100>", "scdet scene-change threshold", String(d.sceneThreshold))
    .action(async (slug: string, opts: { minSilence: string; silenceDb?: string; sceneThreshold: string }) => {
      const paths = await requireProject(PROJECTS_ROOT, slug);
      const { upToDate } = await analyze(
        paths,
        { ...d, minSilence: Number(opts.minSilence), silenceDb: opts.silenceDb === undefined ? null : Number(opts.silenceDb), sceneThreshold: Number(opts.sceneThreshold) },
        (m) => console.log(m),
      );
      if (upToDate) console.log("analyze: nothing to do");
    });
}
