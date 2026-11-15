/**
 * Contact sheets of the gallery (src/remotion/gallery/): every overlay and transition
 * rendered as stills by the same resolver and components as a Reel.
 *
 *   npm run gallery -- [--out <dir>] [--only <Component,...>] [--guides] [--no-states] [--no-transitions]
 *
 * Writes into <dir> (default out/gallery/):
 *   sheet-settled.jpg              every overlay at rest, short text, its first zone, dark background
 *   sheet-settled-long.jpg         the same with the text at the limit, light background
 *   overlay-<Name>.jpg             one row per zone and text (short on dark, limit on light), one
 *                                  column per state: entrance start, mid-entrance, settled,
 *                                  settled on the other background, mid-exit
 *   transitions.jpg                one row per transition: window start, 1/4, just before the
 *                                  cut, the cut, 3/4, last frame
 * --guides draws the safe zone (magenta) and the zones (cyan) on every cell.
 * Uses REELS_BROWSER_EXECUTABLE like `reels preview`.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measureText } from "../src/edl/measure";
import { toFrame } from "../src/edl/resolve";
import { validateEdl } from "../src/edl/validate";
import type { Edl, Zone } from "../src/edl/schema";
import { overlays } from "../src/remotion/overlays";
import { overlaySampleEdl, overlaySamples, SAMPLE_LEAD, settledFrame, transitionSampleEdl, transitionSamples, type Background, type SheetCell } from "../src/remotion/gallery/samples";

const REPO = fileURLToPath(new URL("../", import.meta.url));

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = path.resolve(opt("--out") ?? path.join(REPO, "out", "gallery"));
const only = opt("--only")?.split(",");
const guides = args.includes("--guides");
const browserExecutable = process.env.REELS_BROWSER_EXECUTABLE ?? null;

function overlayFrames(edl: Edl): { label: string; frame: number; background?: Background }[] {
  const ov = edl.overlays[0]!;
  const start = toFrame(SAMPLE_LEAD);
  const def = overlays[ov.component]!;
  const enter = toFrame(ov.enter?.duration ?? def.enter.duration);
  const exit = toFrame(ov.exit?.duration ?? def.exit.duration);
  const end = start + toFrame(ov.duration);
  return [
    { label: "entrée f0", frame: start },
    { label: `entrée f${Math.round(enter / 2)}`, frame: start + Math.round(enter / 2) },
    { label: "posé", frame: settledFrame(edl) },
    { label: "posé (autre fond)", frame: settledFrame(edl), background: "light" },
    { label: `sortie f${Math.round(exit / 2)}/${exit}`, frame: end - Math.ceil(exit / 2) },
  ];
}

/** Validates every sample in Node (opentype metrics, same rules as `reels validate`); prints what does not pass. */
function checkSamples(): number {
  let bad = 0;
  const facts = { probe: { version: 1 as const, clips: [] }, analysis: { words: [] } };
  for (const s of overlaySamples) {
    for (const zone of overlays[s.component]!.zones) {
      for (const variant of ["short", "long"] as const) {
        const r = validateEdl(overlaySampleEdl(s, zone, variant, "dark"), facts, { measure: measureText });
        for (const i of r.issues) {
          if (i.rule === "duration") continue;
          if (i.severity === "error") bad++;
          console.log(`  ${i.severity} ${s.component} ${zone} ${variant}: [${i.rule}] ${i.path} ${i.message}`);
        }
      }
    }
  }
  for (const t of transitionSamples) {
    const r = validateEdl(transitionSampleEdl(t), facts, { measure: measureText });
    for (const i of r.issues) {
      if (i.severity === "error") bad++;
      console.log(`  ${i.severity} transition ${t.type}: [${i.rule}] ${i.message}`);
    }
  }
  return bad;
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const bad = checkSamples();
  console.log(`samples: ${bad} error(s)`);
  const started = Date.now();
  console.log("bundling...");
  const serveUrl = await bundle({ entryPoint: path.join(REPO, "src", "remotion", "index.ts"), rootDir: REPO });
  const browser = await openBrowser("chrome", { browserExecutable, logLevel: "error" });
  const sheet = async (file: string, cells: SheetCell[], columns: number, cellWidth: number) => {
    const inputProps = { cells, columns, cellWidth, guides, resolved: null };
    const composition = await selectComposition({ serveUrl, id: "GallerySheet", inputProps, puppeteerInstance: browser, browserExecutable, logLevel: "error" });
    const output = path.join(outDir, file);
    await renderStill({
      composition,
      serveUrl,
      output,
      inputProps,
      imageFormat: "jpeg",
      jpegQuality: 90,
      puppeteerInstance: browser,
      overwrite: true,
      logLevel: "error",
      timeoutInMilliseconds: 120000,
    });
    console.log(`${path.relative(REPO, output)}  ${composition.width}x${composition.height}`);
  };
  try {
    const samples = overlaySamples.filter((s) => !only || only.includes(s.component));
    for (const variant of ["short", "long"] as const) {
      const cells = samples.map((s) => {
        const zone = overlays[s.component]!.zones[0]!;
        const edl = overlaySampleEdl(s, zone, variant, variant === "short" ? "dark" : "light");
        return { edl, frame: settledFrame(edl), label: `${s.component} · ${zone}` };
      });
      if (cells.length) await sheet(variant === "short" ? "sheet-settled.jpg" : "sheet-settled-long.jpg", cells, Math.min(4, cells.length), 360);
    }
    if (!args.includes("--no-states")) {
      for (const s of samples) {
        const cells: SheetCell[] = [];
        for (const zone of overlays[s.component]!.zones as readonly Zone[]) {
          for (const variant of ["short", "long"] as const) {
            const bg: Background = variant === "short" ? "dark" : "light";
            for (const f of overlayFrames(overlaySampleEdl(s, zone, variant, bg))) {
              const other: Background = f.background ? (bg === "dark" ? "light" : "dark") : bg;
              cells.push({ edl: overlaySampleEdl(s, zone, variant, other), frame: f.frame, label: `${zone} · ${variant === "short" ? "court" : "limite"} · ${f.label}` });
            }
          }
        }
        await sheet(`overlay-${s.component}.jpg`, cells, 5, 300);
      }
    }
    if (!args.includes("--no-transitions") && (!only || only.includes("transitions"))) {
      const cells: SheetCell[] = [];
      for (const t of transitionSamples) {
        const edl = transitionSampleEdl(t);
        const d = toFrame(t.duration);
        const cut = toFrame(2.5);
        const from = cut - Math.floor(d / 2);
        const frames: [string, number][] = [
          ["début", from],
          ["1/4", from + Math.round((d - 1) / 4)],
          ["avant coupe", cut - 1],
          ["coupe", cut],
          ["3/4", from + Math.round((3 * (d - 1)) / 4)],
          ["fin", from + d - 1],
        ];
        for (const [label, frame] of frames) cells.push({ edl, frame, label: `${t.type} ${t.duration}s · ${label} (f${frame - from})` });
      }
      await sheet("transitions.jpg", cells, 6, 240);
    }
  } finally {
    await browser.close({ silent: true });
  }
  console.log(`gallery: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
