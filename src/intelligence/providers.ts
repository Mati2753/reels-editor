import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

// This module belongs to the local Node/MCP host. Configuration and keys stay off the browser.
export interface ProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  stateDirectory?: string;
}

const searchFields = {
  query: z.string().trim().min(2).max(180),
  limit: z.int().min(1).max(24).default(8),
};
export const PexelsSearchInput = z.strictObject({
  ...searchFields,
  kind: z.enum(["video", "image"]).default("video"),
  orientation: z.enum(["portrait", "landscape", "square"]).optional(),
});
export const FreesoundSearchInput = z.strictObject({
  ...searchFields,
  usage: z.enum(["commercial", "noncommercial"]).default("commercial"),
});
export const VoiceoverInput = z.strictObject({
  requestId: z.uuid(),
  text: z.string().trim().min(1).max(2000),
  voiceId: z
    .string()
    .regex(/^[A-Za-z0-9]{20}$/)
    .default("JBFqnCBsd6RMkjVDRZzb"),
  authorized: z.literal(true),
  maxCredits: z.int().positive().max(10000),
});

const https = z.url({ protocol: /^https$/ });
const licenseSchema = z.object({
  name: z.string(),
  url: https,
  attribution: z.string(),
  requiresAttribution: z.boolean(),
});
export const StockSearchOutput = z.object({
  provider: z.enum(["pexels", "freesound"]),
  query: z.string(),
  results: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["video", "image", "sound"]),
        title: z.string(),
        creator: z.string(),
        sourceUrl: https,
        previewUrl: https.nullable(),
        mediaUrl: https.nullable(),
        license: licenseSchema,
        width: z.int().positive().optional(),
        height: z.int().positive().optional(),
        duration: z.number().nonnegative().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .max(24),
});
type Asset = z.infer<typeof StockSearchOutput>["results"][number];
export const VoiceoverOutput = z.strictObject({
  provider: z.literal("elevenlabs"),
  requestId: z.uuid(),
  model: z.literal("eleven_multilingual_v2"),
  voiceId: z.string(),
  asset: z.string(),
  mimeType: z.literal("audio/mpeg"),
  bytes: z.int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  reservedCredits: z.int().positive(),
});
export type Voiceover = z.infer<typeof VoiceoverOutput>;

function environment(o: ProviderOptions) {
  return o.env ?? process.env;
}
function key(o: ProviderOptions, name: string) {
  const value = environment(o)[name]?.trim();
  if (!value) throw new Error(name + " is required on the server.");
  return value;
}
function allowed(raw: string | undefined, hosts: readonly string[], prefix = "/"): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !hosts.includes(url.hostname) ||
      !url.pathname.startsWith(prefix)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

async function request(name: string, url: URL | string, o: ProviderOptions, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await (o.fetch ?? globalThis.fetch)(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(init.method === "POST" ? 90000 : 18000),
    });
  } catch {
    throw new Error(name + " could not be reached. Network errors on generation can have an unknown billing outcome.");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(
      name + " returned HTTP " + res.status + (res.status === 429 ? ". The provider rate limit was reached." : "."),
    );
  }
  return res;
}

async function bounded(res: Response, limit: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("The provider returned an empty response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("The provider response exceeds the size limit.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    reader.releaseLock();
  }
}
async function json(name: string, url: string | URL, o: ProviderOptions, headers: Record<string, string>) {
  const res = await request(name, url, o, { headers });
  try {
    return JSON.parse((await bounded(res, 2_000_000)).toString("utf8")) as unknown;
  } catch {
    throw new Error(name + " returned invalid or oversized metadata.");
  }
}

const imageHosts = ["images.pexels.com", "static-videos.pexels.com"];
const websiteHosts = ["pexels.com", "www.pexels.com"];
const pexelsPhoto = z.object({
  id: z.int().positive(),
  url: z.string(),
  photographer: z.string().min(1),
  alt: z.string().nullable().optional(),
  width: z.int().positive(),
  height: z.int().positive(),
  src: z.object({ original: z.string(), medium: z.string().optional(), small: z.string().optional() }),
});
const pexelsVideo = z.object({
  id: z.int().positive(),
  url: z.string(),
  image: z.string().nullable().optional(),
  width: z.int().positive(),
  height: z.int().positive(),
  duration: z.number().positive(),
  user: z.object({ name: z.string().min(1) }),
  video_files: z.array(
    z.object({
      file_type: z.string(),
      link: z.string(),
      width: z.int().positive().nullable(),
      height: z.int().positive().nullable(),
    }),
  ),
});
function pexelsLicense(creator: string) {
  return {
    name: "Pexels License",
    url: "https://www.pexels.com/license/",
    attribution: creator + " on Pexels",
    requiresAttribution: false,
  };
}
function pexelsAsset(raw: unknown, kind: "video" | "image"): Asset | null {
  if (kind === "image") {
    const data = pexelsPhoto.safeParse(raw);
    if (!data.success) return null;
    const p = data.data;
    const sourceUrl = allowed(p.url, websiteHosts, "/photo/");
    const mediaUrl = allowed(p.src.original, imageHosts);
    if (!sourceUrl || !mediaUrl) return null;
    return {
      id: "pexels-image-" + p.id,
      kind,
      title: p.alt || "Pexels photo " + p.id,
      creator: p.photographer,
      sourceUrl,
      mediaUrl,
      previewUrl: allowed(p.src.medium ?? p.src.small, imageHosts),
      width: p.width,
      height: p.height,
      license: pexelsLicense(p.photographer),
    };
  }
  const data = pexelsVideo.safeParse(raw);
  if (!data.success) return null;
  const v = data.data;
  const sourceUrl = allowed(v.url, websiteHosts, "/video/");
  const candidates = v.video_files
    .filter((f) => f.file_type === "video/mp4")
    .map((f) => ({
      url:
        allowed(f.link, ["videos.pexels.com", "static-videos.pexels.com", "www.pexels.com"]) ??
        allowed(f.link, ["player.vimeo.com"], "/external/"),
      size: Math.min(f.width ?? 0, f.height ?? 0),
    }))
    .filter((f) => f.url)
    .sort((a, b) => Math.abs(a.size - 720) - Math.abs(b.size - 720));
  const mediaUrl = candidates[0]?.url;
  if (!sourceUrl || !mediaUrl) return null;
  return {
    id: "pexels-video-" + v.id,
    kind,
    title: "Pexels video " + v.id,
    creator: v.user.name,
    sourceUrl,
    mediaUrl,
    previewUrl: allowed(v.image ?? undefined, imageHosts),
    width: v.width,
    height: v.height,
    duration: v.duration,
    license: pexelsLicense(v.user.name),
  };
}

export async function searchPexels(input: z.input<typeof PexelsSearchInput>, options: ProviderOptions = {}) {
  const { query, limit, kind, orientation } = PexelsSearchInput.parse(input);
  const url = new URL(
    kind === "video" ? "https://api.pexels.com/v1/videos/search" : "https://api.pexels.com/v1/search",
  );
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(limit));
  if (orientation) url.searchParams.set("orientation", orientation);
  const raw = await json("Pexels", url, options, { Authorization: key(options, "PEXELS_API_KEY") });
  const entries =
    kind === "video"
      ? z.object({ videos: z.array(z.unknown()) }).parse(raw).videos
      : z.object({ photos: z.array(z.unknown()) }).parse(raw).photos;
  return StockSearchOutput.parse({
    provider: "pexels",
    query,
    results: entries
      .slice(0, limit)
      .map((r) => pexelsAsset(r, kind))
      .filter((x) => x !== null),
  });
}

const soundSchema = z.object({
  id: z.int().positive(),
  name: z.string().min(1),
  username: z.string().min(1),
  url: z.string(),
  license: z.string(),
  duration: z.number().nonnegative(),
  tags: z.array(z.string()).optional(),
  previews: z.record(z.string(), z.string()).optional(),
});
function soundLicense(raw: string, commercial: boolean, sourceUrl: string) {
  const normalized = raw.trim().toLowerCase();
  // A search filter is advisory; validate each returned license locally.
  if (normalized === "attribution" || normalized === "attribution noncommercial") {
    if (commercial && normalized === "attribution noncommercial") return null;
    return {
      name: normalized === "attribution" ? "CC BY (version on source page)" : "CC BY-NC (version on source page)",
      url: sourceUrl,
      requiresAttribution: true,
    };
  }
  const url =
    normalized === "creative commons 0"
      ? "https://creativecommons.org/publicdomain/zero/1.0/"
      : normalized.replace(/^http:/, "https:");
  const match =
    /^https:\/\/creativecommons\.org\/(?:publicdomain\/(zero)\/(1\.0)|licenses\/(by|by-nc)\/(1\.0|2\.0|2\.5|3\.0|4\.0))\/?$/.exec(
      url,
    );
  if (!match || (commercial && match[3] === "by-nc")) return null;
  const kind = match[1] ? "CC0" : match[3] === "by" ? "CC BY" : "CC BY-NC";
  return {
    name: kind + " " + (match[2] ?? match[4]),
    url: url.endsWith("/") ? url : url + "/",
    requiresAttribution: !match[1],
  };
}
export async function searchFreesound(input: z.input<typeof FreesoundSearchInput>, options: ProviderOptions = {}) {
  const { query, limit, usage } = FreesoundSearchInput.parse(input);
  const commercial = usage === "commercial";
  if (commercial && environment(options).FREESOUND_COMMERCIAL_LICENSE_CONFIRMED !== "true")
    throw new Error(
      "Commercial Freesound API access requires a Freesound agreement. Confirm it in the server configuration or select noncommercial use.",
    );
  const url = new URL("https://freesound.org/apiv2/search/");
  url.searchParams.set("query", query);
  url.searchParams.set("page_size", String(limit));
  url.searchParams.set("fields", "id,name,username,url,license,duration,tags,previews");
  if (commercial) url.searchParams.set("filter", 'license:("Creative Commons 0" OR "Attribution")');
  const raw = await json("Freesound", url, options, { Authorization: "Token " + key(options, "FREESOUND_API_KEY") });
  const { results } = z.object({ results: z.array(z.unknown()) }).parse(raw);
  const safe: Asset[] = [];
  for (const item of results.slice(0, limit)) {
    const parsed = soundSchema.safeParse(item);
    if (!parsed.success) continue;
    const s = parsed.data;
    const sourceUrl = allowed(s.url, ["freesound.org", "www.freesound.org"], "/people/");
    if (!sourceUrl) continue;
    const license = soundLicense(s.license, commercial, sourceUrl);
    if (!license) continue;
    safe.push({
      id: "freesound-" + s.id,
      kind: "sound",
      title: s.name,
      creator: s.username,
      sourceUrl,
      mediaUrl: null,
      previewUrl: allowed(
        s.previews?.["preview-hq-mp3"] ?? s.previews?.["preview-lq-mp3"],
        ["cdn.freesound.org"],
        "/previews/",
      ),
      license: { ...license, attribution: s.name + " by " + s.username + " on Freesound · " + license.name },
      duration: s.duration,
      tags: s.tags,
    });
  }
  return StockSearchOutput.parse({ provider: "freesound", query, results: safe });
}

const model = "eleven_multilingual_v2" as const;
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const codeIs = (e: unknown, code: string) => e instanceof Error && "code" in e && e.code === code;
function statePath(o: ProviderOptions) {
  return path.resolve(
    o.stateDirectory ?? environment(o).REELFORGE_PROVIDER_STATE_DIR ?? path.join(homedir(), ".reelforge", "providers"),
  );
}
function operatorBudget(o: ProviderOptions) {
  const setting = environment(o).REELFORGE_ELEVENLABS_MAX_CREDITS ?? "";
  if (!/^\d{1,8}$/.test(setting) || Number(setting) < 1)
    throw new Error(
      "Voice generation is disabled until the operator sets a positive REELFORGE_ELEVENLABS_MAX_CREDITS limit.",
    );
  return Number(setting);
}
const reservationSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  credits: z.int().positive(),
});
type Reservation = z.infer<typeof reservationSchema>;
async function ledger(dir: string) {
  const names = (await readdir(dir)).filter((n) => /^\d{12}\.json$/.test(n)).sort();
  return Promise.all(
    names.map(async (name, i) => {
      if (name !== String(i + 1).padStart(12, "0") + ".json")
        throw new Error("The voice budget journal is incomplete. Inspect its state before generating.");
      return reservationSchema.parse(JSON.parse(await readFile(path.join(dir, name), "utf8")));
    }),
  );
}
// A completed row is linked into the next occupied journal slot atomically. Competing
// processes retry their balance check on EEXIST. No lock can remain after a crash.
async function reserve(dir: string, entry: Reservation, limit: number) {
  const temp = path.join(dir, ".new-" + randomUUID());
  await writeFile(temp, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
  try {
    for (;;) {
      const rows = await ledger(dir);
      const prior = rows.find((r) => r.requestId === entry.requestId);
      if (prior) return { prior };
      if (rows.reduce((sum, row) => sum + row.credits, 0) + entry.credits > limit)
        throw new Error("The persistent voice budget has insufficient remaining credits.");
      try {
        await link(temp, path.join(dir, String(rows.length + 1).padStart(12, "0") + ".json"));
        return { prior: null };
      } catch (e) {
        if (!codeIs(e, "EEXIST")) throw e;
      }
    }
  } finally {
    await unlink(temp);
  }
}
async function verifyRate(voiceId: string, txt: string, o: ProviderOptions, headers: Record<string, string>) {
  const base = "https://api.elevenlabs.io/v1";
  const [models, voice, subscription] = await Promise.all([
    json("ElevenLabs", base + "/models", o, headers),
    json("ElevenLabs", base + "/voices/" + voiceId, o, headers),
    json("ElevenLabs", base + "/user/subscription", o, headers),
  ]);
  const selected = z
    .array(z.unknown())
    .parse(models)
    .find((entry) => typeof entry === "object" && entry !== null && "model_id" in entry && entry.model_id === model);
  const rates = z
    .object({
      model_id: z.string(),
      can_do_text_to_speech: z.boolean(),
      token_cost_factor: z.number().positive(),
      model_rates: z.object({
        character_cost_multiplier: z.number().positive(),
        cost_discount_multiplier: z.number().nonnegative().optional(),
      }),
    })
    .safeParse(selected);
  const v = z
    .object({
      voice_id: z.string(),
      category: z.string(),
      sharing: z
        .object({ rate: z.number().nullable().optional(), fiat_rate: z.number().nullable().optional() })
        .nullable()
        .optional(),
    })
    .parse(voice);
  if (
    v.voice_id !== voiceId ||
    v.category !== "premade" ||
    (v.sharing?.rate ?? 0) !== 0 ||
    (v.sharing?.fiat_rate ?? 0) !== 0
  )
    throw new Error("Choose an ElevenLabs premade voice with no sharing fee.");
  if (!rates.success || !rates.data.can_do_text_to_speech)
    throw new Error("ElevenLabs did not provide a usable rate for the selected voice model.");
  const sub = z
    .object({
      tier: z.string().min(1),
      status: z.string(),
      character_count: z.int().nonnegative(),
      character_limit: z.int().nonnegative(),
      max_credit_limit_extension: z.number().nullable().optional(),
      allowed_to_extend_character_limit: z.boolean().optional(),
    })
    .parse(subscription);
  if (["free", "trial"].includes(sub.tier.toLowerCase()) || sub.status !== "active")
    throw new Error("Commercial voice generation requires an active paid plan on ElevenLabs.");
  const overagesOff =
    sub.max_credit_limit_extension === 0 ||
    (sub.max_credit_limit_extension === undefined && sub.allowed_to_extend_character_limit === false);
  if (!overagesOff) throw new Error("Disable ElevenLabs usage-based overages to enforce a credit-only budget.");
  // UTF-8 length bounds Unicode characters and UTF-16 code units. Ignore discounts
  // when reserving, and check both published rate fields before sending the text.
  const factor =
    Math.max(1, rates.data.token_cost_factor, rates.data.model_rates.character_cost_multiplier) *
    Math.max(1, rates.data.model_rates.cost_discount_multiplier ?? 1);
  const credits = Math.ceil(Buffer.byteLength(txt, "utf8") * factor);
  if (credits > sub.character_limit - sub.character_count)
    throw new Error("The ElevenLabs plan has insufficient included credits.");
  return credits;
}
function playableMp3(buf: Buffer) {
  // Skip a synchsafe ID3v2 tag and verify that the first complete MPEG Layer III
  // frame fits in the response. A truncated ID3 tag or a bare sync byte is not audio.
  let offset = 0;
  if (buf.subarray(0, 3).toString("ascii") === "ID3") {
    if (buf.length < 10 || buf.subarray(6, 10).some((b) => b > 127)) return false;
    const tagSize = buf.subarray(6, 10).reduce((n, b) => n * 128 + b, 0);
    const footer = buf[3] === 4 && (buf[5]! & 0x10) !== 0 ? 10 : 0;
    offset = 10 + tagSize + footer;
  }
  if (offset + 4 > buf.length || buf[offset] !== 0xff) return false;
  const second = buf[offset + 1]!,
    third = buf[offset + 2]!;
  const version = (second >> 3) & 3;
  const rateIndex = (third >> 2) & 3;
  const bitrateIndex = third >> 4;
  if (
    (second & 0xe0) !== 0xe0 ||
    (second & 6) !== 2 ||
    version === 1 ||
    rateIndex === 3 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15
  )
    return false;
  const table =
    version === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const frequency = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const length = Math.floor(((version === 3 ? 144000 : 72000) * table[bitrateIndex]!) / frequency) + ((third >> 1) & 1);
  return offset + length <= buf.length;
}
function receipt(row: Reservation, voiceId: string, buf: Buffer): Voiceover {
  return VoiceoverOutput.parse({
    provider: "elevenlabs",
    requestId: row.requestId,
    model,
    voiceId,
    asset: "voiceovers/" + row.requestId + ".mp3",
    mimeType: "audio/mpeg",
    bytes: buf.length,
    sha256: sha(buf),
    reservedCredits: row.credits,
  });
}
async function replay(row: Reservation, fingerprint: string, maxCredits: number, voiceId: string, file: string) {
  if (fingerprint !== row.fingerprint)
    throw new Error("This voice request ID belongs to different text or a different voice.");
  if (row.credits > maxCredits) throw new Error("The prior voice reservation exceeds this request's approval.");
  try {
    const data = await readFile(file);
    if (!playableMp3(data)) throw new Error("The recorded voice artifact is invalid.");
    return receipt(row, voiceId, data);
  } catch (e) {
    if (!codeIs(e, "ENOENT")) throw e;
    throw new Error(
      "This request already has a reservation and no completed audio. An earlier generation may have been billed. Check ElevenLabs history before authorizing another request.",
    );
  }
}
export async function synthesizeVoiceover(
  input: z.input<typeof VoiceoverInput>,
  options: ProviderOptions = {},
): Promise<Voiceover> {
  const { requestId: suppliedId, text, voiceId, maxCredits } = VoiceoverInput.parse(input);
  const requestId = suppliedId.toLowerCase();
  const limit = operatorBudget(options);
  const fingerprint = sha(JSON.stringify([model, voiceId, text]));
  const dir = statePath(options),
    journal = path.join(dir, "voice-budget"),
    out = path.join(dir, "voiceovers");
  await Promise.all([mkdir(journal, { recursive: true, mode: 0o700 }), mkdir(out, { recursive: true, mode: 0o700 })]);
  const target = path.join(out, requestId + ".mp3");
  const previous = (await ledger(journal)).find((r) => r.requestId === requestId);
  if (previous) return replay(previous, fingerprint, maxCredits, voiceId, target);
  if (Buffer.byteLength(text, "utf8") > Math.min(maxCredits, limit))
    throw new Error("The text exceeds the approved voice credit cap.");
  const headers = { "xi-api-key": key(options, "ELEVENLABS_API_KEY") };
  const credits = await verifyRate(voiceId, text, options, headers);
  if (credits > maxCredits) throw new Error("The ElevenLabs rate exceeds the approved voice credit cap.");
  const row = { requestId, fingerprint, credits };
  const { prior } = await reserve(journal, row, limit);
  if (prior) return replay(prior, fingerprint, maxCredits, voiceId, target);
  // After this point any interrupted request keeps its reservation. The provider
  // does not document idempotent TTS submits, so retrying here could charge twice.
  const response = await request(
    "ElevenLabs",
    "https://api.elevenlabs.io/v1/text-to-speech/" + voiceId + "?output_format=mp3_44100_128",
    options,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
    },
  );
  if (response.headers.get("content-type")?.split(";")[0] !== "audio/mpeg") {
    await response.body?.cancel();
    throw new Error("ElevenLabs returned an unexpected audio format. The reservation is retained.");
  }
  const audio = await bounded(response, 8_000_000);
  if (!playableMp3(audio)) throw new Error("ElevenLabs returned an invalid MP3. The reservation is retained.");
  const pending = path.join(out, ".new-" + randomUUID());
  try {
    await writeFile(pending, audio, { mode: 0o600, flag: "wx" });
    await rename(pending, target);
  } finally {
    await unlink(pending).catch((e) => {
      if (!codeIs(e, "ENOENT")) throw e;
    });
  }
  return receipt(row, voiceId, audio);
}
