import type { ResolvedEdl } from "../edl/resolved";

export interface PreviewFrame {
  frame: number;
  reasons: string[];
}

/**
 * Instants worth a still in `reels preview` (docs/ARCHITECTURE.md, Validation, aperçu,
 * rendu): the start of every segment (a few frames in, where a punch-in shows), the end of
 * every progressive zoom, the first caption page, every emphasised or corrected word while
 * it is spoken, the largest caption page (safe zone), and the last frame.
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
  const largest = [...pages].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
  if (largest) add(largest.fromFrame + Math.floor(largest.durationInFrames / 2), "largest caption page");
  add(edl.durationInFrames - 1, "last frame");
  return [...at.entries()].sort((a, b) => a[0] - b[0]).map(([frame, reasons]) => ({ frame, reasons }));
}
