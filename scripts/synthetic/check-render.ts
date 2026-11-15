/**
 * Measures a rendered Reel of the synthetic footage against its ground truth (truth.json
 * written by scripts/synthetic/generate.py). Regression check for phase 2.
 *
 *   npx tsx scripts/synthetic/check-render.ts <slug> [--edl <file>] [--no-transcribe]
 *
 * Reads the EDL (projects/<slug>/edl.json or --edl), resolves it, and measures
 * out/<name>.mp4 itself:
 *   1. container: size, frame rate, frame count against the resolved duration, loudness;
 *   2. cuts: which truth words the played source spans keep, truncate or drop;
 *   3. audio placement: each segment's audio found in the output by cross-correlation with
 *      the source audio (offset from where the resolver put it);
 *   4. junctions: audio level on both sides of every cut, against the silence threshold;
 *   5. re-transcription of the output (faster-whisper) compared with the expected text;
 *   6. captions: the highlighted word read from every output frame (pixel colour), against
 *      the moment the truth word is spoken in the output;
 *   7. A/V sync: flash (video) against beep (audio) for every clap kept by the EDL;
 *   8. framing: position of the targets' red dots in the first frame of every segment
 *      against the position the framing geometry predicts.
 *
 * Exits with code 1 when a tolerance is not met. ffmpeg must be on PATH; the transcription
 * uses the repository's .venv (see docs/ARCHITECTURE.md).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cropRect, framingAt } from "../../src/edl/framing";
import { FPS, segmentTimings } from "../../src/edl/resolve";
import type { ResolvedCaptionPage, ResolvedClipSegment, ResolvedEdl } from "../../src/edl/resolved";
import type { Edl } from "../../src/edl/schema";
import { measureText } from "../../src/edl/measure";
import { readWavMono16, frameLevels } from "../../src/pipeline/analysis/audio";
import { projectPaths } from "../../src/pipeline/project";
import { AnalysisSchema, ProbeSchema, TranscriptSchema } from "../../src/pipeline/schemas";
import { defaultTranscribeOptions } from "../../src/pipeline/transcribe";
import { run } from "../../src/pipeline/util/exec";
import { mergeEngineWords, normalizeWord } from "../../src/pipeline/words";
import { edlTarget, validateProject } from "../../src/render/project";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

interface TruthWord {
  text: string;
  start: number;
  end: number;
}
interface Truth {
  clapSeconds: number;
  markers?: { name: string; x: number; y: number; px: [number, number] }[];
  clips: { file: string; claps: number[]; words: TruthWord[] }[];
}

const failures: string[] = [];
const check = (ok: boolean, label: string): string => {
  if (!ok) failures.push(label);
  return ok ? "OK  " : "FAIL";
};
const ms = (s: number): string => `${s >= 0 ? "+" : ""}${Math.round(s * 1000)} ms`;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? NaN : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function alignWords(a: string[], b: string[]): [number, number][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

async function ffprobeJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-of", "json", ...args]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

/** Raw RGB frames of a horizontal band of the video, every frame, at full width. */
async function bandFrames(video: string, y: number, h: number, scale: number): Promise<{ frames: Buffer[]; width: number; height: number }> {
  const width = Math.round(1080 * scale);
  const height = Math.round(h * scale);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "reels-band-"));
  const raw = path.join(tmp, "band.rgb");
  await run("ffmpeg", ["-v", "error", "-i", video, "-vf", `crop=1080:${h}:0:${y},scale=${width}:${height}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const buf = await readFile(raw);
  await rm(tmp, { recursive: true, force: true });
  const size = width * height * 3;
  const frames: Buffer[] = [];
  for (let o = 0; o + size <= buf.length; o += size) frames.push(buf.subarray(o, o + size));
  return { frames, width, height };
}

async function frameRgb(video: string, frame: number): Promise<Buffer> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "reels-frame-"));
  const raw = path.join(tmp, "f.rgb");
  await run("ffmpeg", ["-v", "error", "-i", video, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
  const buf = await readFile(raw);
  await rm(tmp, { recursive: true, force: true });
  return buf;
}

async function extractWav(video: string, rate: number, out: string): Promise<void> {
  await run("ffmpeg", ["-v", "error", "-y", "-i", video, "-vn", "-ac", "1", "-ar", String(rate), "-c:a", "pcm_s16le", out]);
}

/** Lag (samples) in [-maxLag, maxLag] maximising the normalized correlation of a with b shifted. */
function bestLag(a: Float32Array, b: Float32Array, bStart: number, maxLag: number): { lag: number; corr: number } {
  let best = { lag: 0, corr: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[bStart + lag + i] ?? 0;
      sab += x * y;
      saa += x * x;
      sbb += y * y;
    }
    const c = sab / Math.sqrt(saa * sbb + 1e-12);
    if (c > best.corr) best = { lag, corr: c };
  }
  return best;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--")) ?? "demo";
  const edlIdx = args.indexOf("--edl");
  const paths = projectPaths(path.join(REPO, "projects"), slug);
  const target = edlTarget(paths, edlIdx >= 0 ? args[edlIdx + 1] : undefined);
  const video = path.join(paths.out, `${target.name}.mp4`);
  const truth = JSON.parse(await readFile(path.join(paths.dir, "truth.json"), "utf8")) as Truth;
  const probe = ProbeSchema.parse(JSON.parse(await readFile(paths.probe, "utf8")));
  const transcript = TranscriptSchema.parse(JSON.parse(await readFile(paths.transcript, "utf8")));
  const analysis = AnalysisSchema.parse(JSON.parse(await readFile(paths.analysis, "utf8")));
  const edl = JSON.parse(await readFile(target.file, "utf8")) as Edl;
  const v = await validateProject(paths, target);
  const resolved = v.resolved as ResolvedEdl;
  if (!v.ok || !resolved) throw new Error("the EDL does not validate");
  const timings = segmentTimings(edl.segments);
  const clipOf = new Map(probe.clips.map((c) => [c.id, c]));
  const truthOf = new Map(probe.clips.map((c) => [c.id, truth.clips.find((t) => t.file === c.file)!]));
  console.log(`Render check of ${path.relative(REPO, video)} (EDL ${path.relative(REPO, target.file)})\n`);

  /** Output seconds of source time t in segment i. */
  const toOut = (i: number, t: number): number => timings[i]!.fromFrame / FPS + (t - timings[i]!.srcStart) / timings[i]!.rate;

  const pages = resolved.captions.enabled ? resolved.captions.pages : [];

  // ------------------------------------------------------------------ 1. container
  console.log("== Container");
  const info = (await ffprobeJson(["-count_packets", "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_read_packets,duration,sample_rate", video])) as {
    streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; nb_read_packets?: string; duration?: string; sample_rate?: string }[];
  };
  const vs = info.streams.find((s) => s.codec_type === "video")!;
  const as = info.streams.find((s) => s.codec_type === "audio");
  const expectedSeconds = edl.segments.reduce((sum, s) => sum + (s.type === "clip" ? (s.out - s.in) / (s.speed ?? 1) : s.duration), 0);
  const frames = Number(vs.nb_read_packets);
  console.log(`  ${check(vs.width === 1080 && vs.height === 1920 && vs.r_frame_rate === "30/1", "format")} ${vs.width}x${vs.height}, ${vs.r_frame_rate} fps`);
  console.log(
    `  ${check(Math.abs(frames - expectedSeconds * FPS) <= 1, "duration")} ${frames} frames = ${(frames / FPS).toFixed(3)} s; sum of the EDL segments ${expectedSeconds.toFixed(3)} s ` +
      `(${(expectedSeconds * FPS).toFixed(2)} frames, difference ${(frames - expectedSeconds * FPS).toFixed(2)} frame); audio stream ${as?.duration} s at ${as?.sample_rate} Hz`,
  );
  const { stderr: eb } = await run("ffmpeg", ["-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(eb.slice(eb.lastIndexOf("Summary")))?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(eb.slice(eb.lastIndexOf("True peak")))?.[1]);
  console.log(`  ${check(Math.abs(I + 14) <= 0.5, "loudness")} integrated loudness ${I} LUFS (ebur128), true peak ${TP} dBTP`);

  // ------------------------------------------------------------------ 2. cuts against the truth
  console.log("\n== Cuts against the truth words (source spans really played)");
  interface Played {
    seg: number;
    clip: string;
    truth: TruthWord;
    fraction: number;
    outStart: number;
    outEnd: number;
  }
  const played: Played[] = [];
  const truncated: string[] = [];
  // Runs of segments that continue each other in the source (framing changes without a
  // cut) play one continuous span: a word across such a split is not cut.
  const runs: { first: number; last: number; srcStart: number; srcEnd: number }[] = [];
  edl.segments.forEach((s, i) => {
    if (s.type !== "clip") return;
    const prev = edl.segments[i - 1];
    const r = runs[runs.length - 1];
    const continues = prev?.type === "clip" && prev.clip === s.clip && Math.abs(prev.out - s.in) < 1e-6 && timings[i]!.rate === 1 && timings[i - 1]!.rate === 1 && r?.last === i - 1;
    if (continues && r) {
      r.last = i;
      r.srcEnd = timings[i]!.srcEnd;
    } else runs.push({ first: i, last: i, srcStart: timings[i]!.srcStart, srcEnd: timings[i]!.srcEnd });
  });
  for (const r of runs) {
    const s = edl.segments[r.first] as Extract<Edl["segments"][number], { type: "clip" }>;
    for (const w of truthOf.get(s.clip)!.words) {
      const ov = Math.min(w.end, r.srcEnd) - Math.max(w.start, r.srcStart);
      if (ov <= 0) continue;
      const fraction = ov / (w.end - w.start);
      let i = r.first;
      while (i < r.last && timings[i]!.srcEnd <= w.start) i++;
      played.push({ seg: i, clip: s.clip, truth: w, fraction, outStart: toOut(i, Math.max(w.start, r.srcStart)), outEnd: toOut(i, Math.min(w.end, r.srcEnd)) });
      if (fraction < 0.999) truncated.push(`${s.id}: "${w.text}" ${(fraction * 100).toFixed(0)} % played (truth ${w.start.toFixed(3)}-${w.end.toFixed(3)}, span ${r.srcStart.toFixed(3)}-${r.srcEnd.toFixed(3)})`);
    }
  }
  played.sort((a, b) => a.outStart - b.outStart);
  const full = played.filter((p) => p.fraction >= 0.999);
  console.log(`  ${full.length} truth words fully played, ${truncated.length} partly:`);
  for (const t of truncated) console.log(`    ${t}`);
  // Margins between the cut and the nearest kept truth word.
  const margins: number[] = [];
  const marginText: string[] = [];
  for (const r of runs) {
    const ws = full.filter((p) => p.seg >= r.first && p.seg <= r.last);
    if (ws.length === 0) continue;
    const before = ws[0]!.truth.start - r.srcStart;
    const after = r.srcEnd - ws[ws.length - 1]!.truth.end;
    margins.push(before, after);
    marginText.push(`${edl.segments[r.first]!.id}${r.last > r.first ? `..${edl.segments[r.last]!.id}` : ""} ${Math.round(before * 1000)}/${Math.round(after * 1000)}`);
  }
  console.log(`  margin between each cut and the nearest truth word (before the first / after the last word of each continuous span), ms: ${marginText.join(", ")}`);
  console.log(`  smallest margin ${Math.round(Math.min(...margins) * 1000)} ms (docs/DIRECTOR.md asks 50-80 ms before the attack, 80-120 ms after the end)`);
  console.log(`  ${check(truncated.length === 0, "truncated words")} no truth word cut by a segment edge`);

  // ------------------------------------------------------------------ 3. audio placement
  console.log("\n== Audio placement (cross-correlation of each segment with its source audio)");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "reels-check-"));
  const outWav = path.join(tmp, "out16k.wav");
  await extractWav(video, 16000, outWav);
  const out = await readWavMono16(outWav);
  const SR = out.sampleRate;
  const offsets: number[] = [];
  for (let i = 0; i < edl.segments.length; i++) {
    const s = edl.segments[i]!;
    if (s.type !== "clip") continue;
    const t = timings[i]!;
    if (t.rate !== 1) {
      console.log(`  skip  ${s.id}: speed ${t.rate} (time-stretched audio does not correlate sample by sample)`);
      continue;
    }
    const src = await readWavMono16(path.join(paths.work, clipOf.get(s.clip)!.normalized.audio));
    // Inner part of the segment (avoid the edges, where AAC priming and the neighbours blend).
    const a0 = Math.round((t.fromFrame / FPS + 0.05) * SR);
    const a1 = Math.round(((t.fromFrame + t.durationInFrames) / FPS - 0.05) * SR);
    const a = out.samples.subarray(a0, a1);
    const expectedSrc = Math.round((t.srcStart + 0.05) * SR);
    const { lag, corr } = bestLag(a, src.samples, expectedSrc, Math.round(0.08 * SR));
    offsets.push(lag / SR);
    console.log(`  ${s.id.padEnd(12)} audio found ${ms(lag / SR)} from where the resolver placed it (correlation ${corr.toFixed(3)})`);
  }
  const worst = Math.max(...offsets.map(Math.abs));
  console.log(`  ${check(worst <= 0.002, "audio placement")} worst offset ${Math.round(worst * 1000)} ms`);

  // ------------------------------------------------------------------ 4. junctions
  console.log("\n== Junctions (audio level on each side of every cut: a cut inside a word or a breath is loud right at the junction)");
  const levels = frameLevels(out.samples, SR, 0.005);
  const floor = median([...levels].sort((x, y) => x - y).slice(0, Math.floor(levels.length * 0.1)));
  const speech = median(levels.filter((l) => l > floor + 25));
  const thr = floor + 15;
  let bad = 0;
  let residue = 0;
  const rows: string[] = [];
  for (let i = 1; i < edl.segments.length; i++) {
    const prev = edl.segments[i - 1]!;
    const cur = edl.segments[i]!;
    const contiguous = prev.type === "clip" && cur.type === "clip" && prev.clip === cur.clip && Math.abs(prev.out - cur.in) < 1e-6;
    const j = timings[i]!.fromFrame / FPS;
    const k = Math.round(j / 0.005);
    const before = Math.max(...levels.slice(k - 2, k));
    const after = Math.max(...levels.slice(k, k + 2));
    const before30 = Math.max(...levels.slice(k - 6, k));
    const after30 = Math.max(...levels.slice(k, k + 6));
    const quiet = before < thr && after < thr;
    const through = before >= thr && after >= thr;
    if (!contiguous && through) bad++;
    if (!contiguous && !quiet && !through) residue++;
    rows.push(`  ${contiguous ? "split" : quiet ? "quiet" : through ? "LOUD " : "sound"} ${prev.id} | ${cur.id} at ${j.toFixed(3)} s: max ${before.toFixed(1)} / ${after.toFixed(1)} dBFS within 10 ms, ${before30.toFixed(1)} / ${after30.toFixed(1)} within 30 ms`);
  }
  console.log(`  output noise floor ${floor.toFixed(1)} dBFS, median speech ${speech.toFixed(1)} dBFS, threshold ${thr.toFixed(1)} dBFS ("split" = framing change without a cut, not required to be quiet)`);
  for (const r of rows) console.log(r);
  console.log(`  ${check(bad === 0, "junctions")} ${bad} cut(s) through continuous sound (loud on both sides); ${residue} cut(s) with sound on one side only ("sound": a word attack, or the tail of a removed word when no silence separates it from the kept one)`);

  // ------------------------------------------------------------------ 5. re-transcription
  if (!args.includes("--no-transcribe")) {
    console.log("\n== Re-transcription of the output");
    const opts = defaultTranscribeOptions();
    const python = opts.python || path.join(REPO, ".venv", "bin", "python");
    const { stdout } = await run(python, [path.join(REPO, "src", "pipeline", "whisper.py"), outWav, "--model", opts.model, "--language", "fr", "--beam-size", "5", "--prompt", "Euh, bon, alors, euh... du coup, voilà, ben, hum."]);
    const hyp = mergeEngineWords((JSON.parse(stdout) as { words: { text: string; start: number; end: number; probability: number }[] }).words);
    const expected = full.map((p) => p.truth.text);
    const pairs = alignWords(expected.map(normalizeWord), hyp.map((w) => normalizeWord(w.text)));
    const mi = new Set(pairs.map(([i]) => i));
    const mj = new Set(pairs.map(([, j]) => j));
    console.log(`  expected: ${expected.join(" ")}`);
    console.log(`  heard   : ${hyp.map((w) => w.text).join(" ")}`);
    console.log(`  missing : ${expected.filter((_, i) => !mi.has(i)).join(" ") || "none"}; extra: ${hyp.filter((_, j) => !mj.has(j)).map((w) => w.text).join(" ") || "none"}`);
    console.log(`  ${check(pairs.length >= expected.length - 3, "re-transcription")} ${pairs.length}/${expected.length} expected words heard (${opts.model})`);
  }

  // ------------------------------------------------------------------ 6. captions
  if (pages.length > 0) {
    console.log("\n== Captions: highlighted word on every output frame against the truth");
    const style = resolved.captionStyle;
    const y0 = Math.floor(Math.min(...pages.map((p) => p.box.y)));
    const y1 = Math.ceil(Math.max(...pages.map((p) => p.box.y + p.box.height)));
    const scale = 0.5;
    const band = await bandFrames(video, y0, y1 - y0, scale);
    // Token x ranges from the resolved layout (same metrics as the resolver).
    const font = resolved.brand.fonts.caption;
    const tokenBoxes = (p: ResolvedCaptionPage) =>
      p.lines.flatMap((line, li) => {
        const space = measureText(" ", font, p.fontSize, style.letterSpacing) + style.wordSpacing * p.fontSize;
        const lw = line.reduce((s, t) => s + t.width, 0) + space * (line.length - 1);
        let x = 540 - lw / 2;
        const lineTop = p.box.y + style.outlineWidth + li * p.fontSize * style.lineHeight;
        return line.map((t) => {
          const b = { token: t, x0: x, x1: x + t.width, y0: lineTop, y1: lineTop + p.fontSize * style.lineHeight };
          x += t.width + space;
          return b;
        });
      });
    // Active colour of the brand (yellow): far from the text white, the accent cyan and the footage.
    const active = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(resolved.brand.colors.active)!;
    const [ar, ag, ab] = [1, 2, 3].map((k) => parseInt(active[k]!, 16));
    const isActive = (r: number, g: number, b: number) => Math.abs(r - ar!) < 40 && Math.abs(g - ag!) < 40 && Math.abs(b - ab!) < 45;
    const shown: (string | null)[] = band.frames.map((buf, f) => {
      const page = pages.find((p) => f >= p.fromFrame && f < p.fromFrame + p.durationInFrames);
      if (!page) return null;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y < band.height; y++)
        for (let x = 0; x < band.width; x++) {
          const o = (y * band.width + x) * 3;
          if (isActive(buf[o]!, buf[o + 1]!, buf[o + 2]!)) {
            sx += x;
            sy += y;
            n++;
          }
        }
      if (n < 25) return null;
      // Undo the page entrance (the page grows around the centre of its box).
      const p = Math.min(1, (f - page.fromFrame) / style.enterFrames);
      const grow = style.enterScale + (1 - style.enterScale) * (1 - (1 - p) ** 3);
      const bx = page.box.x + page.box.width / 2;
      const by = page.box.y + page.box.height / 2;
      const cx = bx + (sx / n / scale - bx) / grow;
      const cy = by + (sy / n / scale + y0 - by) / grow;
      const hit = tokenBoxes(page).find((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 - 20 && cy <= b.y1 + 20);
      return hit ? hit.token.word : "?";
    });
    // Truth word of each analysis word id (alignment of the transcript with the truth, per clip).
    const truthById = new Map<string, TruthWord>();
    for (const c of probe.clips) {
      const tw = truthOf.get(c.id)!.words;
      const hw = transcript.words.filter((w) => w.clip === c.id);
      for (const [i, j] of alignWords(tw.map((w) => normalizeWord(w.text)), hw.map((w) => normalizeWord(w.text)))) truthById.set(hw[j]!.id, tw[i]!);
    }
    const analysisById = new Map(analysis.words.map((w) => [w.id, w]));
    const onsetErrors: { word: string; text: string; err: number; expectedErr: number }[] = [];
    let skipped = 0;
    let rendererMismatch = 0;
    for (const p of pages)
      for (const t of p.lines.flat()) {
        if (t.emphasis === "color" || t.emphasis === "box") {
          skipped++;
          continue;
        }
        const first = shown.findIndex((w, f) => w === t.word && f >= p.fromFrame && f < p.fromFrame + p.durationInFrames);
        const tw = truthById.get(t.word);
        const kept = v.kept.get(t.word);
        if (first < 0 || !tw || !kept) {
          skipped++;
          continue;
        }
        if (first !== t.fromFrame) {
          rendererMismatch++;
          console.log(`  ${t.text} (${t.word}): highlighted from frame ${first}, resolver says ${t.fromFrame}`);
        }
        const segIdx = edl.segments.findIndex((s) => s.id === kept.segment);
        const truthOut = toOut(segIdx, Math.max(tw.start, timings[segIdx]!.srcStart));
        const aw = analysisById.get(t.word)!;
        const analysisOut = toOut(segIdx, Math.max(aw.start, timings[segIdx]!.srcStart));
        onsetErrors.push({ word: t.word, text: t.text, err: first / FPS - truthOut, expectedErr: analysisOut - truthOut });
      }
    const errs = onsetErrors.map((e) => e.err);
    const abs = errs.map(Math.abs);
    console.log(`  ${onsetErrors.length} words measured (${skipped} skipped: emphasis drawn in the accent colour or on a box, or a word without truth)`);
    console.log(`  ${check(rendererMismatch === 0, "caption frames")} highlight appears on the frame the resolver gave: ${onsetErrors.length - rendererMismatch}/${onsetErrors.length}`);
    console.log(
      `  highlight onset minus truth onset: median ${ms(median(errs))}, median |d| ${Math.round(median(abs) * 1000)} ms, ` +
        `within ±1 frame (33 ms) ${abs.filter((d) => d <= 1 / 30 + 1e-6).length}/${abs.length}, within ±50 ms ${abs.filter((d) => d <= 0.05 + 1e-6).length}/${abs.length}, ` +
        `within ±100 ms ${abs.filter((d) => d <= 0.1 + 1e-6).length}/${abs.length}, worst ${ms(errs[abs.indexOf(Math.max(...abs))]!)}`,
    );
    const worstFive = [...onsetErrors].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 5);
    console.log(`  largest: ${worstFive.map((e) => `${e.text} ${ms(e.err)} (analysis bound ${ms(e.expectedErr)})`).join(", ")}`);
    // At the middle of every truth word kept fully, is the highlighted word that word?
    let mid = 0;
    let midOk = 0;
    const idOfTruth = new Map([...truthById.entries()].map(([id, tw]) => [tw, id]));
    for (const p of full) {
      const id = idOfTruth.get(p.truth);
      if (!id) continue;
      const tok = pages.flatMap((pg) => pg.lines.flat()).find((t) => t.word === id);
      if (!tok || tok.emphasis === "color" || tok.emphasis === "box") continue;
      const f = Math.floor(((p.outStart + p.outEnd) / 2) * FPS);
      mid++;
      if (shown[f] === id) midOk++;
    }
    console.log(`  ${check(midOk >= mid * 0.9, "caption sync")} at the middle of each spoken word, the highlighted word is that word: ${midOk}/${mid}`);
  }

  // ------------------------------------------------------------------ 7. A/V sync
  const claps: { seg: string; clip: string; clap: number; out: number }[] = [];
  edl.segments.forEach((s, i) => {
    if (s.type !== "clip") return;
    for (const c of truthOf.get(s.clip)!.claps) if (c > timings[i]!.srcStart + 0.05 && c < timings[i]!.srcEnd - 0.12) claps.push({ seg: s.id, clip: s.clip, clap: c, out: toOut(i, c) });
  });
  if (claps.length > 0) {
    console.log("\n== A/V sync at the claps (flash on video, beep in audio), output against source");
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", video, "-an", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
    const luma: number[] = [];
    for (const line of stdout.split("\n")) {
      const y = /YAVG=([\d.]+)/.exec(line);
      if (y?.[1]) luma.push(Number(y[1]));
    }
    const out48 = path.join(tmp, "out48k.wav");
    await extractWav(video, 48000, out48);
    const o48 = await readWavMono16(out48);
    const beepAt = (samples: Float32Array, sr: number, around: number): number => {
      for (let i = Math.max(0, Math.floor((around - 0.15) * sr)); i < samples.length; i++) if (Math.abs(samples[i]!) > 0.2) return i / sr;
      return NaN;
    };
    // The beep is the loudest thing in the output after normalization; use a relative threshold.
    const peak = o48.samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    const beepOut = (around: number): number => {
      for (let i = Math.max(0, Math.floor((around - 0.15) * 48000)); i < o48.samples.length; i++) if (Math.abs(o48.samples[i]!) > peak * 0.4) return i / 48000;
      return NaN;
    };
    let worstDiff = 0;
    for (const c of claps) {
      const seg = edl.segments.find((s) => s.id === c.seg) as Extract<Edl["segments"][number], { type: "clip" }>;
      const i = edl.segments.indexOf(seg);
      const flashF = luma.findIndex((y, f) => y > 200 && Math.abs(f / FPS - c.out) < 0.25);
      const flash = flashF / FPS;
      const beep = beepOut(c.out);
      // Same measurement in the source clip.
      const srcVideo = path.join(paths.work, clipOf.get(c.clip)!.normalized.video);
      const { stdout: sl } = await run("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, c.clap - 0.3)), "-t", "0.6", "-i", srcVideo, "-an", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
      const sluma = sl.split("\n").map((l) => /YAVG=([\d.]+)/.exec(l)?.[1]).filter((x): x is string => x !== undefined).map(Number);
      // The first decoded frame is the first one at or after the seek point.
      const srcFlash = Math.ceil(Math.max(0, c.clap - 0.3) * FPS - 1e-6) / FPS + sluma.findIndex((y) => y > 200) / FPS;
      const srcAudio = await readWavMono16(path.join(paths.work, clipOf.get(c.clip)!.normalized.audio));
      const srcBeep = beepAt(srcAudio.samples, srcAudio.sampleRate, c.clap);
      const outOffset = flash - beep;
      const srcOffset = srcFlash - srcBeep;
      // The source's own offset is kept; at speed s a source frame lasts 1/s output frame,
      // so the flash may land up to one output frame from its exact place.
      const diff = outOffset - srcOffset / timings[i]!.rate;
      worstDiff = Math.max(worstDiff, Math.abs(diff));
      console.log(
        `  ${c.seg.padEnd(11)} speed ${timings[i]!.rate}: output flash ${flash.toFixed(3)} s, beep ${beep.toFixed(3)} s, video - audio ${ms(outOffset)}; ` +
          `in the source ${ms(srcOffset)}; change ${ms(diff)}`,
      );
    }
    console.log(`  ${check(worstDiff <= 1 / 30 + 0.002, "A/V sync")} worst change of the A/V offset through the montage: ${Math.round(worstDiff * 1000)} ms (one frame = 33 ms)`);
  }

  // ------------------------------------------------------------------ 8. framing
  if (truth.markers && truth.markers.length > 0) {
    console.log("\n== Framing: red dot of each target in the first frame of every segment (predicted by the crop geometry)");
    let worstPx = 0;
    let edgeBars = 0;
    for (let i = 0; i < resolved.segments.length; i++) {
      const s = resolved.segments[i]! as ResolvedClipSegment;
      if (s.type !== "clip") continue;
      const f = s.fromFrame + 1;
      const rgb = await frameRgb(video, f);
      const st = framingAt(s.framing, 1, s.durationInFrames);
      const crop = cropRect({ width: s.sourceWidth, height: s.sourceHeight }, { width: 1080, height: 1920 }, st.scale, st.origin);
      const k = 1080 / crop.width;
      const parts: string[] = [];
      for (const m of truth.markers) {
        const px = (m.px[0] - crop.x) * k;
        const py = (m.px[1] - crop.y) * k;
        // Only targets whose whole ring is on screen and not under a caption page.
        const half = ((m.name === "A" ? 160 : 120) / 2) * k;
        const ring = { x0: px - half, x1: px + half, y0: py - half, y1: py + half };
        if (ring.x0 < 0 || ring.x1 > 1080 || ring.y0 < 0 || ring.y1 > 1920) {
          parts.push(`${m.name} partly off screen`);
          continue;
        }
        const covered = pages.some((p) => f >= p.fromFrame && f < p.fromFrame + p.durationInFrames && ring.x1 > p.box.x && ring.x0 < p.box.x + p.box.width && ring.y1 > p.box.y && ring.y0 < p.box.y + p.box.height);
        if (covered) {
          parts.push(`${m.name} under the captions`);
          continue;
        }
        // Centroid of red pixels within 24 px of the prediction: the 12 px dot (the red inner
        // ring is 30 px or more from the centre).
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let y = Math.max(0, Math.round(py - 24)); y < Math.min(1920, Math.round(py + 24)); y++)
          for (let x = Math.max(0, Math.round(px - 24)); x < Math.min(1080, Math.round(px + 24)); x++) {
            const o = (y * 1080 + x) * 3;
            if (rgb[o]! > 200 && rgb[o + 1]! < 70 && rgb[o + 2]! < 70) {
              sx += x;
              sy += y;
              n++;
            }
          }
        if (n < 40) {
          parts.push(`${m.name}: dot not found near (${Math.round(px)}, ${Math.round(py)})`);
          worstPx = Infinity;
          continue;
        }
        const dx = sx / n + 0.5 - px;
        const dy = sy / n + 0.5 - py;
        worstPx = Math.max(worstPx, Math.hypot(dx, dy));
        parts.push(`${m.name} at (${(sx / n + 0.5).toFixed(1)}, ${(sy / n + 0.5).toFixed(1)}) predicted (${px.toFixed(1)}, ${py.toFixed(1)})`);
      }
      // Black bars: any dark column or row along the frame edges.
      const edge = (x: number, y: number) => {
        const o = (y * 1080 + x) * 3;
        return rgb[o]! + rgb[o + 1]! + rgb[o + 2]! < 30;
      };
      let dark = 0;
      for (let y = 0; y < 1920; y += 8) if (edge(0, y) || edge(1079, y)) dark++;
      for (let x = 0; x < 1080; x += 8) if (edge(x, 0) || edge(x, 1919)) dark++;
      if (dark > 0) edgeBars++;
      const origin = edl.segments[i]!.type === "clip" ? (edl.segments[i] as Extract<Edl["segments"][number], { type: "clip" }>).framing.origin : null;
      const centred = origin ? `origin (${origin.x}, ${origin.y}) → frame centre shows source (${((crop.x + crop.width / 2) / s.sourceWidth).toFixed(3)}, ${((crop.y + crop.height / 2) / s.sourceHeight).toFixed(3)})` : "";
      console.log(`  ${s.id.padEnd(12)} scale ${st.scale.toFixed(3)} ${centred}${crop.shifted ? " [shifted to stay inside]" : ""}; ${parts.join("; ")}; dark edge samples ${dark}`);
    }
    console.log(`  ${check(worstPx <= 3, "framing")} worst distance between a dot and its prediction ${worstPx.toFixed(1)} px`);
    console.log(`  ${check(edgeBars === 0, "black bars")} ${edgeBars} segment(s) with dark pixels on a frame edge`);
  }

  await rm(tmp, { recursive: true, force: true });
  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed: ${failures.join("; ")}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
