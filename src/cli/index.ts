import { Command } from "commander";
import path from "node:path";
import { createProject, ProjectError } from "./new";
import { registerIngest } from "./ingest";
import { registerTranscribe } from "./transcribe";
import { registerAnalyze } from "./analyze";
import { CommandError } from "../pipeline/util/exec";
import { PipelineError } from "../pipeline/project";
import { PROJECTS_ROOT, REPO_ROOT } from "./paths";

const program = new Command();

program.name("reels").description("Reels Editor pipeline commands");

program
  .command("new")
  .description("create projects/<slug>/ with raw/, work/ and out/")
  .argument("<slug>", "project identifier: lowercase letters, digits and hyphens")
  .action(async (slug: string) => {
    const dir = await createProject(slug, PROJECTS_ROOT);
    console.log(`Created ${path.relative(REPO_ROOT, dir)}/ (raw/, work/, out/)`);
  });

registerIngest(program);
registerTranscribe(program);
registerAnalyze(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof ProjectError || error instanceof PipelineError || error instanceof CommandError) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
