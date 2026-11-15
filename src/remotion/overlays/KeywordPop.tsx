import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress } from "./motion";
import { defineOverlay } from "./types";
import { absolute, fontStyle, placeInArea } from "./ui";

/**
 * KeywordPop: one key word or concept that pops on a tilted block of the accent colour,
 * with an outlined echo of the block settling behind it a beat later.
 */

export const KeywordPopProps = z.strictObject({
  /** 1 to 3 words. */
  text: z.string().min(1).max(28),
  /** Colour of the block: the brand's accent, its active colour (captions highlight), or its light surface. */
  tone: z.enum(["accent", "active", "light"]).default("accent"),
  /** Tilt of the block, degrees (negative: anticlockwise). */
  tilt: z.number().min(-8).max(8).default(-3),
});
type Props = z.infer<typeof KeywordPopProps>;

const LH = 1.04;
const PAD = { x: 44, y: 22 };
const ECHO = 14;

interface Layout {
  fit: FitResult;
  block: Box;
}

/** Bounding box of a box rotated by `deg` around its centre. */
function rotatedBounds(b: Box, deg: number): Box {
  const r = (Math.abs(deg) * Math.PI) / 180;
  const w = b.width * Math.cos(r) + b.height * Math.sin(r);
  const h = b.width * Math.sin(r) + b.height * Math.cos(r);
  return { x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2, width: w, height: h };
}

export const KeywordPop = defineOverlay<Props, Layout>({
  description: "Mot-clé : 1 à 3 mots sur un bloc incliné qui surgit",
  props: KeywordPopProps,
  zones: ["top", "center"],
  enter: { kind: "pop", duration: 0.33, direction: "up" },
  exit: { kind: "scale", duration: 0.17, direction: "up" },
  text: (p) => p.text,
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    // Room for the tilt and the echo around the block.
    const maxWidth = area.width - 2 * PAD.x - 2 * ECHO - 40;
    const fit = fitText(
      p.text,
      { font: brand.fonts.display, maxWidth, maxLines: 3, maxSize: 120, minSize: 56, lineHeight: LH, uppercase: true, language, maxHeight: area.height - 2 * PAD.y - 2 * ECHO - 40 - 40 },
      measure,
    );
    const w = fit.width + 2 * PAD.x;
    const h = fit.height + 2 * PAD.y;
    const y = placeInArea(area, h + 2 * ECHO, zone, 40) + ECHO;
    const block = { x: area.x + (area.width - w) / 2, y, width: w, height: h };
    const echo = { x: block.x - ECHO, y: block.y - ECHO, width: w + 2 * ECHO, height: h + 2 * ECHO };
    return { layout: { fit, block }, box: rotatedBounds(echo, p.tilt), texts: [{ field: "text", fit, preferred: 120 }] };
  },
  render({ props, layout, brand, frame, fps }) {
    const c = brand.colors;
    const bg = props.tone === "accent" ? c.accent : props.tone === "active" ? c.active : c.surface;
    const fg = props.tone === "light" ? c.onSurface : c.onAccent;
    const echo = itemProgress(frame, 3, fps, 12);
    const { block, fit } = layout;
    return (
      <div style={{ ...absolute(block), transform: `rotate(${props.tilt}deg)` }}>
        <div
          style={{
            position: "absolute",
            inset: -ECHO,
            borderRadius: brand.shape.radius * 0.6 + ECHO / 2,
            border: `5px solid ${bg}`,
            opacity: 0.85 * Math.min(1, echo),
            transform: `scale(${(0.8 + 0.2 * echo).toFixed(4)}) rotate(${((1 - echo) * 4).toFixed(2)}deg)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: brand.shape.radius * 0.6,
            backgroundColor: bg,
            boxShadow: brand.shape.shadow,
            color: fg,
            ...fontStyle(brand.fonts.display, fit.fontSize, LH),
            padding: `${PAD.y}px ${PAD.x}px`,
            textAlign: "center",
          }}
        >
          {fit.lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: "pre" }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    );
  },
});
