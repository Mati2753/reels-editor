import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { run } from "./util/exec";
import { exists, fingerprint, StepState, writeJsonIfChanged } from "./util/state";
import { PipelineError, readJson, type ProjectPaths } from "./project";
import { ProbeSchema, type Transcript, type Word } from "./schemas";
import { mergeEngineWords } from "./words";
import type { StepLog } from "./ingest";

/** Bump when the engine call or the word merging changes. */
const TRANSCRIBE_VERSION = 1;

const WHISPER_SCRIPT = fileURLToPath(new URL("./whisper.py", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Whisper tends to clean up speech ("euh" disappears). A prompt written in the spoken
 * style makes it keep hesitations, which analyze then reports as fillers.
 */
const DEFAULT_PROMPTS: Record<string, string> = {
  fr: "Euh, bon, alors, euh... du coup, voilà, ben, hum.",
};

export interface TranscribeOptions {
  model: string;
  language: string;
  beamSize: number;
  device: string;
  computeType: string;
  python: string;
}

export function defaultTranscribeOptions(env: NodeJS.ProcessEnv = process.env): TranscribeOptions {
  return {
    model: env.REELS_WHISPER_MODEL ?? "large-v3-turbo",
    language: env.REELS_LANGUAGE ?? "fr",
    beamSize: 5,
    device: env.REELS_WHISPER_DEVICE ?? "auto",
    computeType: env.REELS_WHISPER_COMPUTE_TYPE ?? "default",
    python: env.REELS_PYTHON ?? "",
  };
}

/** REELS_PYTHON, else the repository's .venv, else python3 on PATH. */
async function findPython(configured: string): Promise<string> {
  if (configured) return configured;
  for (const candidate of [path.join(REPO_ROOT, ".venv", "bin", "python"), path.join(REPO_ROOT, ".venv", "Scripts", "python.exe")]) {
    if (await exists(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

/** Optional `projects/<slug>/glossary.txt`: one proper noun or term per line, passed to Whisper. */
async function readGlossary(projectDir: string): Promise<string[]> {
  try {
    const text = await readFile(path.join(projectDir, "glossary.txt"), "utf8");
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function buildPrompt(language: string, glossary: readonly string[]): string {
  const parts = [DEFAULT_PROMPTS[language] ?? ""];
  if (glossary.length > 0) parts.push(glossary.join(", ") + ".");
  return parts.filter((p) => p !== "").join(" ");
}

const EngineOutputSchema = z.object({
  engine: z.string(),
  engineVersion: z.string(),
  model: z.string(),
  language: z.string(),
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number(), probability: z.number() })),
});
type EngineOutput = z.infer<typeof EngineOutputSchema>;

/**
 * `reels transcribe <slug>`: work/<clip>/audio.wav ──► work/<clip>/whisper.json (raw engine
 * output, cached) ──► work/transcript.json. A clip is re-transcribed only when its audio,
 * the model, the language or the prompt changed.
 */
export async function transcribe(paths: ProjectPaths, options: TranscribeOptions, log: StepLog): Promise<{ processed: string[]; skipped: string[] }> {
  const probe = await readJson(paths.probe, ProbeSchema, `run "reels ingest ${paths.slug}" first.`);
  const state = await StepState.load(paths.work, "transcribe");
  const prompt = buildPrompt(options.language, await readGlossary(paths.dir));
  const processed: string[] = [];
  const skipped: string[] = [];
  const outputs: { clip: string; output: EngineOutput }[] = [];
  let python: string | null = null;

  for (const clip of probe.clips) {
    const wav = path.join(paths.work, clip.normalized.audio);
    const cache = path.join(paths.work, clip.id, "whisper.json");
    const key = fingerprint(TRANSCRIBE_VERSION, await state.hashFile(wav), options.model, options.language, prompt, options.beamSize, options.computeType);
    if (state.get(`clip:${clip.id}`) === key && (await exists(cache))) {
      outputs.push({ clip: clip.id, output: EngineOutputSchema.parse(JSON.parse(await readFile(cache, "utf8"))) });
      skipped.push(clip.id);
      log(`${clip.id}: up to date`);
      continue;
    }
    python ??= await findPython(options.python);
    log(`${clip.id}: transcribing with ${options.model} (${options.language})...`);
    const args = [WHISPER_SCRIPT, wav, "--model", options.model, "--language", options.language, "--beam-size", String(options.beamSize), "--device", options.device, "--compute-type", options.computeType];
    if (prompt) args.push("--prompt", prompt);
    let stdout: string;
    try {
      ({ stdout } = await run(python, args));
    } catch (error) {
      throw new PipelineError(
        `Transcription of ${clip.id} failed with ${python}. Install the engine with ` +
          `"python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" (see docs/ARCHITECTURE.md).\n` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
    const output = EngineOutputSchema.parse(JSON.parse(stdout));
    await writeJsonIfChanged(cache, output);
    state.set(`clip:${clip.id}`, key);
    outputs.push({ clip: clip.id, output });
    processed.push(clip.id);
    log(`${clip.id}: ${output.words.length} words`);
  }

  // Ids are numbered across clips in clip order; they only change if a transcription does.
  const words: Word[] = [];
  for (const { clip, output } of outputs) {
    for (const w of mergeEngineWords(output.words)) {
      words.push({ id: `w${words.length + 1}`, clip, ...w });
    }
  }
  const first = outputs[0]?.output;
  const transcript: Transcript = {
    language: options.language,
    engine: { name: first ? `${first.engine} ${first.engineVersion}` : "faster-whisper", model: options.model },
    words,
  };
  if (await writeJsonIfChanged(paths.transcript, transcript)) {
    log(`transcript.json: ${words.length} words`);
  }
  for (const key of state.keys()) {
    if (key.startsWith("clip:") && !probe.clips.some((c) => `clip:${c.id}` === key)) state.delete(key);
  }
  await state.save();
  return { processed, skipped };
}
