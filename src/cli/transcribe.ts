import type { Command } from "commander";
import { requireProject } from "../pipeline/project";
import { defaultTranscribeOptions, transcribe } from "../pipeline/transcribe";
import { PROJECTS_ROOT } from "./paths";

export function registerTranscribe(program: Command): void {
  const defaults = defaultTranscribeOptions();
  program
    .command("transcribe")
    .description("word-level transcription of every clip (faster-whisper) into work/transcript.json")
    .argument("<slug>", "project identifier")
    .option("-m, --model <name>", "Whisper model: tiny, base, small, medium, large-v3, large-v3-turbo... (env REELS_WHISPER_MODEL)", defaults.model)
    .option("-l, --language <code>", "spoken language (env REELS_LANGUAGE)", defaults.language)
    .option("--beam-size <n>", "beam search width", String(defaults.beamSize))
    .option("--device <device>", "cpu, cuda or auto (env REELS_WHISPER_DEVICE)", defaults.device)
    .option("--compute-type <type>", "int8, float16, default... (env REELS_WHISPER_COMPUTE_TYPE)", defaults.computeType)
    .option("--python <path>", "Python with faster-whisper installed (env REELS_PYTHON; default .venv, then python3)", defaults.python)
    .action(async (slug: string, opts: { model: string; language: string; beamSize: string; device: string; computeType: string; python: string }) => {
      const paths = await requireProject(PROJECTS_ROOT, slug);
      const { processed, skipped } = await transcribe(
        paths,
        { model: opts.model, language: opts.language, beamSize: Number(opts.beamSize), device: opts.device, computeType: opts.computeType, python: opts.python },
        (m) => console.log(m),
      );
      console.log(processed.length === 0 ? `transcribe: nothing to do (${skipped.length} clip(s) up to date)` : `transcribe: ${processed.length} clip(s) transcribed, ${skipped.length} up to date`);
    });
}
