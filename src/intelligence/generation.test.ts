import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { generateBroll, generationStatus } from "./generation";
import { planIllustration } from "./illustration";
import { run } from "../pipeline/util/exec";
const id = "a551ef36-b305-4d35-93e4-d1507406c139";
const phrase = { start: 0, end: 2, text: "A pottery kiln at work" };
const request = { requestId: id, phrase, prompt: "A ceramic kiln in a workshop", seed: 12, authorized: true as const };
describe("media generation", () => {
  it("uses a part-to-whole graphic only with literal transcript evidence and no stock", () => {
    const base = { phrases: [{ ...phrase, text: "64% of respondents agreed." }], hasStock: false, motion: true };
    expect(planIllustration(base)?.value).toBe(64);
    expect(planIllustration({ ...base, hasStock: true })).toBeNull();
    for (const text of [
      "Sales rose by 64%.",
      "Nearly 64% of respondents",
      "125% of respondents",
      "-64% of respondents",
      "64% of a and 22% of b",
    ])
      expect(planIllustration({ ...base, phrases: [{ ...phrase, text }] })).toBeNull();
  });
  it("submits once, retrieves a real PNG via the local API contract, and remembers the result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "comfy-contract-"));
    try {
      const png = path.join(root, "fixture.png");
      await run("ffmpeg", [
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=768x448",
        "-frames:v",
        "1",
        "-threads",
        "1",
        png,
      ]);
      const file = await readFile(png);
      let waiting = true;
      const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const uri = new URL(String(url));
        expect(uri.hostname).toBe("127.0.0.1");
        if (uri.pathname === "/prompt") {
          const data = JSON.parse(String(init?.body));
          expect(data.prompt["5"].inputs.seed).toBe(12);
          return Response.json({ prompt_id: id });
        }
        if (uri.pathname.startsWith("/history"))
          return Response.json(
            waiting
              ? {}
              : {
                  [id]: {
                    status: { status_str: "success" },
                    outputs: {
                      "7": { images: [{ type: "output", subfolder: "", filename: "reelforge-" + id + "_00001_.png" }] },
                    },
                  },
                },
          );
        if (uri.pathname === "/queue") return Response.json({ queue_running: [[1, id]], queue_pending: [] });
        return new Response(new Uint8Array(file));
      });
      const cfg = { root, checkpoint: "licensed-model.safetensors", port: 8188, fetch: fetcher };
      expect((await generateBroll(request, cfg)).state).toBe("submitted");
      expect((await generateBroll(request, cfg)).state).toBe("waiting");
      await expect(generateBroll({ ...request, seed: 19 }, cfg)).rejects.toThrow(/different/);
      waiting = false;
      const done = await generationStatus({ requestId: id }, cfg);
      expect(await readFile(path.join(root, done.file!))).toEqual(file);
      expect(await generationStatus({ requestId: id }, cfg)).toEqual(done);
      expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/prompt"))).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("prefers catalog stock and rejects unapproved generation before submitting", async () => {
    const fetcher = vi.fn(),
      cfg = { root: ".", checkpoint: "x.safetensors", port: 8188, fetch: fetcher };
    expect(
      (await generateBroll({ ...request, phrase: { ...phrase, text: "Look at the alpine mountains." } }, cfg)).state,
    ).toBe("catalog");
    await expect(generateBroll({ ...request, authorized: false as true }, cfg)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
