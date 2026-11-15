import { z } from "zod";
import type { FontSpec } from "../../brand";
import type { TextMeasurer } from "../../edl/measure-core";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, alpha, fontStyle, Lines, panelStyle, placeInArea } from "./ui";

/**
 * BigNumber: a figure, a price, a percentage, counted up to its value, with its unit in the
 * accent colour and a short label under it. On a dark card over the picture, or on the
 * brand backdrop in the full zone.
 */

export const BigNumberProps = z.strictObject({
  value: z.number().finite(),
  /** Digits after the decimal separator. */
  decimals: z.number().int().min(0).max(2).default(0),
  /** Before the number ("+", "$"), small, in the accent colour. */
  prefix: z.string().max(3).default(""),
  /** After the number ("%", "€", "x", "k"), small, in the accent colour. */
  suffix: z.string().max(4).default(""),
  /** What the number counts, under it. */
  label: z.string().max(40).optional(),
  /** The counter starts here (0 by default; set it to `value` for no counting). */
  countFrom: z.number().finite().optional(),
});
type Props = z.infer<typeof BigNumberProps>;

const UNIT = 0.52;
const GAP = 0.06;
const NUM_LH = 1.0;
const LABEL_LH = 1.2;

interface Layout {
  size: number;
  /** The final number as displayed, its digits drawn tabular. */
  number: string;
  language: string;
  row: Box;
  label: { fit: FitResult; box: Box } | null;
  card: Box | null;
}

export function formatNumber(v: number, decimals: number, language: string): string {
  // Group separators as plain spaces: the brand font may lack the narrow no-break space
  // French uses (U+202F), which the browser would draw with a fallback font.
  return new Intl.NumberFormat(language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v).replace(/[\u202f\u00a0]/g, " ");
}

/** Width of a number with tabular digits: every digit as wide as the widest one. */
function numberWidth(s: string, font: FontSpec, size: number, measure: TextMeasurer): number {
  const digit = Math.max(...[..."0123456789"].map((d) => measure(d, font, size, 0)));
  return [...s].reduce((w, ch) => w + (/\d/.test(ch) ? digit : measure(ch, font, size, 0)), 0);
}

export const BigNumber = defineOverlay<Props, Layout>({
  description: "Chiffre : compteur animé, unité en couleur d'accent, libellé dessous",
  props: BigNumberProps,
  zones: ["top", "center", "full"],
  enter: { kind: "pop", duration: 0.33, direction: "up" },
  exit: { kind: "scale", duration: 0.17, direction: "up" },
  text: (p) => [p.label ?? "", "N"].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const pad = full ? { x: 0, y: 0 } : { x: 56, y: 40 };
    const inner = area.width - 2 * pad.x;
    const f = brand.fonts.display;
    const number = formatNumber(p.value, p.decimals, language);
    const start = formatNumber(p.countFrom ?? 0, p.decimals, language);
    const widest = number.length >= start.length ? number : start;
    const rowWidth = (s: number) => (p.prefix ? measure(p.prefix, f, s * UNIT, 0) + GAP * s : 0) + numberWidth(widest, f, s, measure) + (p.suffix ? GAP * s + measure(p.suffix, f, s * UNIT, 0) : 0);
    const maxSize = full ? 300 : zone === "top" ? 170 : 200;
    const minSize = 90;
    let size = maxSize;
    while (size > minSize && rowWidth(size) > inner) size -= 4;
    const overflow = rowWidth(size) > inner;
    const numFit: FitResult = {
      text: `${p.prefix}${number}${p.suffix}`,
      fontSize: size,
      lines: [number],
      lineWidths: [rowWidth(size)],
      width: rowWidth(size),
      height: size * NUM_LH,
      shrunk: size < maxSize,
      overflow,
    };
    const labelFit = p.label ? fitText(p.label, { font: brand.fonts.body, maxWidth: inner, maxLines: 2, maxSize: full ? 54 : 44, minSize: 30, lineHeight: LABEL_LH, language }, measure) : null;
    const labelGap = labelFit ? size * (full ? 0.02 : 0.1) : 0;
    const contentW = Math.max(numFit.width, labelFit?.width ?? 0);
    const contentH = numFit.height + labelGap + (labelFit?.height ?? 0);
    const cardH = contentH + 2 * pad.y;
    const top = placeInArea(area, cardH, zone);
    const cx = area.x + area.width / 2;
    const card = full ? null : { x: cx - (contentW + 2 * pad.x) / 2, y: top, width: contentW + 2 * pad.x, height: cardH };
    const row = { x: cx - numFit.width / 2, y: top + pad.y, width: numFit.width, height: numFit.height };
    const label = labelFit ? { fit: labelFit, box: { x: cx - labelFit.width / 2, y: row.y + row.height + labelGap, width: labelFit.width, height: labelFit.height } } : null;
    const texts = [{ field: "value", fit: numFit, preferred: maxSize }, ...(labelFit ? [{ field: "label", fit: labelFit, preferred: full ? 54 : 44 }] : [])];
    return { layout: { size, number, language, row, label, card }, box: card ?? { x: Math.min(row.x, label?.box.x ?? row.x), y: row.y, width: contentW, height: contentH }, texts };
  },
  render({ props, layout, brand, frame, durationInFrames, exitMotion, zone }) {
    const c = brand.colors;
    const f = brand.fonts.display;
    // Count over about 0.8 s, landing softly, finished before the exit.
    const countFrames = Math.max(1, Math.min(24, durationInFrames - exitMotion.durationInFrames - 8));
    const t = landing(Math.min(1, Math.max(0, (frame - 2) / countFrames)));
    const from = props.countFrom ?? 0;
    const shown = t >= 1 ? layout.number : formatNumber(from + (props.value - from) * t, props.decimals, layout.language);
    const { size, row, label, card } = layout;
    // Units sit high, like a price: their cap tops on the digits' cap tops.
    const unit = { ...fontStyle(f, size * UNIT, 1), color: c.accent, alignSelf: "flex-start", marginTop: size * 0.13 } as const;
    return (
      <>
        {card ? <div style={panelStyle(brand, card)} /> : null}
        <div
          style={{
            ...absolute(row),
            ...fontStyle(f, size, NUM_LH),
            color: c.text,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: size * GAP,
            whiteSpace: "pre",
            fontVariantNumeric: "tabular-nums",
            textShadow: zone === "full" ? `0 12px 40px ${alpha(c.accent, 0.35)}` : undefined,
          }}
        >
          {props.prefix ? <span style={unit}>{props.prefix}</span> : null}
          <span>{shown}</span>
          {props.suffix ? <span style={unit}>{props.suffix}</span> : null}
        </div>
        {label ? <Lines fit={label.fit} font={brand.fonts.body} lineHeight={LABEL_LH} color={c.muted} box={label.box} /> : null}
      </>
    );
  },
});
