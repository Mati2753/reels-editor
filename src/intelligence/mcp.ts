import path from "node:path";
import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { searchAssets, AssetSearchSchema } from "./assets";
import { analyzeReferenceFile } from "./native-reference";
import { inspectVisualAssets, VisualAssetOptionsSchema } from "./visual-assets";
import { RenderQualityInputSchema, assessRender } from "./quality";
import { exportOpenTimelineIO, PortableCutSchema } from "./timeline";
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
async function mediaFile(name: string) {
  const base = await realpath(root),
    file = await realpath(path.resolve(base, name)),
    rel = path.relative(base, file);
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
    throw Error("Choose media inside the projects folder.");
  return file;
}
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
  if (process.env.REELFORGE_ELEVENLABS_MAX_CREDITS && process.env.ELEVENLABS_API_KEY)
    tool(
      "generate_voiceover",
      "Generate speech under the operator's enabled credit ceiling and explicit request budget.",
      VoiceoverInput,
      (d) => synthesizeVoiceover(d),
    );
  return server;
});
