import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, alpha, Icon, Lines, placeInArea } from "./ui";

/**
 * LabelTag: a name, a brand, a place or a tool, as a lower-third tag aligned on the left
 * margin: an accent bar grows, the dark tag unfolds from it, then the text slides in.
 */

export const LabelTagProps = z.strictObject({
  name: z.string().min(1).max(30),
  /** Second line: role, detail ("Micro-cravate sans fil"). */
  detail: z.string().min(1).max(40).optional(),
  icon: z.enum(["none", "person", "pin", "tool", "brand", "link", "star"]).default("none"),
});
type Props = z.infer<typeof LabelTagProps>;

const NAME_LH = 1.12;
const DETAIL_LH = 1.25;
const BAR = 12;

interface Layout {
  tag: Box;
  bar: Box;
  icon: Box | null;
  name: { fit: FitResult; box: Box };
  detail: { fit: FitResult; box: Box } | null;
}

export const LabelTag = defineOverlay<Props, Layout>({
  description: "Étiquette : nom, marque, lieu ou outil, en bas de tiers à gauche",
  props: LabelTagProps,
  zones: ["top", "center", "bottom"],
  enter: { kind: "slide", duration: 0.33, direction: "left" },
  exit: { kind: "slide", duration: 0.17, direction: "left" },
  text: (p) => [p.name, p.detail ?? ""].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area, safe }) {
    const pad = { x: 34, y: 26 };
    const iconS = p.icon === "none" ? 0 : 88;
    const iconGap = iconS ? 24 : 0;
    const left = safe.x;
    const maxW = area.x + area.width - left - BAR - 2 * pad.x - iconS - iconGap;
    const name = fitText(p.name, { font: brand.fonts.caption, maxWidth: maxW, maxLines: 2, maxSize: 60, minSize: 38, lineHeight: NAME_LH, language }, measure);
    const det = p.detail ? fitText(p.detail, { font: brand.fonts.body, maxWidth: maxW, maxLines: 2, maxSize: 38, minSize: 26, lineHeight: DETAIL_LH, language }, measure) : null;
    const gap = det ? 6 : 0;
    const textH = name.height + gap + (det?.height ?? 0);
    const innerH = Math.max(iconS, textH);
    const w = BAR + 2 * pad.x + iconS + iconGap + Math.max(name.width, det?.width ?? 0);
    const h = innerH + 2 * pad.y;
    const top = placeInArea(area, h, zone, 30);
    const tag = { x: left, y: top, width: w, height: h };
    const x = left + BAR + pad.x;
    const icon = iconS ? { x, y: top + (h - iconS) / 2, width: iconS, height: iconS } : null;
    const tx = x + iconS + iconGap;
    const ty = top + (h - textH) / 2;
    return {
      layout: {
        tag,
        bar: { x: left, y: top, width: BAR, height: h },
        icon,
        name: { fit: name, box: { x: tx, y: ty, width: name.width, height: name.height } },
        detail: det ? { fit: det, box: { x: tx, y: ty + name.height + gap, width: det.width, height: det.height } } : null,
      },
      box: tag,
      texts: [{ field: "name", fit: name, preferred: 60 }, ...(det ? [{ field: "detail", fit: det, preferred: 38 }] : [])],
    };
  },
  render({ props, layout, brand, frame }) {
    const c = brand.colors;
    const r = brand.shape.radius * 0.45;
    const unfold = landing(Math.min(1, Math.max(0, (frame + 1) / 11)));
    const text = landing(Math.min(1, Math.max(0, (frame - 4) / 9)));
    const { tag, bar } = layout;
    return (
      <>
        <div
          style={{
            ...absolute(tag),
            borderRadius: r,
            backgroundColor: alpha(c.panel, brand.shape.panelOpacity),
            boxShadow: brand.shape.shadow,
            clipPath: `inset(0 ${((1 - unfold) * 100).toFixed(2)}% 0 0 round ${r}px)`,
          }}
        />
        <div style={{ ...absolute(bar), borderRadius: `${r}px 0 0 ${r}px`, backgroundColor: c.accent }} />
        <div style={{ opacity: text, transform: `translateX(${((1 - text) * -30).toFixed(2)}px)` }}>
          {layout.icon && props.icon !== "none" ? (
            <div style={{ ...absolute(layout.icon), borderRadius: layout.icon.width / 2, backgroundColor: alpha(c.accent, 0.18), display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={props.icon} size={layout.icon.width * 0.56} color={c.accent} strokeWidth={2.3} />
            </div>
          ) : null}
          <Lines fit={layout.name.fit} font={brand.fonts.caption} lineHeight={NAME_LH} color={c.text} box={layout.name.box} align="left" />
          {layout.detail ? <Lines fit={layout.detail.fit} font={brand.fonts.body} lineHeight={DETAIL_LH} color={c.muted} box={layout.detail.box} align="left" /> : null}
        </div>
      </>
    );
  },
});
