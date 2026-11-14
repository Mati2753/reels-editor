export interface Interval {
  start: number;
  end: number;
}

/** Parses `silencedetect` log lines. A silence still open at the end is closed at `duration`. */
export function parseSilencedetect(log: string, duration: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const line of log.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s?.[1] !== undefined) {
      open = Math.max(0, Number(s[1]));
      continue;
    }
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e?.[1] !== undefined && open !== null) {
      out.push({ start: open, end: Number(e[1]) });
      open = null;
    }
  }
  if (open !== null && duration > open) out.push({ start: open, end: duration });
  return out;
}

/** Parts of `from` not covered by any interval of `remove` (both sorted or not). */
export function subtract(from: readonly Interval[], remove: readonly Interval[]): Interval[] {
  const cuts = [...remove].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of from) {
    let cursor = iv.start;
    for (const c of cuts) {
      if (c.end <= cursor) continue;
      if (c.start >= iv.end) break;
      if (c.start > cursor) out.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
      if (cursor >= iv.end) break;
    }
    if (cursor < iv.end) out.push({ start: cursor, end: iv.end });
  }
  return out;
}

/** Spaces between words, plus before the first and after the last, inside [0, duration]. */
export function gapsBetween(words: readonly Interval[], duration: number): Interval[] {
  return subtract([{ start: 0, end: duration }], words);
}
