import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress } from "./motion";
import { defineOverlay, type TextReport } from "./types";
import { absolute, alpha, fontStyle, Icon, Lines, placeInArea } from "./ui";

/**
 * SplitCompare: a comparison, a before / after. Two panels side by side, the weak side
 * stepped back with a cross, the strong side outlined in the accent colour with a check,
 * a "VS" badge between them. Each side appears on its own word (`cues`: left, right).
 */

const Side = z.strictObject({
  /** Short heading ("Avant", "Micro intégré"). */
  label: z.string().min(1).max(16),
  /** What it is, 1 to 6 words. */
  text: z.string().min(1).max(40),
});

export const SplitCompareProps = z.strictObject({
  left: Side,
  right: Side,
  /** Which side wins (outlined in the accent colour, with a check); the other gets a cross. "none": two neutral sides. */
  winner: z.enum(["left", "right", "none"]).default("right"),
  /** Badge between the panels ("VS", "→"); empty for none. */
  badge: z.string().max(3).default("VS"),
});
type Props = z.infer<typeof SplitCompareProps>;

const LABEL_LH = 1.2;
const TEXT_LH = 1.16;

interface Panel {
  box: Box;
  icon: Box;
  label: { fit: FitResult; box: Box };
  text: { fit: FitResult; box: Box };
}

interface Layout {
  panels: [Panel, Panel];
  badge: Box | null;
}

export const SplitCompare = defineOverlay<Props, Layout>({
  description: "Comparaison, avant / après : deux panneaux, le gagnant en couleur d'accent",
  props: SplitCompareProps,
  zones: ["full", "center"],
  enter: { kind: "fade", duration: 0.2, direction: "up" },
  exit: { kind: "fade", duration: 0.17, direction: "up" },
  text: (p) => [p.left.label, p.left.text, p.right.label, p.right.text].join(" "),
  cueCount: () => 2,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const gap = 28;
    const w = (area.width - gap) / 2;
    const pad = full ? 34 : 26;
    const inner = w - 2 * pad;
    const iconS = full ? 150 : 84;
    const sizes = full ? { label: 46, text: 62 } : { label: 32, text: 44 };
    const fits = [p.left, p.right].map((s) => ({
      label: fitText(
        s.label,
        { font: brand.fonts.display, maxWidth: inner, maxLines: 1, maxSize: sizes.label, minSize: 24, lineHeight: LABEL_LH, uppercase: true, letterSpacing: 0.06, language },
        measure,
      ),
      text: fitText(s.text, { font: brand.fonts.caption, maxWidth: inner, maxLines: full ? 4 : 3, maxSize: sizes.text, minSize: 30, lineHeight: TEXT_LH, language }, measure),
    }));
    // Both panels share the same text size, the smaller of the two.
    const textSize = Math.min(...fits.map((f) => f.text.fontSize));
    const labelSize = Math.min(...fits.map((f) => f.label.fontSize));
    const same = [p.left, p.right].map((s) => ({
      label: fitText(
        s.label,
        { font: brand.fonts.display, maxWidth: inner, maxLines: 1, maxSize: labelSize, minSize: labelSize, lineHeight: LABEL_LH, uppercase: true, letterSpacing: 0.06, language },
        measure,
      ),
      text: fitText(s.text, { font: brand.fonts.caption, maxWidth: inner, maxLines: full ? 4 : 3, maxSize: textSize, minSize: textSize, lineHeight: TEXT_LH, language }, measure),
    }));
    const textH = Math.max(...same.map((f) => f.text.height));
    const contentH = iconS + 26 + labelSize * LABEL_LH + 14 + textH;
    // Full screen: tall panels, the content centred in them.
    const h = Math.max(contentH + 2 * pad, full ? Math.min(620, area.height - 40) : 0);
    const top = placeInArea(area, h, zone);
    const inset = (h - contentH) / 2;
    const panels = same.map((f, k) => {
      const x = area.x + k * (w + gap);
      const icon = { x: x + (w - iconS) / 2, y: top + inset, width: iconS, height: iconS };
      const ly = icon.y + iconS + 26;
      const label = { fit: f.label, box: { x: x + (w - f.label.width) / 2, y: ly, width: f.label.width, height: f.label.height } };
      const ty = ly + labelSize * LABEL_LH + 14;
      const text = { fit: f.text, box: { x: x + (w - f.text.width) / 2, y: ty, width: f.text.width, height: f.text.height } };
      return { box: { x, y: top, width: w, height: h }, icon, label, text };
    }) as [Panel, Panel];
    const b = full ? 84 : 64;
    const badge = p.badge ? { x: area.x + area.width / 2 - b / 2, y: top + h / 2 - b / 2, width: b, height: b } : null;
    const texts: TextReport[] = (["left", "right"] as const).flatMap((side, k) => [
      { field: `${side}.label`, fit: { ...same[k]!.label, overflow: fits[k]!.label.overflow }, preferred: sizes.label },
      { field: `${side}.text`, fit: { ...same[k]!.text, overflow: fits[k]!.text.overflow }, preferred: sizes.text },
    ]);
    return { layout: { panels, badge }, box: { x: area.x, y: top, width: area.width, height: h }, texts };
  },
  render({ props, layout, brand, frame, fps, cues }) {
    const c = brand.colors;
    const at = [cues[0] ?? 0, cues[1] ?? 6];
    const r = brand.shape.radius;
    return (
      <>
        {layout.panels.map((pn, k) => {
          const side = k === 0 ? "left" : "right";
          const win = props.winner === side;
          const lose = props.winner !== "none" && !win;
          const p = itemProgress(frame, at[k]!, fps, 11);
          if (p <= 0) return null;
          const dx = (k === 0 ? -1 : 1) * (1 - p) * 90;
          const tone = win ? c.accent : lose ? c.muted : c.text;
          return (
            <div key={k} style={{ opacity: Math.min(1, p * 1.6), transform: `translateX(${dx.toFixed(2)}px)` }}>
              <div
                style={{
                  ...absolute(pn.box),
                  borderRadius: r,
                  backgroundColor: alpha(lose ? c.panelAlt : c.panel, brand.shape.panelOpacity),
                  boxShadow: win ? `${brand.shape.shadow}, inset 0 0 0 5px ${c.accent}` : brand.shape.shadow,
                }}
              />
              <div
                style={{
                  ...absolute(pn.icon),
                  borderRadius: pn.icon.width / 2,
                  backgroundColor: alpha(tone, win ? 1 : 0.16),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `scale(${(0.5 + 0.5 * p).toFixed(4)})`,
                }}
              >
                <Icon name={win ? "check" : lose ? "cross" : "arrow"} size={pn.icon.width * 0.52} color={win ? c.onAccent : tone} strokeWidth={3} />
              </div>
              <Lines fit={pn.label.fit} font={brand.fonts.display} lineHeight={LABEL_LH} letterSpacing={0.06} color={tone} box={pn.label.box} />
              <Lines fit={pn.text.fit} font={brand.fonts.caption} lineHeight={TEXT_LH} color={lose ? c.muted : c.text} box={pn.text.box} />
            </div>
          );
        })}
        {layout.badge ? (
          <div
            style={{
              ...absolute(layout.badge),
              borderRadius: layout.badge.width / 2,
              backgroundColor: c.surface,
              color: c.onSurface,
              boxShadow: brand.shape.shadow,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...fontStyle(brand.fonts.display, layout.badge.width * 0.34, 1),
              transform: `scale(${itemProgress(frame, at[1]! + 3, fps, 10).toFixed(4)})`,
            }}
          >
            {props.badge}
          </div>
        ) : null}
      </>
    );
  },
});
