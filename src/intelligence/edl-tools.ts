import { z } from "zod";
import {
  EdlSchema,
  ClipSegmentSchema,
  FramingSchema,
  TransitionSchema,
  OverlaySchema,
  CaptionConfigSchema,
  AudioConfigSchema,
} from "../edl/schema";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { projectFile } from "./project-media";
import { projectPaths } from "../pipeline/project";
import { writeJsonIfChanged } from "../pipeline/util/state";
import { edlTarget } from "../render/project";
import { render } from "../render/render";

const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace-clip"), segment: ClipSegmentSchema }),
  z.object({ op: z.literal("animate-camera"), scene: z.string(), framing: FramingSchema }),
  z.object({ op: z.literal("set-transition"), transition: TransitionSchema }),
  z.object({ op: z.literal("set-overlay"), overlay: OverlaySchema }),
  z.object({ op: z.literal("set-captions"), captions: CaptionConfigSchema }),
  z.object({ op: z.literal("mix-audio"), audio: AudioConfigSchema }),
]);
export const DirectTimelineSchema = z.object({ timeline: EdlSchema, operations: z.array(operation).min(1).max(120) });
export function directTimeline(input: z.input<typeof DirectTimelineSchema>) {
  const { timeline, operations } = DirectTimelineSchema.parse(input);
  for (const action of operations) {
    switch (action.op) {
      case "replace-clip":
      case "animate-camera": {
        const id = action.op === "replace-clip" ? action.segment.id : action.scene;
        const idx = timeline.segments.findIndex((s) => s.id === id && s.type === "clip");
        const seg = timeline.segments[idx];
        if (!seg || seg.type !== "clip") throw Error("Choose a clip scene in this timeline.");
        if (action.op === "replace-clip" && action.segment.out <= action.segment.in)
          throw Error("The source range is empty.");
        timeline.segments[idx] = action.op === "replace-clip" ? action.segment : { ...seg, framing: action.framing };
        break;
      }
      case "set-transition": {
        const [from, to] = action.transition.between;
        if (!timeline.segments.some((s, i) => s.id === from && timeline.segments[i + 1]?.id === to))
          throw Error("Choose two adjacent scenes.");
        timeline.transitions = timeline.transitions.filter((t) => t.between[0] !== from);
        timeline.transitions.push(action.transition);
        break;
      }
      case "set-overlay": {
        const overlay = action.overlay;
        if (
          "segment" in overlay.at &&
          !timeline.segments.some((s) => s.id === ("segment" in overlay.at ? overlay.at.segment : null))
        )
          throw Error("Unknown graphic anchor.");
        timeline.overlays = timeline.overlays.filter((o) => o.id !== overlay.id);
        timeline.overlays.push(overlay);
        break;
      }
      case "set-captions":
        timeline.captions = action.captions;
        break;
      case "mix-audio":
        timeline.audio = action.audio;
        break;
    }
  }
  return EdlSchema.parse(timeline);
}
export const RenderTimelineSchema = z.object({
  project: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/),
  timeline: EdlSchema,
});
const result = z.object({
  file: z.string(),
  edl: z.string(),
  frames: z.int().positive(),
  seconds: z.number().positive(),
});
export async function renderTimeline(root: string, input: z.input<typeof RenderTimelineSchema>) {
  const { project, timeline } = RenderTimelineSchema.parse(input);
  const folder = await projectFile(root, project);
  const paths = projectPaths(path.dirname(folder), path.basename(folder));
  const out = path.join(folder, "variants");
  await mkdir(out, { recursive: true });
  await projectFile(folder, "variants");
  const job = await mkdtemp(path.join(out, "edit-"));
  try {
    const target = edlTarget(paths, path.join(job, "timeline.edl.json"));
    await writeJsonIfChanged(target.file, timeline);
    const staged = { ...paths, out: job, renderWorkspace: path.join(job, "cache") };
    const report = await render(staged, target, { concurrency: 2 }, () => {});
    return result.parse({
      file: path.relative(root, report.output),
      edl: path.relative(root, target.file),
      frames: report.frames,
      seconds: report.seconds,
    });
  } catch (error) {
    await rm(job, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(path.join(job, "cache"), { recursive: true, force: true });
  }
}
