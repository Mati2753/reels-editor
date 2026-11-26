import { IllustrationInput, planIllustration } from "./illustration";
import { GenerateBrollSchema, GenerationStatusSchema, generateBroll, generationStatus } from "./generation";
import { DirectTimelineSchema, RenderTimelineSchema, directTimeline, renderTimeline } from "./edl-tools";
import { PortraitToolInput, generatePortrait } from "./portrait-tool";
import path from "node:path";
import { projectFile, projectMedia, MediaOperationSchema } from "./project-media";
import { recallFeedback, FeedbackSchema } from "./feedback";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { searchAssets, AssetSearchSchema } from "./assets";
import { analyzeReferenceFile } from "./native-reference";
import { inspectVisualAssets, VisualAssetOptionsSchema } from "./visual-assets";
import { RenderQualityInputSchema, assessRender } from "./quality";
import { exportOpenTimelineIO, PortableCutSchema, revisePortableCut, SceneRevisionSchema } from "./timeline";
import {
  PexelsSearchInput,
  FreesoundSearchInput,
  VoiceoverInput,
  searchPexels,
  searchFreesound,
  synthesizeVoiceover,
} from "./providers";
import { makeStyle, reviseStyle } from "./styles";
import { StyleSourceSchema, PreferencesSchema } from "./style-model";
import { FormatSchema } from "../studio/format-model";

const root = path.resolve(process.env.REELS_PROJECTS_ROOT ?? "projects");
const mediaFile = (name: string) => projectFile(root, name);
serveStdio(() => {
  const server = new McpServer({ name: "reelforge-director", version: "1.0.0" });
  function tool<T extends z.ZodObject>(
    name: string,
    description: string,
    inputSchema: T,
    call: (data: z.output<T>) => unknown,
  ) {
    server.registerTool(name, { description, inputSchema: inputSchema.shape }, async (raw) => {
      const result = await call(inputSchema.parse(raw));
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    });
  }
  tool(
    "generate_portrait_mask",
    "Estimate a portrait matte, export the grayscale mask and replace the background using a local CPU model.",
    PortraitToolInput,
    (d) => generatePortrait(root, d),
  );
  tool(
    "direct_timeline",
    "Replace clips or set camera, text, graphics, transitions, captions and sound on a new edit decision list.",
    DirectTimelineSchema,
    directTimeline,
  );
  tool(
    "render_timeline",
    "Validate and render a new, isolated native timeline for an analyzed project.",
    RenderTimelineSchema,
    (d) => renderTimeline(root, d),
  );
  tool(
    "plan_illustration",
    "Generate a proportional graphic plan for a literal percentage when stock is unavailable.",
    IllustrationInput,
    planIllustration,
  );
  tool("search_assets", "Find compatible licensed assets with a documented matching reason.", AssetSearchSchema, (d) =>
    searchAssets(d),
  );
  tool(
    "analyze_reference",
    "Measure native frames and audio from a project-owned reference file.",
    z.object({ file: z.string(), name: z.string() }),
    async (d) => analyzeReferenceFile(await mediaFile(d.file), "ref-" + randomUUID(), d.name),
  );
  tool(
    "inspect_visual_assets",
    "Read visible subtitle geometry and optional local model observations.",
    z.object({ file: z.string(), options: VisualAssetOptionsSchema }),
    async (d) => inspectVisualAssets(await mediaFile(d.file), d.options, root),
  );
  tool(
    "combine_references",
    "Build an adaptive template from measured reference cards.",
    z.object({ references: z.array(StyleSourceSchema).min(1), name: z.string() }),
    (d) => makeStyle(d.references, "ref-" + randomUUID(), d.name, "./assets/forest.jpg"),
  );
  tool(
    "revise_style",
    "Create a new style revision from editorial feedback.",
    z.object({ format: FormatSchema, preferences: PreferencesSchema, reason: z.string().min(1) }),
    (d) => reviseStyle(d.format, d.preferences, "ref-" + randomUUID(), d.reason),
  );
  tool(
    "revise_timeline",
    "Apply frame-accurate scene trims and removals to a new timeline revision.",
    z.object({ cut: PortableCutSchema, changes: z.array(SceneRevisionSchema).min(1) }),
    (d) => revisePortableCut(d.cut, d.changes),
  );
  tool(
    "process_project_media",
    "Extract a PNG frame, trim, reframe, grade with a project LUT, or apply a catalog LUT, texture, crystal or glint over a chosen interval.",
    z.object({ file: z.string().min(1), action: MediaOperationSchema }),
    (d) => projectMedia(root, d.file, d.action),
  );
  tool(
    "recall_edit_feedback",
    "Retrieve applicable director feedback by template family and presence of speech.",
    z.object({ format: FormatSchema, hasSpeech: z.boolean(), history: FeedbackSchema }),
    (d) => recallFeedback(d.history, d.format, d.hasSpeech),
  );
  tool(
    "export_otio",
    "Export frame-aligned editorial source ranges and metadata.",
    z.object({ cut: PortableCutSchema }),
    (d) => exportOpenTimelineIO(d.cut),
  );
  tool("check_render", "Evaluate independently measured render evidence.", RenderQualityInputSchema, (d) =>
    assessRender(d),
  );
  tool(
    "search_pexels",
    "Search licensed external stock with the operator's configured account.",
    PexelsSearchInput,
    (d) => searchPexels(d),
  );
  tool("search_freesound", "Search sound metadata under the configured license policy.", FreesoundSearchInput, (d) =>
    searchFreesound(d),
  );
  if (process.env.REELFORGE_COMFY_CHECKPOINT && process.env.REELFORGE_COMFY_PORT) {
    const cfg = {
      root,
      checkpoint: process.env.REELFORGE_COMFY_CHECKPOINT,
      port: Number(process.env.REELFORGE_COMFY_PORT),
    };
    tool(
      "generate_broll",
      "Use matching licensed stock or submit a seeded image to the operator’s authorized local ComfyUI worker.",
      GenerateBrollSchema,
      (d) => generateBroll(d, cfg),
    );
    tool(
      "generation_status",
      "Resume a local generation and collect its image inside the project.",
      GenerationStatusSchema,
      (d) => generationStatus(d, cfg),
    );
  }
  if (process.env.REELFORGE_ELEVENLABS_MAX_CREDITS && process.env.ELEVENLABS_API_KEY)
    tool(
      "generate_voiceover",
      "Generate speech under the operator's enabled credit ceiling and explicit request budget.",
      VoiceoverInput,
      (d) => synthesizeVoiceover(d),
    );
  return server;
});
