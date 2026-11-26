import { AssetSearchSchema, searchAssets } from "../intelligence/assets";
import { RenderQualityInputSchema, assessRender } from "../intelligence/quality";
import { PortableCutSchema, exportOpenTimelineIO } from "../intelligence/timeline";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { z } from "zod";
import { REPO_ROOT, PROJECTS_ROOT } from "../cli/paths";
import { createProject, isValidSlug } from "../cli/new";
import { projectPaths, VIDEO_EXTENSIONS, type ProjectPaths } from "../pipeline/project";
import { ffmpeg } from "../pipeline/util/exec";
import { exists, writeJsonIfChanged } from "../pipeline/util/state";
import { body, json, acceptUpload, serveFile, HttpError } from "./http";
import { FormatSchema, inspectVideo, learnFormat, presets } from "./formats";
import { MIN_DURATION } from "../edl/validate";
import { SettingsSchema } from "./director";
import { waveform } from "./waveform";
import { importSrt } from "./subtitles";
import { startEdit, jobs, projectJob, readProject } from "./jobs";
import { sample, type Project } from "./model";

const root = process.env.REELS_PROJECTS_ROOT ?? PROJECTS_ROOT;
const host = process.env.REELS_HOST ?? "127.0.0.1";
const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const library = path.join(root, ".formats");
const assets = path.join(REPO_ROOT, "assets", "studio");
const ui = path.join(REPO_ROOT, "src", "studio", "ui");
const bundle = await build({
  entryPoints: [path.join(ui, "main.tsx")],
  bundle: true,
  minify: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
await mkdir(library, { recursive: true });

async function formats() {
  const folders = (await readdir(library)).filter((v) => /^ref-[a-f0-9-]+$/.test(v));
  const learned = await Promise.all(
    folders.map(async (id) =>
      FormatSchema.parse(JSON.parse(await readFile(path.join(library, id, "format.json"), "utf8"))),
    ),
  );
  return [...presets, ...learned.sort((a, b) => a.name.localeCompare(b.name))];
}

async function prepareSource(paths: ProjectPaths, file: string, duration: number, hasAudio: boolean) {
  const preview = path.join(paths.work, "preview.mp4");
  await ffmpeg([
    "-i",
    file,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "25",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    preview,
  ]);
  if (hasAudio) await waveform(preview, path.join(paths.work, "wave.png"));
  await ffmpeg([
    "-ss",
    String(Math.min(0.3, duration / 2)),
    "-i",
    preview,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    path.join(paths.work, "poster.jpg"),
  ]);
  await ffmpeg([
    "-i",
    preview,
    "-vf",
    `fps=8/${duration.toFixed(4)},scale=96:72:force_original_aspect_ratio=increase,crop=96:72,tile=8x1`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    path.join(paths.work, "strip.jpg"),
  ]);
}

function displayName(filename: string): string {
  return path.parse(filename).name.replace(/[-_]+/g, " ").trim().slice(0, 80) || "Untitled reel";
}

function uploadName(header: string | string[] | undefined) {
  const name = path.basename(decodeURIComponent(String(header ?? "footage.mp4")).replaceAll("\\", "/")).slice(-180);
  if (!VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    throw new HttpError(400, "Choose an MP4, MOV, MKV, WebM or other supported video.");
  return name;
}

function makeId(title: string) {
  const name = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 44)
    .replace(/^-+|-+$/g, "");
  return (name || "reel") + "-" + randomUUID().slice(0, 8);
}

const subtitleWrites = new Set<string>();
const example = { ...sample, edit: JSON.parse(await readFile(path.join(assets, "sample-cut.json"), "utf8")) };

const server = createServer(async (req, res) => {
  try {
    if (loopback.has(host) && !loopback.has(new URL("http://" + req.headers.host).hostname)) {
      throw new HttpError(403, "Open the editor on localhost.");
    }
    const url = new URL(req.url ?? "/", "http://studio.local");
    const route = url.pathname;
    const method = req.method ?? "GET";
    const reading = method === "GET" || method === "HEAD";
    if (!reading) {
      if (method !== "POST") throw new HttpError(405, "Unsupported request.");
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host)
        throw new HttpError(403, "Open the editor to change this workspace.");
      if (req.headers["x-cutroom"] !== "studio") throw new HttpError(403, "This request must come from the editor.");
    }
    if (reading && route==="/api/tools/assets") return json(res,searchAssets(AssetSearchSchema.parse({query:url.searchParams.get("q")??""})));
    if (method==="POST" && route==="/api/tools/check-render") return json(res,assessRender(RenderQualityInputSchema.parse(JSON.parse(await body(req,2_000_000)))));
    if (method==="POST" && route==="/api/tools/export-otio") return json(res,exportOpenTimelineIO(PortableCutSchema.parse(JSON.parse(await body(req,4_000_000)))));
    const evidenceRoute=/^\/formats\/(ref-[a-f0-9-]+)\/evidence\.json$/.exec(route);
    if(reading && evidenceRoute)return await serveFile(req,res,path.join(library,evidenceRoute[1]!,"evidence.json"),"reference-evidence.json");
    if (reading && route === "/api/projects/sample/edl")
      return await serveFile(req, res, path.join(assets, "sample.edl.json"), "alpine-field-notes.edl.json");
    if (reading && route === "/") return await serveFile(req, res, path.join(ui, "index.html"));
    if (reading && route === "/studio.css") return await serveFile(req, res, path.join(ui, "studio.css"));
    if (reading && route === "/studio.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundle.outputFiles[0]!.contents);
      return;
    }
    if (
      reading &&
      /^\/assets\/(?:poster\.jpg|strip\.jpg|wave\.png|alpine\.jpg|forest\.jpg|lake\.jpg|alpine-field-notes\.mp4|sample-cut\.(?:png|mp4)|sample-cover\.jpg|dm-sans\.woff2)$/.test(
        route,
      )
    )
      return await serveFile(
        req,
        res,
        path.join(assets, path.basename(route)),
        url.searchParams.has("download") ? "alpine-field-notes.mp4" : undefined,
      );
    const image = /^\/formats\/(ref-[a-f0-9-]+)\/poster\.jpg$/.exec(route);
    if (reading && image) return await serveFile(req, res, path.join(library, image[1]!, "poster.jpg"));
    if (reading && route === "/api/library") {
      const dirs = (await readdir(root, { withFileTypes: true })).filter((f) => f.isDirectory() && isValidSlug(f.name));
      const entries = await Promise.all(
        dirs.map(async (f) => {
          const paths = projectPaths(root, f.name);
          if (!(await exists(path.join(paths.dir, "studio.json")))) return null;
          return readProject(paths);
        }),
      );
      return json(res, {
        example,
        formats: await formats(),
        projects: entries.filter((p) => p !== null).sort((a, b) => b.created.localeCompare(a.created)),
      });
    }
    if (method === "POST" && route === "/api/formats") {
      const name = uploadName(req.headers["x-filename"]);
      const label =
        decodeURIComponent(String(req.headers["x-format-name"] ?? ""))
          .trim()
          .slice(0, 60) || displayName(name);
      const temp = await mkdtemp(path.join(library, ".learning-"));
      try {
        const video = path.join(temp, "reference" + path.extname(name));
        await acceptUpload(req, video);
        const id = `ref-${randomUUID()}`;
        const format = await learnFormat(video, id, label, temp);
        await ffmpeg([
          "-ss",
          String(Math.min(0.4, format.reference!.duration / 2)),
          "-i",
          video,
          "-vf",
          "scale=480:270:force_original_aspect_ratio=increase,crop=480:270",
          "-frames:v",
          "1",
          path.join(temp, "poster.jpg"),
        ]);
        await rm(video);
        await writeJsonIfChanged(path.join(temp, "format.json"), format);
        await rename(temp, path.join(library, id));
        return json(res, format, 201);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (method === "POST" && (route === "/api/projects" || route === "/api/sample")) {
      const demo = route === "/api/sample";
      const filename = demo ? sample.filename : uploadName(req.headers["x-filename"]);
      const title = demo ? sample.title : displayName(filename);
      const id = makeId(title);
      await createProject(id, root);
      const paths = projectPaths(root, id);
      try {
        const file = path.join(paths.raw, "source" + path.extname(filename).toLowerCase());
        if (demo) await copyFile(path.join(assets, sample.filename), file);
        else await acceptUpload(req, file);
        const meta = await inspectVideo(file);
        if (meta.duration < MIN_DURATION - 0.012)
          throw new HttpError(400, "Choose footage at least five seconds long.");
        const project: Project = {
          id,
          title,
          filename,
          seconds: meta.duration,
          hasAudio: meta.hasAudio,
          created: new Date().toISOString(),
        };
        if (demo) {
          await copyFile(file, path.join(paths.work, "preview.mp4"));
          for (const asset of ["poster.jpg", "strip.jpg", "wave.png"])
            await copyFile(path.join(assets, asset), path.join(paths.work, asset));
          await copyFile(path.join(assets, "sample-transcript.json"), path.join(paths.dir, "supplied-transcript.json"));
        } else await prepareSource(paths, file, meta.duration, meta.hasAudio);
        await writeJsonIfChanged(path.join(paths.dir, "studio.json"), project);
        return json(res, project, 201);
      } catch (error) {
        await rm(paths.dir, { recursive: true, force: true });
        throw error;
      }
    }
    const media =
      /^\/media\/([a-z0-9-]+)\/(source\.mp4|poster\.jpg|strip\.jpg|wave\.png|cut-[a-f0-9-]+\.(?:mp4|png))$/.exec(route);
    if (reading && media && isValidSlug(media[1]!)) {
      const paths = projectPaths(root, media[1]!);
      const target = media[2]!;
      const file = target.startsWith("cut-")
        ? path.join(paths.out, target)
        : path.join(paths.work, target === "source.mp4" ? "preview.mp4" : target);
      return await serveFile(req, res, file, url.searchParams.has("download") ? paths.slug + ".mp4" : undefined);
    }
    const match = /^\/api\/projects\/([a-z0-9-]+)(?:\/(generate|subtitles|edl))?$/.exec(route);
    if (!match || !isValidSlug(match[1]!)) throw new HttpError(404, "Page not found.");
    const paths = projectPaths(root, match[1]!);
    const project = await readProject(paths);
    const action = match[2];
    if (reading && !action) return json(res, { project, job: await projectJob(paths, project) });
    if (reading && action === "edl" && project.edit)
      return await serveFile(
        req,
        res,
        path.join(paths.work, "edits", project.edit.id + ".edl.json"),
        paths.slug + ".edl.json",
      );
    if (method === "POST" && action === "generate") {
      const settings = SettingsSchema.parse(JSON.parse(await body(req)));
      const format = (await formats()).find((f) => f.id === settings.format);
      if (!format) throw new HttpError(400, "Select an existing format.");
      if (subtitleWrites.has(paths.slug) || jobs.get(paths.slug)?.state === "working")
        throw new HttpError(409, "This project is already rendering.");
      await startEdit(paths, project, format, settings);
      return json(res, { job: jobs.get(paths.slug) }, 202);
    }
    if (method === "POST" && action === "subtitles") {
      const transcript = importSrt(await body(req, 2_000_000), project.seconds);
      if (subtitleWrites.has(paths.slug) || jobs.get(paths.slug)?.state === "working")
        throw new HttpError(409, "Wait until the current edit finishes.");
      subtitleWrites.add(paths.slug);
      try {
        const updated = {
          ...(await readProject(paths)),
          subtitleFile: path
            .basename(decodeURIComponent(String(req.headers["x-filename"] ?? "captions.srt")))
            .slice(-120),
        };
        await writeJsonIfChanged(path.join(paths.dir, "supplied-transcript.json"), transcript);
        await writeJsonIfChanged(path.join(paths.dir, "studio.json"), updated);
        return json(res, updated);
      } finally {
        subtitleWrites.delete(paths.slug);
      }
    }
    throw new HttpError(404, "Page not found.");
  } catch (e) {
    if (res.headersSent || res.destroyed) return;
    const missing = e instanceof Error && "code" in e && e.code === "ENOENT";
    const status = e instanceof HttpError ? e.status : missing ? 404 : 400;
    const message = missing
      ? "File not found."
      : e instanceof z.ZodError
        ? "Invalid edit settings."
        : e instanceof Error
          ? e.message
          : "The request failed.";
    json(res, { error: message.slice(0, 900) }, status);
  }
});
server.requestTimeout = 0;
const port = Number(process.env.PORT ?? 4173);
async function recoverEdits() {
  const entries=await readdir(root,{withFileTypes:true}).catch(()=>[]);
  for(const entry of entries){
    if(!entry.isDirectory() || !isValidSlug(entry.name))continue;
    const paths=projectPaths(root,entry.name);
    try{await projectJob(paths,await readProject(paths));}catch(e){console.error("Recovery failed for "+entry.name,String(e));}
  }
}
server.listen(port,host,()=>{console.log(`Cutroom is listening on http://${host}:${port}`);void recoverEdits();});
