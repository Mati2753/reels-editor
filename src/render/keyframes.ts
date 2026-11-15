import type { ResolvedEdl } from "../edl/resolved";

export interface PreviewFrame {
  frame: number;
  reasons: string[];
}

/**
 * Instants worth a still in `reels preview` (docs/ARCHITECTURE.md, Validation, aperçu,
 * rendu): the start of every segment (a few frames in, where a punch-in shows), the end of
 * every progressive zoom, the first caption page, every emphasised or corrected word while
 * it is spoken, the start, cut and end of every transition, the first frame of every
 * overlay, its settled state and each of its cues, the largest caption page (safe zone),
 * and the last frame.
 */
export function previewFrames(edl: ResolvedEdl, overridden: ReadonlySet<string> = new Set()): PreviewFrame[] {
  const at = new Map<number, string[]>();
  const add = (frame: number, reason: string) => {
    const f = Math.min(Math.max(0, frame), Math.max(0, edl.durationInFrames - 1));
    at.set(f, [...(at.get(f) ?? []), reason]);
  };
  for (const s of edl.segments) {
    add(s.fromFrame + Math.min(2, Math.max(0, s.durationInFrames - 1)), `start of ${s.id}`);
    if (s.type === "clip" && s.framing.move) add(s.fromFrame + s.durationInFrames - 1, `end of the zoom of ${s.id}`);
  }
  const pages = edl.captions.enabled ? edl.captions.pages : [];
  const first = pages[0];
  if (first) add(first.fromFrame + Math.min(1, first.durationInFrames - 1), "first caption page");
  for (const p of pages) {
    for (const t of p.lines.flat()) {
      if (t.emphasis) add(t.fromFrame + Math.min(1, Math.max(0, t.toFrame - t.fromFrame - 1)), `emphasis "${t.text}" (${t.emphasis})`);
      if (overridden.has(t.word)) add(t.fromFrame + Math.min(1, Math.max(0, t.toFrame - t.fromFrame - 1)), `override "${t.text}"`);
    }
  }
  for (const t of edl.transitions) {
    if (t.durationInFrames <= 0) continue;
    add(t.fromFrame, `${t.type} ${t.between.join("→")}: start`);
    add(t.atFrame, `${t.type} ${t.between.join("→")}: cut`);
    add(t.fromFrame + t.durationInFrames - 1, `${t.type} ${t.between.join("→")}: end`);
  }
  for (const o of edl.overlays) {
    const name = `${o.component} "${o.id}"`;
    add(o.fromFrame, `${name}: first frame`);
    const settled = Math.min(o.fromFrame + o.durationInFrames - o.exit.durationInFrames - 1, o.fromFrame + o.enter.durationInFrames + 2 + Math.max(0, ...o.cues));
    add(settled, `${name}: settled`);
    for (const [k, c] of o.cues.entries()) if (c > 0) add(o.fromFrame + c, `${name}: cue ${k + 1}`);
  }
  const largest = [...pages].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
  if (largest) add(largest.fromFrame + Math.floor(largest.durationInFrames / 2), "largest caption page");
  add(edl.durationInFrames - 1, "last frame");
  return [...at.entries()].sort((a, b) => a[0] - b[0]).map(([frame, reasons]) => ({ frame, reasons }));
}
