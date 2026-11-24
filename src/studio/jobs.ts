import { copyFile, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ingest } from "../pipeline/ingest";
import { transcribe, defaultTranscribeOptions } from "../pipeline/transcribe";
import { analyze, DEFAULT_ANALYZE } from "../pipeline/analyze";
import { readJson, type ProjectPaths } from "../pipeline/project";
import { AnalysisSchema, ProbeSchema, TranscriptSchema } from "../pipeline/schemas";
import { exists, writeJsonIfChanged } from "../pipeline/util/state";
import { edlTarget, formatIssues, validateProject } from "../render/project";
import { render } from "../render/render";
import { buildEdit, findBeats, localSelection, type Settings } from "./director";
import { waveform } from "./waveform";
import { claudeSelection } from "./claude";
import type { Format } from "./formats";
import type { Cut, Job, Project } from "./model";

export const jobs = new Map<string, Job>();

// Encode one project at a time on a local workstation. All queued jobs are visible
// to polling clients, including a second tab opened while the current edit runs.
let queue = Promise.resolve();
export function startEdit(paths: ProjectPaths, format: Format, settings: Settings) {
  jobs.set(paths.slug, { state: "working", step: "Queued for the director" });
  queue = queue
    .then(async () => generate(paths, await readProject(paths), format, settings))
    .catch((error) => {
      jobs.set(paths.slug, { state: "failed", step: String(error) });
    });
}

export async function projectJob(paths: ProjectPaths, project: Project): Promise<Job | null> {
  const live = jobs.get(paths.slug);
  if (live) return live;
  try {
    const marker = JSON.parse(await readFile(path.join(paths.work, "studio-job.json"), "utf8"));
    if (marker.previous === (project.edit?.id ?? null))
      return {
        state: "failed",
        step: marker.error ?? "The last edit was interrupted. Generate it again to resume from the cached analysis.",
      };
  } catch {
    /* A project with no pending edit has no marker. */
  }
  return null;
}

/** A published cut remains playable while its replacement is staged and validated. */
export async function generate(paths: ProjectPaths, project: Project, format: Format, settings: Settings) {
  const update = (step: string, progress?: number) => jobs.set(paths.slug, { state: "working", step, progress });
  const log = (s: string) => console.log(`[${paths.slug}] ${s}`);
  update("Preparing footage");
  const marker = path.join(paths.work, "studio-job.json");
  const previous = project.edit?.id ?? null;
  try {
    await writeJsonIfChanged(marker, { previous });
    await ingest(paths, log);
    const probe = await readJson(paths.probe, ProbeSchema, "Prepare the footage first.");
    update("Reading speech");
    const supplied = path.join(paths.dir, "supplied-transcript.json");
    if (await exists(supplied)) await copyFile(supplied, paths.transcript);
    else if (project.hasAudio && (settings.captions || settings.cuts || settings.director === "claude")) {
      const opt = defaultTranscribeOptions();
      try {
        await transcribe(
          paths,
          {
            ...opt,
            vadFilter: true,
            model: process.env.REELS_WHISPER_MODEL ?? "base",
            language: process.env.REELS_LANGUAGE ?? "auto",
          },
          log,
        );
      } catch (e) {
        log(String(e));
        if (settings.captions || settings.director === "claude") {
          throw new Error(
            "Speech recognition failed. Install the Python requirements and download the Whisper model, attach an SRT file, or turn off subtitles and choose Local director.",
          );
        }
        if (!(await exists(paths.transcript)))
          await writeJsonIfChanged(paths.transcript, {
            language: "und",
            engine: { name: "visual edit", model: "none" },
            words: [],
          });
      }
    } else if (!(await exists(paths.transcript))) {
      await writeJsonIfChanged(paths.transcript, {
        language: "und",
        engine: { name: "visual edit", model: "none" },
        words: [],
      });
    }
    update("Finding shots and pauses");
    await analyze(paths, DEFAULT_ANALYZE, log);
    const facts = await readJson(paths.analysis, AnalysisSchema, "Analyze the source first.");
    const transcript = await readJson(paths.transcript, TranscriptSchema, "Read speech first.");
    update(settings.director === "claude" ? "Directing with Claude Code" : "Choosing cuts and motion");
    const beats = findBeats(probe, facts, format, settings);
    const selection =
      settings.director === "claude" ? await claudeSelection(beats, format, settings) : localSelection(beats, settings);
    const { edl, decisions } = buildEdit(project.title, transcript.language, facts, beats, selection, format, settings);
    const id = `cut-${randomUUID()}`;
    const target = edlTarget(paths, path.join(paths.work, "edits", `${id}.edl.json`));
    await writeJsonIfChanged(target.file, edl);
    const validated = await validateProject(paths, target);
    if (!validated.ok || !validated.resolved)
      throw new Error(
        "The edit could not be validated. " +
          formatIssues(validated.issues.filter((i) => i.severity === "error")).slice(0, 600),
      );
    const resolved = validated.resolved;
    update("Rendering picture and sound", 0);
    await render(paths, target, { concurrency: 2 }, (msg) => {
      log(msg);
      const pct = /\((\d+) %\)/.exec(msg);
      if (pct) update("Rendering picture and sound", Number(pct[1]));
      if (msg.startsWith("normalizing")) update("Finishing the audio mix");
    });
    await waveform(path.join(paths.out, id + ".mp4"), path.join(paths.out, id + ".png"));
    const sec = (frame: number) => frame / resolved.fps;
    const edit: Cut = {
      id,
      seconds: sec(resolved.durationInFrames),
      created: new Date().toISOString(),
      settings,
      decisions,
      segments: resolved.segments.map((s, i) => ({
        start: sec(s.fromFrame),
        end: sec(s.fromFrame + s.durationInFrames),
        source: s.type === "clip" ? sec(s.trimBefore) : 0,
        name: `Shot ${i + 1}`,
      })),
      captions: resolved.captions.pages.map((p) => ({
        start: sec(p.fromFrame),
        end: sec(p.fromFrame + p.durationInFrames),
        text: p.lines
          .flat()
          .map((t) => t.text)
          .join(" "),
      })),
      sounds: resolved.audio.sfx.map((s) => ({ at: sec(s.fromFrame), name: path.parse(s.file).name })),
      music: Boolean(resolved.audio.music),
    };
    const current = path.join(paths.dir, "edl.json");
    await copyFile(target.file, current + ".new");
    await rename(current + ".new", current);
    await writeJsonIfChanged(path.join(paths.dir, "studio.json"), { ...project, edit });
    await rm(marker, { force: true });
    jobs.delete(paths.slug);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    await writeJsonIfChanged(marker, { previous, error: message.slice(0, 850) });
    jobs.set(paths.slug, { state: "failed", step: message.slice(0, 850) });
  }
}

export async function readProject(paths: ProjectPaths): Promise<Project> {
  return JSON.parse(await readFile(path.join(paths.dir, "studio.json"), "utf8")) as Project;
}
