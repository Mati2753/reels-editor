import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchFreesound, searchPexels, synthesizeVoiceover, VoiceoverInput, type ProviderOptions } from "./providers";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const photo = {
  id: 91,
  url: "https://www.pexels.com/photo/alpine-lake-91/",
  photographer: "Ada",
  alt: "A blue alpine lake",
  width: 1000,
  height: 800,
  src: {
    original: "https://images.pexels.com/photos/91/full.jpg",
    medium: "https://images.pexels.com/photos/91/small.jpg",
  },
};
const video = {
  id: 85,
  url: "https://www.pexels.com/video/lake-85/",
  image: "https://images.pexels.com/videos/85/preview.jpg",
  width: 1080,
  height: 1920,
  duration: 5,
  user: { name: "Li" },
  video_files: [
    { file_type: "video/mp4", width: 720, height: 1280, link: "https://videos.pexels.com/video-files/85/clip.mp4" },
  ],
};
const environmentalKeys = {
  FREESOUND_API_KEY: "mock-sounds",
  PEXELS_API_KEY: "mock-pexels",
  FREESOUND_COMMERCIAL_LICENSE_CONFIRMED: "true",
};

describe("licensed stock search", () => {
  it("sends portrait video queries to the official endpoint and retains the creator and license", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        videos: [
          video,
          {
            ...video,
            id: 2,
            video_files: [{ ...video.video_files[0], link: "https://videos.pexels.com.evil.test/lake.mp4" }],
          },
          {
            ...video,
            id: 3,
            video_files: [{ ...video.video_files[0], link: "https://user:pwd@videos.pexels.com/lake.mp4" }],
          },
        ],
      }),
    );
    const result = await searchPexels(
      { query: "alpine sunrise", orientation: "portrait" },
      { fetch, env: environmentalKeys },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.pexels.com/v1/videos/search?query=alpine+sunrise&per_page=8&orientation=portrait",
    );
    expect(init).toMatchObject({ headers: { Authorization: "mock-pexels" }, redirect: "error" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      id: "pexels-video-85",
      creator: "Li",
      width: 1080,
      license: { name: "Pexels License", attribution: "Li on Pexels" },
      mediaUrl: video.video_files[0]!.link,
    });
  });
  it("maps Pexels image alt text and preview and keeps unapproved sources out", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ photos: [photo, { ...photo, url: "https://bad.example/photo/91/" }] }),
    );
    const result = await searchPexels({ query: "blue lake", kind: "image" }, { fetch, env: environmentalKeys });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      kind: "image",
      title: photo.alt,
      sourceUrl: photo.url,
      previewUrl: photo.src.medium,
    });
    expect(String(fetch.mock.calls[0]![0])).toContain("https://api.pexels.com/v1/search?");
  });
  it("requires credentials, rejects invalid parameters, and bounds upstream data", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("x".repeat(2_000_001)));
    await expect(searchPexels({ query: "hello" }, { fetch, env: {} })).rejects.toThrow("PEXELS_API_KEY");
    await expect(searchPexels({ query: "hello", limit: 25 }, { fetch, env: environmentalKeys })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(searchPexels({ query: "hello" }, { fetch, env: environmentalKeys })).rejects.toThrow("oversized");
    fetch.mockResolvedValueOnce(new Response("sensitive vendor message", { status: 429 }));
    await expect(searchPexels({ query: "hello" }, { fetch, env: environmentalKeys })).rejects.toThrow("rate limit");
  });
  const sound = {
    id: 21,
    name: "Soft forest chime",
    username: "Ada",
    url: "https://freesound.org/people/Ada/sounds/21/",
    license: "http://creativecommons.org/licenses/by/3.0/",
    duration: 1.4,
    tags: ["chime"],
    previews: { "preview-hq-mp3": "https://cdn.freesound.org/previews/21/chime.mp3" },
  };
  const nc = { ...sound, id: 22, license: "https://creativecommons.org/licenses/by-nc/4.0/" };
  it("checks commercial API access separately from every recording's Creative Commons rights", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        results: [
          sound,
          nc,
          { ...sound, id: 23, license: "http://creativecommons.org/licenses/by/4.0/../by-nc/4.0" },
          { ...sound, id: 24, license: "all rights reserved" },
          { ...sound, id: 25, license: "Attribution" },
        ],
      }),
    );
    await expect(
      searchFreesound({ query: "forest chime" }, { fetch, env: { FREESOUND_API_KEY: "test" } }),
    ).rejects.toThrow("agreement");
    expect(fetch).not.toHaveBeenCalled();
    const result = await searchFreesound({ query: "forest chime" }, { fetch, env: environmentalKeys });
    const [url, init] = fetch.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/apiv2/search/");
    expect(new URL(String(url)).searchParams.get("filter")).toContain("Creative Commons 0");
    expect(init?.headers).toEqual({ Authorization: "Token mock-sounds" });
    expect(result.results.map((r) => r.id)).toEqual(["freesound-21", "freesound-25"]);
    expect(result.results[0]).toMatchObject({
      mediaUrl: null,
      license: { name: "CC BY 3.0", requiresAttribution: true },
    });
    expect(result.results[1]!.license.url).toBe(sound.url);
    const research = await searchFreesound(
      { query: "forest chime", usage: "noncommercial" },
      { fetch, env: { FREESOUND_API_KEY: "mock" } },
    );
    expect(research.results.some((r) => r.license.name === "CC BY-NC 4.0")).toBe(true);
  });
});
const defaultVoice = "JBFqnCBsd6RMkjVDRZzb";
const speechModel = {
  model_id: "eleven_multilingual_v2",
  can_do_text_to_speech: true,
  token_cost_factor: 1,
  model_rates: { character_cost_multiplier: 1, cost_discount_multiplier: 1 },
};
const subscription = {
  tier: "starter",
  status: "active",
  character_count: 10,
  character_limit: 500,
  max_credit_limit_extension: 0,
};
const premade = { voice_id: defaultVoice, category: "premade", sharing: null };
const mp3 = new Uint8Array(417);
mp3.set([0xff, 0xfb, 0x90, 0]);
const voiceInput = (text = "One sun") => ({
  requestId: randomUUID(),
  text,
  authorized: true as const,
  maxCredits: 100,
});
async function voiceHost(
  overrides: {
    rate?: object[];
    voice?: object;
    sub?: object;
    generate?: () => Response | Promise<Response>;
    ceiling?: number;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "reelforge-voice-"));
  tempDirs.push(directory);
  const fetch = vi.fn<typeof globalThis.fetch>(async (target, init) => {
    const url = new URL(String(target));
    expect(url.origin).toBe("https://api.elevenlabs.io");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("mock-voice");
    if (url.pathname === "/v1/models")
      return Response.json(
        overrides.rate ?? [{ model_id: "unrelated-speech-recognition", token_cost_factor: 0 }, speechModel],
      );
    if (url.pathname === "/v1/user/subscription") return Response.json(overrides.sub ?? subscription);
    if (url.pathname === "/v1/voices/" + defaultVoice) return Response.json(overrides.voice ?? premade);
    if (url.pathname === "/v1/text-to-speech/" + defaultVoice && init?.method === "POST")
      return overrides.generate
        ? overrides.generate()
        : new Response(mp3, { headers: { "Content-Type": "audio/mpeg" } });
    throw Error("Unexpected endpoint.");
  });
  const options: ProviderOptions = {
    stateDirectory: directory,
    fetch,
    env: { ELEVENLABS_API_KEY: "mock-voice", REELFORGE_ELEVENLABS_MAX_CREDITS: String(overrides.ceiling ?? 100) },
  };
  return {
    options,
    fetch,
    directory,
    generations: () => fetch.mock.calls.filter((call) => call[1]?.method === "POST"),
  };
}

describe("explicitly approved ElevenLabs synthesis", () => {
  it("validates consent, positive request and operator caps, and local UUID input before sending text", async () => {
    const host = await voiceHost();
    const input = voiceInput();
    expect(VoiceoverInput.safeParse({ ...input, authorized: false }).success).toBe(false);
    expect(VoiceoverInput.safeParse({ ...input, requestId: "../anything" }).success).toBe(false);
    await expect(synthesizeVoiceover({ ...input, maxCredits: 0 }, host.options)).rejects.toThrow();
    await expect(synthesizeVoiceover({ ...input, maxCredits: 2 }, host.options)).rejects.toThrow("cap");
    await expect(synthesizeVoiceover(input, { ...host.options, env: {} })).rejects.toThrow("disabled");
    expect(host.fetch).not.toHaveBeenCalled();
  });
  it("writes a validated MP3 atomically, records the conservative credit ceiling, and replays the receipt across calls", async () => {
    const host = await voiceHost();
    const input = voiceInput("été"); // Five UTF-8 bytes reserve conservatively for three letters.
    const result = await synthesizeVoiceover(input, host.options);
    expect(result.reservedCredits).toBe(5);
    expect(result.asset).toBe("voiceovers/" + input.requestId + ".mp3");
    expect(await readFile(path.join(host.directory, result.asset))).toEqual(Buffer.from(mp3));
    const post = host.generations()[0]!;
    expect(new URL(String(post[0])).searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(JSON.parse(String(post[1]!.body))).toEqual({ text: "été", model_id: "eleven_multilingual_v2" });
    const again = await synthesizeVoiceover({ ...input, requestId: input.requestId.toUpperCase() }, host.options);
    expect(again).toEqual(result);
    await expect(synthesizeVoiceover({ ...input, text: "Changed text" }, host.options)).rejects.toThrow(
      "different text",
    );
    expect(host.generations()).toHaveLength(1);
  });
  it.each([
    ["paid plan", { sub: { ...subscription, tier: "free" } }],
    ["overages", { sub: { ...subscription, max_credit_limit_extension: null } }],
    ["included credits", { sub: { ...subscription, character_count: 499 } }],
    ["premade voice", { voice: { ...premade, category: "professional", sharing: { fiat_rate: 1 } } }],
    ["usable rate", { rate: [{ model_id: "unrelated" }] }],
    ["approved voice credit cap", { rate: [{ ...speechModel, model_rates: { character_cost_multiplier: 5 } }] }],
  ] as const)("rejects a failed price or entitlement preflight for %s", async (msg, override) => {
    const host = await voiceHost({
      ...override,
      ...("rate" in override ? { rate: [...override.rate] } : {}),
    } as Parameters<typeof voiceHost>[0]);
    await expect(synthesizeVoiceover({ ...voiceInput("four"), maxCredits: 5 }, host.options)).rejects.toThrow(msg);
    expect(host.generations()).toHaveLength(0);
  });
  it("prevents parallel generations from exceeding a shared spending cap", async () => {
    const host = await voiceHost({ ceiling: 5 });
    const results = await Promise.allSettled([
      synthesizeVoiceover(voiceInput("one"), host.options),
      synthesizeVoiceover(voiceInput("two"), host.options),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(host.generations()).toHaveLength(1);
    expect((await readdir(path.join(host.directory, "voice-budget"))).filter((n) => n.endsWith(".json"))).toHaveLength(
      1,
    );
  });
  it("publishes no partial audio and does not resubmit a request after an uncertain provider response", async () => {
    const host = await voiceHost({
      generate: () => new Response("ID3broken", { headers: { "Content-Type": "audio/mpeg" } }),
    });
    const input = voiceInput();
    await expect(synthesizeVoiceover(input, host.options)).rejects.toThrow("invalid MP3");
    expect(await readdir(path.join(host.directory, "voiceovers"))).toEqual([]);
    await expect(synthesizeVoiceover(input, host.options)).rejects.toThrow("earlier generation may have been billed");
    expect(host.generations()).toHaveLength(1);
  });
  it("refuses to follow credentials across a redirect or automatically retry a timed-out charge", async () => {
    const host = await voiceHost({
      generate: () => {
        throw new TypeError("network error");
      },
    });
    const input = voiceInput();
    await expect(synthesizeVoiceover(input, host.options)).rejects.toThrow("unknown billing outcome");
    await expect(synthesizeVoiceover(input, host.options)).rejects.toThrow("reservation");
    expect(host.generations()).toHaveLength(1);
  });
});
