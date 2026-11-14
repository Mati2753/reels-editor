/**
 * Compares the facts produced by ingest / transcribe / analyze with the ground truth
 * written by scripts/synthetic/generate.py. Regression check for phase 1.
 *
 *   npx tsx scripts/synthetic/check.ts <slug> [--all-words]
 *
 * Prints one section per category and exits with code 1 if a tolerance is not met.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../../src/pipeline/util/exec";
import { readWavMono16 } from "../../src/pipeline/analysis/audio";
import { AnalysisSchema, ProbeSchema, TranscriptSchema, type Analysis } from "../../src/pipeline/schemas";
import { normalizeWord } from "../../src/pipeline/words";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const WORD_TOLERANCE = 0.05;
const BOUNDARY_TOLERANCE = 0.1;

interface TruthWord {
  text: string;
  start: number;
  end: number;
  utterance: number;
}
interface TruthClip {
  file: string;
  duration: number;
  claps: number[];
  cuts: number[];
  rotation: number;
  utterances: { index: number; text: string; start: number; end: number; abandoned: boolean }[];
  words: TruthWord[];
}
interface Truth {
  clapSeconds: number;
  noiseDbfs: number;
  fillerWords: string[];
  fillerPhrases: string[];
  clips: TruthClip[];
}

const failures: string[] = [];
const check = (ok: boolean, label: string): string => {
  if (!ok) failures.push(label);
  return ok ? "OK  " : "FAIL";
};
const f3 = (n: number): string => (n >= 0 ? "+" : "") + n.toFixed(3);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? NaN : s.length % 2 ? (s[m] ?? NaN) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** Longest common subsequence of normalized texts: pairs (truth index, hypothesis index). */
function alignWords(a: string[], b: string[]): [number, number][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
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

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }): number =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

async function flashes(video: string): Promise<number[]> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", video, "-an", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
  const out: number[] = [];
  let prev = false;
  let t = 0;
  for (const line of stdout.split("\n")) {
    const p = /pts_time:([\d.]+)/.exec(line);
    if (p?.[1]) t = Number(p[1]);
    const y = /YAVG=([\d.]+)/.exec(line);
    if (y?.[1]) {
      const on = Number(y[1]) > 200;
      if (on && !prev) out.push(t);
      prev = on;
    }
  }
  return out;
}

async function frameIntervals(video: string): Promise<{ min: number; max: number; n: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", video]);
  const pts = stdout.split("\n").map(Number.parseFloat).filter(Number.isFinite).sort((a, b) => a - b);
  let min = Infinity;
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i]! - pts[i - 1]!;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max, n: pts.length };
}

/** First sample after `from` whose amplitude exceeds 0.2 (the clap beep is a 0.5 sine after silence). */
async function beepOnset(wav: string, around: number): Promise<number> {
  const { samples, sampleRate } = await readWavMono16(wav);
  for (let i = Math.max(0, Math.floor((around - 0.2) * sampleRate)); i < samples.length; i++) if (Math.abs(samples[i] ?? 0) > 0.2) return i / sampleRate;
  return NaN;
}

async function main(): Promise<void> {
  const slug = process.argv[2] ?? "demo";
  const allWords = process.argv.includes("--all-words");
  const dir = path.join(REPO, "projects", slug);
  const work = path.join(dir, "work");
  const truth = JSON.parse(await readFile(path.join(dir, "truth.json"), "utf8")) as Truth;
  const probe = ProbeSchema.parse(JSON.parse(await readFile(path.join(work, "probe.json"), "utf8")));
  const transcript = TranscriptSchema.parse(JSON.parse(await readFile(path.join(work, "transcript.json"), "utf8")));
  const analysis: Analysis = AnalysisSchema.parse(JSON.parse(await readFile(path.join(work, "analysis.json"), "utf8")));
  const clipOf = new Map(probe.clips.map((c) => [c.file, c]));

  console.log(`Synthetic check of projects/${slug} (engine ${transcript.engine.name}, model ${transcript.engine.model})\n`);

  // ------------------------------------------------------------- 1. normalization
  console.log("== Normalization (30 fps CFR, rotation, A/V sync)");
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) {
      console.log(`  ${check(false, `clip ${tc.file} missing`)} ${tc.file}: not ingested`);
      continue;
    }
    const video = path.join(work, clip.normalized.video);
    const iv = await frameIntervals(video);
    const cfr = Math.abs(iv.min - 1 / 30) < 1e-4 && Math.abs(iv.max - 1 / 30) < 1e-4;
    console.log(
      `  ${check(cfr, `${clip.id} not CFR`)} ${clip.id} ${tc.file}: raw ${clip.raw.width}x${clip.raw.height} rot ${clip.raw.rotation} ` +
        `${clip.raw.variableFrameRate ? "VFR" : "CFR"} ${clip.raw.fps} fps (intervals ${clip.raw.frameInterval.min}-${clip.raw.frameInterval.max} s) ` +
        `-> ${clip.normalized.width}x${clip.normalized.height}, ${iv.n} frames, intervals ${iv.min.toFixed(5)}-${iv.max.toFixed(5)} s`,
    );
    const upright = clip.normalized.height > clip.normalized.width;
    console.log(`  ${check(upright && clip.raw.rotation === tc.rotation, `${clip.id} rotation`)} ${clip.id} rotation in metadata ${clip.raw.rotation} (truth ${tc.rotation}), output portrait: ${upright}`);
    const fl = await flashes(video);
    for (const clap of tc.claps) {
      const flash = fl.find((t) => Math.abs(t - clap) < 0.2) ?? NaN;
      const beep = await beepOnset(path.join(work, clip.normalized.audio), clap);
      const offset = flash - beep;
      // The flash shows from the first source frame at or after the clap (up to one source
      // frame late), then fps=30 takes the nearest source frame (up to half an output frame
      // either way). Anything beyond that is drift.
      const sourceFrame = 1 / Math.min(clip.raw.fps, 30);
      const ok = offset >= -1 / 60 - 0.002 && offset <= sourceFrame + 1 / 60 + 0.002;
      console.log(`  ${check(ok, `${clip.id} sync at ${clap}`)} ${clip.id} clap ${clap.toFixed(3)} s: flash on video ${flash.toFixed(3)} s, beep in audio.wav ${beep.toFixed(3)} s, video - audio ${f3(offset)} s`);
    }
  }

  // ------------------------------------------------------------- 2. words
  console.log("\n== Words (recognition and timing)");
  const refinedById = new Map(analysis.words.map((w) => [w.id, w]));
  const timing: { truth: TruthWord; clip: string; id: string; text: string; raw: { start: number; end: number }; ref: { start: number; end: number } }[] = [];
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) continue;
    const hyp = transcript.words.filter((w) => w.clip === clip.id);
    const pairs = alignWords(tc.words.map((w) => normalizeWord(w.text)), hyp.map((w) => normalizeWord(w.text)));
    const matched = new Set(pairs.map(([i]) => i));
    const missing = tc.words.filter((_, i) => !matched.has(i)).map((w) => w.text);
    console.log(`  ${clip.id}: ${pairs.length}/${tc.words.length} truth words recognised identically; ${hyp.length} words transcribed. Not matched: ${missing.join(" ") || "none"}`);
    for (const [i, j] of pairs) {
      const h = hyp[j]!;
      const r = refinedById.get(h.id) ?? h;
      timing.push({ truth: tc.words[i]!, clip: clip.id, id: h.id, text: h.text, raw: { start: h.start, end: h.end }, ref: { start: r.start, end: r.end } });
    }
  }
  const stats = (pick: "raw" | "ref"): string => {
    const ds = timing.map((t) => t[pick].start - t.truth.start);
    const de = timing.map((t) => t[pick].end - t.truth.end);
    const both = timing.filter((t) => Math.abs(t[pick].start - t.truth.start) <= WORD_TOLERANCE && Math.abs(t[pick].end - t.truth.end) <= WORD_TOLERANCE).length;
    const abs = (xs: number[]): number[] => xs.map(Math.abs);
    return (
      `start: mean ${f3(mean(ds))} median|d| ${median(abs(ds)).toFixed(3)} max|d| ${Math.max(...abs(ds)).toFixed(3)} within ±${WORD_TOLERANCE}: ${abs(ds).filter((d) => d <= WORD_TOLERANCE).length}/${ds.length}; ` +
      `end: mean ${f3(mean(de))} median|d| ${median(abs(de)).toFixed(3)} max|d| ${Math.max(...abs(de)).toFixed(3)} within: ${abs(de).filter((d) => d <= WORD_TOLERANCE).length}/${de.length}; both bounds within: ${both}/${timing.length}`
    );
  };
  console.log(`  Whisper bounds  ${stats("raw")}`);
  console.log(`  Refined bounds  ${stats("ref")}`);

  // Ten words spread evenly over the matched ones, as the roadmap asks.
  const ten = Array.from({ length: Math.min(10, timing.length) }, (_, k) => timing[Math.floor((k * timing.length) / Math.min(10, timing.length))]!);
  const shown = allWords ? timing : ten;
  console.log(`  ${allWords ? "All matched words" : "Ten words spread over the footage"} (truth -> refined, whisper in brackets):`);
  let tenOk = 0;
  for (const t of shown) {
    const ds = t.ref.start - t.truth.start;
    const de = t.ref.end - t.truth.end;
    const ok = Math.abs(ds) <= WORD_TOLERANCE && Math.abs(de) <= WORD_TOLERANCE;
    if (ten.includes(t) && ok) tenOk++;
    console.log(
      `    ${ok ? "ok  " : "out "} ${t.clip} ${t.id.padEnd(4)} ${t.text.padEnd(14)} truth ${t.truth.start.toFixed(3)}-${t.truth.end.toFixed(3)}  ` +
        `got ${t.ref.start.toFixed(3)}-${t.ref.end.toFixed(3)} (d ${f3(ds)} / ${f3(de)})  [whisper ${f3(t.raw.start - t.truth.start)} / ${f3(t.raw.end - t.truth.end)}]`,
    );
  }
  console.log(`  ${check(tenOk === ten.length, "word timing")} ${tenOk}/${ten.length} of the ten words have both bounds within ±${WORD_TOLERANCE} s`);

  // ------------------------------------------------------------- 3. silences
  console.log("\n== Silences (truth: pauses between truth words, claps excluded, >= minSilence)");
  const minSilence = analysis.params.minSilence;
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) continue;
    const busy = [...tc.words.map((w) => ({ start: w.start, end: w.end })), ...tc.claps.map((c) => ({ start: c, end: c + truth.clapSeconds }))].sort((a, b) => a.start - b.start);
    const gaps: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const b of busy) {
      if (b.start - cursor >= minSilence) gaps.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (clip.normalized.duration - cursor >= minSilence) gaps.push({ start: cursor, end: clip.normalized.duration });
    const got = analysis.silences.filter((s) => s.clip === clip.id);
    let hits = 0;
    for (const g of gaps) {
      const m = got.find((s) => overlap(s, g) > 0.5 * (g.end - g.start));
      if (m) hits++;
      console.log(
        `  ${m ? "found " : "MISSED"} ${clip.id} ${g.start.toFixed(3)}-${g.end.toFixed(3)} (${(g.end - g.start).toFixed(2)} s)` +
          (m ? `  -> ${m.id} ${m.start.toFixed(3)}-${m.end.toFixed(3)} (d ${f3(m.start - g.start)} / ${f3(m.end - g.end)})` : ""),
      );
    }
    const extra = got.filter((s) => !gaps.some((g) => overlap(s, g) > 0));
    for (const e of extra) console.log(`  EXTRA  ${clip.id} ${e.id} ${e.start}-${e.end}`);
    console.log(`  ${check(hits === gaps.length && extra.length === 0, `${clip.id} silences`)} ${clip.id}: ${hits}/${gaps.length} truth silences found, ${extra.length} extra`);
  }

  // ------------------------------------------------------------- 4. shots and transients
  console.log("\n== Shots (truth: cuts) and transients (truth: clap flashes)");
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) continue;
    const cuts = analysis.shots.filter((s) => s.clip === clip.id && s.start > 0).map((s) => s.start);
    const ok = cuts.length === tc.cuts.length && tc.cuts.every((c, i) => Math.abs((cuts[i] ?? NaN) - c) <= 1 / 30 + 1e-3);
    console.log(`  ${check(ok, `${clip.id} shots`)} ${clip.id}: truth cuts [${tc.cuts.map((c) => c.toFixed(3)).join(", ")}], detected [${cuts.join(", ")}]`);
    const tr = analysis.transients.filter((t) => t.clip === clip.id);
    const trOk = tr.length === tc.claps.length && tc.claps.every((c) => tr.some((t) => Math.abs(t.start - c) <= 0.07));
    console.log(`  ${check(trOk, `${clip.id} transients`)} ${clip.id}: truth flashes at [${tc.claps.join(", ")}], transients [${tr.map((t) => `${t.start}-${t.end}`).join(", ")}]`);
  }

  // ------------------------------------------------------------- 5. loudness
  // The generator's levels do not survive AAC and the mono-to-stereo upmix of b-outro.mov
  // (-3 dB), so levels are checked against independent ffmpeg measurements instead:
  // the RMS curve against astats over the same 100 ms windows, the integrated loudness
  // against the loudnorm filter (a separate BS.1770 implementation from ebur128).
  console.log("\n== Loudness (against independent measurements: astats per 100 ms, loudnorm)");
  for (const l of analysis.loudness) {
    const clip = probe.clips.find((c) => c.id === l.clip)!;
    const expectedPoints = Math.ceil(clip.normalized.duration / 0.1 - 1e-9);
    const { stdout } = await run("ffmpeg", ["-v", "error", "-i", path.join(work, clip.normalized.audio), "-af", "asetnsamples=n=1600:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"]);
    const ref = [...stdout.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -90 : Math.max(-90, Number(m[1]))));
    let maxDiff = 0;
    for (let i = 0; i < Math.min(ref.length, l.rms.db.length) - 1; i++) maxDiff = Math.max(maxDiff, Math.abs((ref[i] ?? 0) - (l.rms.db[i] ?? 0)));
    const ln = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", path.join(work, clip.normalized.video), "-map", "0:a:0", "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
    const inputI = Number(/"input_i" : "(-?[\d.]+)"/.exec(ln.stderr)?.[1]);
    const inputTp = Number(/"input_tp" : "(-?[\d.]+)"/.exec(ln.stderr)?.[1]);
    const quiet = analysis.silences.filter((s) => s.clip === l.clip).flatMap((s) => l.rms.db.slice(Math.ceil(s.start / 0.1) + 1, Math.floor(s.end / 0.1) - 1));
    const ok = l.rms.db.length === expectedPoints && maxDiff <= 0.2 && l.integratedLufs !== null && Math.abs(l.integratedLufs - inputI) <= 0.5 && l.truePeakDb !== null && Math.abs(l.truePeakDb - inputTp) <= 0.5;
    console.log(
      `  ${check(ok, `${l.clip} loudness`)} ${l.clip}: integrated ${l.integratedLufs} LUFS (loudnorm ${inputI}), true peak ${l.truePeakDb} dBFS (loudnorm ${inputTp}), LRA ${l.loudnessRange} LU; ` +
        `RMS curve ${l.rms.db.length} points for ${clip.normalized.duration} s (expected ${expectedPoints}), max difference with astats ${maxDiff.toFixed(2)} dB`,
    );
    console.log(`       ${l.clip}: median RMS inside silences ${median(quiet).toFixed(1)} dBFS (generator noise ${truth.noiseDbfs} dBFS before AAC), silence threshold ${l.silenceThresholdDb} dBFS`);
  }

  // ------------------------------------------------------------- 6. fillers
  console.log("\n== Fillers (truth: 'euh', 'voilà', 'du coup', immediate repetition)");
  const truthFillers: { clip: string; start: number; end: number; text: string }[] = [];
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) continue;
    const n = tc.words.map((w) => normalizeWord(w.text));
    tc.words.forEach((w, i) => {
      if (truth.fillerWords.includes(n[i]!)) truthFillers.push({ clip: clip.id, start: w.start, end: w.end, text: w.text });
      for (const phrase of truth.fillerPhrases) {
        const parts = phrase.split(" ");
        if (parts.every((p, k) => n[i + k] === p)) truthFillers.push({ clip: clip.id, start: w.start, end: tc.words[i + parts.length - 1]!.end, text: phrase });
      }
      for (let size = 1; size <= 3; size++) {
        const a = n.slice(i, i + size).join(" ");
        const b = n.slice(i + size, i + 2 * size).join(" ");
        const sameUtt = tc.words.slice(i, i + 2 * size).every((x) => x.utterance === w.utterance);
        if (i + 2 * size <= n.length && a === b && sameUtt) {
          truthFillers.push({ clip: clip.id, start: w.start, end: tc.words[i + size - 1]!.end, text: `${a} (repeated)` });
          break;
        }
      }
    });
  }
  let fHits = 0;
  for (const t of truthFillers) {
    const m = analysis.fillers.find((f) => f.clip === t.clip && overlap(f, t) > 0);
    if (m) fHits++;
    console.log(`  ${m ? "found " : "MISSED"} ${t.clip} ${t.text.padEnd(22)} ${t.start.toFixed(3)}-${t.end.toFixed(3)}${m ? `  -> ${m.id} ${m.kind} "${m.text}" ${m.start}-${m.end}` : ""}`);
  }
  const fExtra = analysis.fillers.filter((f) => !truthFillers.some((t) => t.clip === f.clip && overlap(f, t) > 0));
  for (const e of fExtra) console.log(`  EXTRA  ${e.clip} ${e.id} ${e.kind} "${e.text}"`);
  console.log(`  ${check(fHits === truthFillers.length && fExtra.length === 0, "fillers")} ${fHits}/${truthFillers.length} found, ${fExtra.length} extra`);

  // ------------------------------------------------------------- 7. retakes
  console.log("\n== Retakes (truth: abandoned utterances)");
  let rHits = 0;
  let rTotal = 0;
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) continue;
    for (const u of tc.utterances.filter((x) => x.abandoned)) {
      rTotal++;
      const next = tc.utterances.find((x) => x.index === u.index + 1);
      const m = analysis.retakes.find((r) => r.clip === clip.id && overlap(r.attempt, u) > 0);
      const restartOk = m && next ? Math.abs(m.restart.start - next.start) <= BOUNDARY_TOLERANCE : false;
      if (m && restartOk) rHits++;
      console.log(
        `  ${m && restartOk ? "found " : "MISSED"} ${clip.id} "${u.text}" ${u.start.toFixed(3)}-${u.end.toFixed(3)}, restart at ${next?.start.toFixed(3)}` +
          (m ? `  -> ${m.id} attempt ${m.attempt.start}-${m.attempt.end} "${m.attempt.text}", restart ${m.restart.start} (${m.matchedWords} words match)` : ""),
      );
    }
  }
  const rExtra = analysis.retakes.filter((r) => !truth.clips.some((tc) => tc.utterances.some((u) => u.abandoned && clipOf.get(tc.file)?.id === r.clip && overlap(r.attempt, u) > 0)));
  for (const e of rExtra) console.log(`  EXTRA  ${e.id} "${e.attempt.text}"`);
  console.log(`  ${check(rHits === rTotal && rExtra.length === 0, "retakes")} ${rHits}/${rTotal} found, ${rExtra.length} extra`);

  // ------------------------------------------------------------- 8. sentences
  // Sentences follow Whisper's punctuation; an utterance may come out as one sentence or be
  // split where Whisper put a full stop on a short pause. Both are reported; the outer
  // bounds must match the utterance and no sentence may straddle two utterances.
  console.log("\n== Sentences (truth: utterances)");
  for (const tc of truth.clips) {
    const clip = clipOf.get(tc.file);
    if (!clip) continue;
    const got = analysis.sentences.filter((s) => s.clip === clip.id);
    let ok = true;
    for (const u of tc.utterances) {
      const parts = got.filter((s) => overlap(s, u) > 0);
      const first = parts[0];
      const last = parts[parts.length - 1];
      const straddles = parts.some((s) => s.start < u.start - BOUNDARY_TOLERANCE || s.end > u.end + BOUNDARY_TOLERANCE);
      const good = first !== undefined && last !== undefined && !straddles && Math.abs(first.start - u.start) <= BOUNDARY_TOLERANCE && Math.abs(last.end - u.end) <= BOUNDARY_TOLERANCE;
      ok &&= good;
      const how = parts.length === 1 ? "1 sentence" : `${parts.length} sentences (split by Whisper's punctuation)`;
      console.log(`  ${good ? "ok  " : "out "} ${clip.id} truth ${u.start.toFixed(3)}-${u.end.toFixed(3)} "${u.text}" -> ${how}`);
      for (const p of parts) console.log(`         ${p.id} ${p.start.toFixed(3)}-${p.end.toFixed(3)} "${p.text}"`);
      if (first && last) console.log(`         outer bounds d ${f3(first.start - u.start)} / ${f3(last.end - u.end)}`);
    }
    console.log(`  ${check(ok, `${clip.id} sentences`)} ${clip.id}: ${got.length} sentences for ${tc.utterances.length} utterances (outer bounds within ±${BOUNDARY_TOLERANCE} s, none straddling)`);
  }

  // ------------------------------------------------------------- 9. key frames
  console.log("\n== Key frames (one per sentence and per shot)");
  const expected = analysis.sentences.length + analysis.shots.length;
  const missingFiles: string[] = [];
  for (const f of analysis.frames) {
    try {
      await readFile(path.join(work, f.file));
    } catch {
      missingFiles.push(f.file);
    }
  }
  console.log(`  ${check(analysis.frames.length === expected && missingFiles.length === 0, "frames")} ${analysis.frames.length} key frames for ${analysis.sentences.length} sentences + ${analysis.shots.length} shots, ${missingFiles.length} file(s) missing`);

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed: ${failures.join("; ")}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
