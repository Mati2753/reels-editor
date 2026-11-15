import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay, type TextReport } from "./types";
import { absolute, alpha, fontStyle, Lines, placeInArea } from "./ui";

/**
 * StepFlow: a process in 2 to 4 steps, as a vertical path: numbered nodes joined by a line
 * that draws itself from one step to the next, each step appearing on its word (`cues`).
 */

export const StepFlowProps = z.strictObject({
  title: z.string().min(1).max(30).optional(),
  /** 2 to 4 steps, a few words each. */
  steps: z.array(z.string().min(1).max(32)).min(2).max(4),
});
type Props = z.infer<typeof StepFlowProps>;

const LH = 1.12;
const TITLE_LH = 1.2;

interface Step {
  node: Box;
  card: Box;
  fit: FitResult;
  text: Box;
}

interface Layout {
  title: { fit: FitResult; box: Box } | null;
  steps: Step[];
  size: number;
}

const fallbackCue = (k: number) => 4 + k * 7;

export const StepFlow = defineOverlay<Props, Layout>({
  description: "Processus : 2 à 4 étapes reliées, chacune sur son mot",
  props: StepFlowProps,
  zones: ["full", "center"],
  enter: { kind: "fade", duration: 0.2, direction: "up" },
  exit: { kind: "fade", duration: 0.17, direction: "up" },
  text: (p) => [p.title ?? "", ...p.steps].join(" "),
  cueCount: (p) => p.steps.length,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const maxSize = full ? 60 : 46;
    let best: { layout: Layout; reports: TextReport[]; height: number } | null = null;
    for (let size = maxSize; size >= 32; size -= 2) {
      const d = Math.round(size * 1.6);
      const gapX = Math.round(size * 0.5);
      const gapY = Math.round(size * 0.6);
      const padX = Math.round(size * 0.55);
      const padY = Math.round(size * 0.38);
      const titleFit = p.title
        ? fitText(
            p.title,
            { font: brand.fonts.display, maxWidth: area.width, maxLines: 1, maxSize: Math.round(size * 0.8), minSize: 26, lineHeight: TITLE_LH, uppercase: true, letterSpacing: 0.06, language },
            measure,
          )
        : null;
      const cardMax = area.width - d - gapX - 2 * padX;
      const fits = p.steps.map((s) => fitText(s, { font: brand.fonts.caption, maxWidth: cardMax, maxLines: 2, maxSize: size, minSize: size, lineHeight: LH, language }, measure));
      const rowH = fits.map((f) => Math.max(d, f.height + 2 * padY));
      const titleH = titleFit ? titleFit.height + gapY : 0;
      const height = titleH + rowH.reduce((a, b) => a + b, 0) + gapY * (fits.length - 1);
      const reports: TextReport[] = [
        ...(titleFit ? [{ field: "title", fit: titleFit, preferred: Math.round(maxSize * 0.8) }] : []),
        ...fits.map((f, k) => ({ field: `steps[${k}]`, fit: { ...f, shrunk: size < maxSize }, preferred: maxSize })),
      ];
      const ok = height <= area.height - 24 && !fits.some((f) => f.overflow);
      if (!ok && size - 2 >= 32) continue;
      if (!ok) reports.push({ field: "steps", fit: { ...fits[0]!, overflow: true, text: `${p.steps.length} steps` }, preferred: maxSize });
      const contentW = d + gapX + Math.max(...fits.map((f) => f.width + 2 * padX));
      const left = area.x + (area.width - Math.max(contentW, titleFit?.width ?? 0)) / 2;
      let y = placeInArea(area, height, zone);
      const top = y;
      const title = titleFit ? { fit: titleFit, box: { x: left, y, width: titleFit.width, height: titleFit.height } } : null;
      y += titleH;
      const steps = fits.map((f, k) => {
        const h = rowH[k]!;
        const node = { x: left, y: y + (h - d) / 2, width: d, height: d };
        const card = { x: left + d + gapX, y: y + (h - (f.height + 2 * padY)) / 2, width: f.width + 2 * padX, height: f.height + 2 * padY };
        const text = { x: card.x + padX, y: card.y + padY, width: f.width, height: f.height };
        y += h + gapY;
        return { node, card, fit: f, text };
      });
      best = { layout: { title, steps, size }, reports, height: y - gapY - top };
      break;
    }
    const l = best!.layout;
    const x0 = l.steps[0]!.node.x;
    const right = Math.max(l.title ? l.title.box.x + l.title.box.width : 0, ...l.steps.map((s) => s.card.x + s.card.width));
    const y0 = l.title?.box.y ?? l.steps[0]!.node.y;
    return { layout: l, box: { x: x0, y: y0, width: right - x0, height: best!.height }, texts: best!.reports };
  },
  render({ layout, brand, frame, fps, cues }) {
    const c = brand.colors;
    const at = (k: number) => cues[k] ?? fallbackCue(k);
    const r = brand.shape.radius * 0.6;
    const shown = layout.steps.filter((_, k) => frame >= at(k) - 1).length;
    return (
      <>
        {layout.title ? <Lines fit={layout.title.fit} font={brand.fonts.display} lineHeight={TITLE_LH} letterSpacing={0.06} color={c.accent} box={layout.title.box} align="left" /> : null}
        {layout.steps.slice(1).map((s, i) => {
          // Line from node i to node i+1, drawn while step i+1 arrives.
          const a = layout.steps[i]!.node;
          const grow = landing(Math.min(1, Math.max(0, (frame - at(i + 1) + 6) / 7)));
          const x = a.x + a.width / 2 - 4;
          const y0 = a.y + a.height;
          const len = s.node.y - y0;
          return (
            <div
              key={`l${i}`}
              style={{
                position: "absolute",
                left: x,
                top: y0,
                width: 8,
                height: len,
                borderRadius: 4,
                backgroundColor: c.accent,
                opacity: 0.85,
                transform: `scaleY(${grow.toFixed(4)})`,
                transformOrigin: "top",
              }}
            />
          );
        })}
        {layout.steps.map((s, k) => {
          const p = itemProgress(frame, at(k), fps);
          if (p <= 0) return null;
          const current = k === shown - 1;
          return (
            <div key={k}>
              <div
                style={{
                  ...absolute(s.node),
                  borderRadius: s.node.width / 2,
                  backgroundColor: current ? c.accent : c.panel,
                  border: `5px solid ${c.accent}`,
                  color: current ? c.onAccent : c.accent,
                  boxShadow: brand.shape.shadow,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ...fontStyle(brand.fonts.display, s.node.width * 0.42, 1),
                  transform: `scale(${(0.4 + 0.6 * p).toFixed(4)})`,
                  opacity: Math.min(1, p * 2),
                }}
              >
                {k + 1}
              </div>
              <div style={{ opacity: Math.min(1, p * 1.6), transform: `translateX(${((1 - p) * 50).toFixed(2)}px)` }}>
                <div style={{ ...absolute(s.card), borderRadius: r, backgroundColor: alpha(c.panel, brand.shape.panelOpacity), boxShadow: brand.shape.shadow }} />
                <Lines fit={s.fit} font={brand.fonts.caption} lineHeight={LH} color={current ? c.text : c.muted} box={s.text} align="left" />
              </div>
            </div>
          );
        })}
      </>
    );
  },
});
