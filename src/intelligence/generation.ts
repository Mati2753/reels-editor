import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { selectBroll } from "./assets";
import { projectFile } from "./project-media";
import { randomUUID } from "node:crypto";

const phrase = z.object({
  text: z.string().min(1).max(2000),
  start: z.number().nonnegative(),
  end: z.number().positive(),
});
export const GenerateBrollSchema = z.object({
  requestId: z.uuid(),
  phrase,
  prompt: z.string().min(3).max(900),
  seed: z.int().nonnegative().max(2147483647),
  authorized: z.literal(true),
});
export const GenerationStatusSchema = z.object({ requestId: z.uuid() });
const receipt = z.object({
  state: z.enum(["catalog", "submitted", "waiting", "unknown", "failed", "ready"]),
  requestId: z.uuid(),
  file: z.string().optional(),
  reason: z.string().optional(),
  assetId: z.string().optional(),
  provider: z.literal("local-comfyui"),
});
type Config = { root: string; checkpoint: string; port: number; fetch?: typeof fetch };
const make = (id: string, state: z.infer<typeof receipt>["state"], extra: Partial<z.infer<typeof receipt>> = {}) =>
  receipt.parse({ provider: "local-comfyui", requestId: id, state, ...extra });
async function api(cfg: Config, route: string, payload?: unknown) {
  const port = z.int().min(1).max(65535).parse(cfg.port);
  const res = await (cfg.fetch ?? fetch)(new URL(route, "http://127.0.0.1:" + port), {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw Error("Local ComfyUI returned HTTP " + res.status + ".");
  }
  return res;
}
async function jobDir(cfg: Config, id: string) {
  await mkdir(path.join(cfg.root, "generated"), { recursive: true });
  const parent = await projectFile(cfg.root, "generated");
  await mkdir(path.join(parent, "comfy-" + id), { recursive: true });
  return projectFile(cfg.root, path.join("generated", "comfy-" + id));
}
// Publish a complete record once. Concurrent tool processes either publish or read the winner.
async function once(file: string, bytes: string | Buffer) {
  const tmp = file + "." + randomUUID() + ".tmp";
  await writeFile(tmp, bytes, { flag: "wx", mode: 0o600 });
  try {
    await link(tmp, file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    await unlink(tmp);
  }
}
function workflow(checkpoint: string, prompt: string, seed: number, id: string) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "letters, watermark, signature" } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: 768, height: 448, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps: 16,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "reelforge-" + id } },
  };
}
export async function generateBroll(input: z.input<typeof GenerateBrollSchema>, cfg: Config) {
  const data = GenerateBrollSchema.parse(input),
    id = data.requestId.toLowerCase();
  const existing = selectBroll([data.phrase]);
  if (existing) return make(id, "catalog", { assetId: existing.assetId, reason: existing.reason });
  const checkpoint = z
    .string()
    .regex(/^[\w .-]+\.safetensors$/i)
    .parse(cfg.checkpoint);
  const dir = await jobDir(cfg, id),
    record = path.join(dir, "request.json");
  const graph = workflow(checkpoint, data.prompt, data.seed, id);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ graph, phrase: data.phrase }))
    .digest("hex");
  if (
    !(await once(
      record,
      JSON.stringify({ fingerprint, checkpoint, phrase: data.phrase, prompt: data.prompt, seed: data.seed }),
    ))
  ) {
    if (JSON.parse(await readFile(record, "utf8")).fingerprint !== fingerprint)
      throw Error("This ID belongs to a different generation.");
    return generationStatus({ requestId: id }, cfg);
  }
  const reply = await api(cfg, "/prompt", { prompt_id: id, prompt: graph });
  const result = z.object({ prompt_id: z.uuid() }).parse(await reply.json());
  if (result.prompt_id !== id)
    throw Error("ComfyUI must support caller-supplied prompt IDs. Check its queue before retrying.");
  return make(id, "submitted");
}
export async function generationStatus(input: z.input<typeof GenerationStatusSchema>, cfg: Config) {
  const id = GenerationStatusSchema.parse(input).requestId.toLowerCase(),
    dir = await projectFile(cfg.root, path.join("generated", "comfy-" + id));
  await projectFile(dir, "request.json");
  const output = path.join(dir, "broll.png"),
    relative = path.relative(cfg.root, output);
  try {
    await projectFile(dir, "broll.png");
    return make(id, "ready", { file: relative });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const history = (await (await api(cfg, "/history/" + id)).json()) as Record<string, unknown>;
  if (!history[id]) {
    const q = z
      .object({ queue_running: z.array(z.array(z.unknown())), queue_pending: z.array(z.array(z.unknown())) })
      .parse(await (await api(cfg, "/queue")).json());
    return make(id, [...q.queue_running, ...q.queue_pending].some((row) => row[1] === id) ? "waiting" : "unknown");
  }
  const item = z
    .object({ status: z.object({ status_str: z.string() }), outputs: z.record(z.string(), z.unknown()) })
    .parse(history[id]);
  if (item.status.status_str === "error") return make(id, "failed");
  const files = z
    .object({
      images: z
        .array(
          z.object({
            filename: z.string().regex(/^[\w.-]+\.png$/i),
            subfolder: z.literal(""),
            type: z.literal("output"),
          }),
        )
        .min(1),
    })
    .safeParse(item.outputs["7"]);
  if (!files.success) return make(id, "unknown");
  const file = files.data.images[0]!;
  if (!file.filename.startsWith("reelforge-" + id)) throw Error("The result does not belong to this generation.");
  const response = await api(cfg, "/view?" + new URLSearchParams(file));
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty generated image.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 12_000_000) {
        await reader.cancel();
        throw Error("Generated image exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) !== 768 ||
    bytes.readUInt32BE(20) !== 448
  )
    throw Error("Unexpected generated image dimensions or type.");
  await once(output, bytes);
  return make(id, "ready", { file: relative });
}
