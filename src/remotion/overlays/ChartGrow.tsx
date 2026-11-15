import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { formatNumber } from "./BigNumber";
import { itemProgress, landing } from "./motion";
import { defineOverlay, type TextReport } from "./types";
import { absolute, alpha, fontStyle, Lines, panelStyle, placeInArea } from "./ui";

/**
 * ChartGrow: an evolution or a comparison of values as a bar chart whose bars grow from the
 * baseline, one after the other or each on its word (`cues`), their values counting up.
 * One series: no legend, the title names it; the bar that matters is in the accent colour,
 * the others recede; values and labels stay in text colours.
 */

export const ChartGrowProps = z.strictObject({
  title: z.string().min(1).max(30).optional(),
  bars: z
    .array(z.strictObject({ label: z.string().min(1).max(10), value: z.number().nonnegative().finite() }))
    .min(2)
    .max(6),
  /** Unit after each value ("%", "k", "€"). */
  unit: z.string().max(3).default(""),
  decimals: z.number().int().min(0).max(1).default(0),
  /** Index of the bar in the accent colour (the last one by default). */
  highlight: z.number().int().min(0).max(5).optional(),
});
type Props = z.infer<typeof ChartGrowProps>;

const TITLE_LH = 1.2;

interface Bar {
  bar: Box;
  value: { text: string; size: number; box: Box };
  label: { fit: FitResult; box: Box };
}

interface Layout {
  card: Box | null;
  title: { fit: FitResult; box: Box } | null;
  baseline: Box;
  bars: Bar[];
  language: string;
}

const fallbackCue = (k: number) => 3 + k * 4;

export const ChartGrow = defineOverlay<Props, Layout>({
  description: "Évolution, données : histogramme dont les barres poussent, valeurs comptées",
  props: ChartGrowProps,
  zones: ["full", "center"],
  enter: { kind: "fade", duration: 0.2, direction: "up" },
  exit: { kind: "fade", duration: 0.17, direction: "up" },
  text: (p) => [p.title ?? "", ...p.bars.map((b) => b.label)].join(" "),
  cueCount: (p) => p.bars.length,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const pad = full ? { x: 8, y: 8 } : { x: 40, y: 36 };
    const inner = { x: area.x + pad.x, y: 0, width: area.width - 2 * pad.x };
    const n = p.bars.length;
    const gap = Math.round(inner.width * (n > 4 ? 0.05 : 0.07));
    const barW = (inner.width - gap * (n - 1)) / n;
    const titleFit = p.title
      ? fitText(p.title, { font: brand.fonts.display, maxWidth: inner.width, maxLines: 2, maxSize: full ? 56 : 40, minSize: 28, lineHeight: TITLE_LH, uppercase: true, language }, measure)
      : null;
    const labelMax = full ? 38 : 30;
    const labels = p.bars.map((b) => fitText(b.label, { font: brand.fonts.body, maxWidth: barW + gap * 0.8, maxLines: 1, maxSize: labelMax, minSize: 22, lineHeight: 1.2, language }, measure));
    const labelSize = Math.min(...labels.map((l) => l.fontSize));
    const sameLabels = p.bars.map((b) =>
      fitText(b.label, { font: brand.fonts.body, maxWidth: barW + gap * 0.8, maxLines: 1, maxSize: labelSize, minSize: labelSize, lineHeight: 1.2, language }, measure),
    );
    const values = p.bars.map((b) => `${formatNumber(b.value, p.decimals, language)}${p.unit}`);
    let valueSize = full ? 52 : 40;
    while (valueSize > 26 && Math.max(...values.map((v) => measure(v, brand.fonts.display, valueSize, 0))) > barW + gap * 0.8) valueSize -= 2;
    const valueOverflow = Math.max(...values.map((v) => measure(v, brand.fonts.display, valueSize, 0))) > barW + gap * 0.8;
    const titleH = titleFit ? titleFit.height + 30 : 0;
    const valueH = valueSize * 1.2 + 10;
    const labelH = labelSize * 1.2 + 14;
    const plotH = Math.min(full ? 560 : 300, area.height - 2 * pad.y - titleH - valueH - labelH - 24);
    const cardH = 2 * pad.y + titleH + valueH + plotH + labelH;
    const top = placeInArea(area, cardH, zone);
    const card = full ? null : { x: area.x, y: top, width: area.width, height: cardH };
    const title = titleFit ? { fit: titleFit, box: { x: inner.x, y: top + pad.y, width: titleFit.width, height: titleFit.height } } : null;
    const plotTop = top + pad.y + titleH + valueH;
    const baseY = plotTop + plotH;
    const max = Math.max(...p.bars.map((b) => b.value), 1e-9);
    const bars = p.bars.map((b, k) => {
      const h = Math.max(6, (b.value / max) * plotH);
      const x = inner.x + k * (barW + gap);
      const vw = measure(values[k]!, brand.fonts.display, valueSize, 0);
      const l = sameLabels[k]!;
      return {
        bar: { x, y: baseY - h, width: barW, height: h },
        value: { text: values[k]!, size: valueSize, box: { x: x + (barW - vw) / 2, y: baseY - h - valueH, width: vw, height: valueSize * 1.2 } },
        label: { fit: l, box: { x: x + (barW - l.width) / 2, y: baseY + 14, width: l.width, height: l.height } },
      };
    });
    const reports: TextReport[] = [
      ...(titleFit ? [{ field: "title", fit: titleFit, preferred: full ? 56 : 40 }] : []),
      ...sameLabels.map((l, k) => ({ field: `bars[${k}].label`, fit: { ...l, overflow: labels[k]!.overflow }, preferred: labelMax })),
      {
        field: "bars",
        fit: { text: values.join(" "), fontSize: valueSize, lines: values, lineWidths: [], width: barW, height: valueSize, shrunk: valueSize < (full ? 52 : 40), overflow: valueOverflow },
        preferred: full ? 52 : 40,
      },
    ];
    const box = card ?? { x: inner.x, y: top, width: inner.width, height: cardH };
    return { layout: { card, title, baseline: { x: inner.x, y: baseY, width: inner.width, height: 4 }, bars, language }, box, texts: reports };
  },
  render({ props, layout, brand, frame, fps, cues }) {
    const c = brand.colors;
    const hi = props.highlight ?? props.bars.length - 1;
    const at = (k: number) => cues[k] ?? fallbackCue(k);
    const axis = landing(Math.min(1, (frame + 1) / 8));
    return (
      <>
        {layout.card ? <div style={panelStyle(brand, layout.card)} /> : null}
        {layout.title ? <Lines fit={layout.title.fit} font={brand.fonts.display} lineHeight={TITLE_LH} color={c.text} box={layout.title.box} align="left" /> : null}
        <div style={{ ...absolute(layout.baseline), borderRadius: 2, backgroundColor: alpha(c.muted, 0.6), transform: `scaleX(${axis.toFixed(4)})`, transformOrigin: "left" }} />
        {layout.bars.map((b, k) => {
          const g = landing(Math.min(1, Math.max(0, (frame - at(k) + 1) / 14)));
          const pop = itemProgress(frame, at(k), fps, 10);
          const accent = k === hi;
          const shown = g >= 1 ? b.value.text : `${formatNumber((props.bars[k]?.value ?? 0) * g, props.decimals, layout.language)}${props.unit}`;
          const h = b.bar.height * g;
          return (
            <div key={k}>
              <div
                style={{
                  position: "absolute",
                  left: b.bar.x,
                  top: b.bar.y + b.bar.height - h,
                  width: b.bar.width,
                  height: h,
                  borderRadius: "12px 12px 0 0",
                  backgroundColor: accent ? c.accent : alpha(c.muted, 0.45),
                  boxShadow: accent ? `0 0 40px ${alpha(c.accent, 0.35)}` : undefined,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: b.value.box.x - 40,
                  width: b.value.box.width + 80,
                  top: b.value.box.y + b.bar.height - h,
                  textAlign: "center",
                  ...fontStyle(brand.fonts.display, b.value.size, 1.2),
                  color: accent ? c.text : c.muted,
                  opacity: Math.min(1, pop * 2),
                  whiteSpace: "pre",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {shown}
              </div>
              <Lines fit={b.label.fit} font={brand.fonts.body} lineHeight={1.2} color={accent ? c.text : c.muted} box={b.label.box} style={{ opacity: Math.min(1, pop * 2) }} />
            </div>
          );
        })}
      </>
    );
  },
});
