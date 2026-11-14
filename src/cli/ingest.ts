import type { Command } from "commander";
import { ingest } from "../pipeline/ingest";
import { requireProject } from "../pipeline/project";
import { PROJECTS_ROOT } from "./paths";

export function registerIngest(program: Command): void {
  program
    .command("ingest")
    .description("normalize raw/* to 30 fps CFR H.264 + 48 kHz audio, extract audio.wav, write work/probe.json")
    .argument("<slug>", "project identifier")
    .action(async (slug: string) => {
      const paths = await requireProject(PROJECTS_ROOT, slug);
      const { processed, skipped } = await ingest(paths, (m) => console.log(m));
      console.log(processed.length === 0 ? `ingest: nothing to do (${skipped.length} clip(s) up to date)` : `ingest: ${processed.length} clip(s) normalized, ${skipped.length} up to date`);
    });
}
