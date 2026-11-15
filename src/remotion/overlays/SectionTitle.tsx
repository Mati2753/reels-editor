import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, alpha, fontStyle, Lines, panelStyle, placeInArea } from "./ui";

/**
 * SectionTitle: the start of a new part. In the full zone, on the brand backdrop: a large
 * outlined index ("02"), the title in heavy capitals, an accent bar that draws itself, an
 * optional line under it. In the centre zone, the same on a dark card.
 */

export const SectionTitleProps = z.strictObject({
  /** Number of the part ("01", "2", "B"). */
  index: z.string().min(1).max(3).optional(),
  title: z.string().min(1).max(36),
  subtitle: z.string().min(1).max(48).optional(),
});
type Props = z.infer<typeof SectionTitleProps>;

const TITLE_LH = 1.04;
const SUB_LH = 1.25;

interface Layout {
  card: Box | null;
  index: { size: number; box: Box; text: string } | null;
  title: { fit: FitResult; box: Box };
  bar: Box;
  subtitle: { fit: FitResult; box: Box } | null;
}

export const SectionTitle = defineOverlay<Props, Layout>({
  description: "Titre de partie : numéro, titre, trait d'accent",
  props: SectionTitleProps,
  zones: ["full", "center"],
  enter: { kind: "scale", duration: 0.33, direction: "up" },
  exit: { kind: "fade", duration: 0.17, direction: "up" },
  text: (p) => [p.index ?? "", p.title, p.subtitle ?? ""].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const pad = full ? { x: 0, y: 0 } : { x: 52, y: 44 };
    const inner = area.width - 2 * pad.x;
    const idxSize = full ? 230 : 120;
    const sub = p.subtitle ? fitText(p.subtitle, { font: brand.fonts.body, maxWidth: inner, maxLines: 2, maxSize: full ? 44 : 36, minSize: 28, lineHeight: SUB_LH, language }, measure) : null;
    const idxW = p.index ? measure(p.index, brand.fonts.display, idxSize, 0) : 0;
    const idxH = p.index ? idxSize * 0.92 : 0;
    const idxGap = p.index ? (full ? 20 : 12) : 0;
    const barH = full ? 12 : 9;
    const barGap = full ? 34 : 24;
    const subGap = sub ? (full ? 30 : 22) : 0;
    const room = area.height - 2 * pad.y - idxH - idxGap - barGap - barH - subGap - (sub?.height ?? 0);
    const title = fitText(
      p.title,
      { font: brand.fonts.display, maxWidth: inner, maxLines: 3, maxSize: full ? 120 : 72, minSize: 44, lineHeight: TITLE_LH, uppercase: true, language, maxHeight: room },
      measure,
    );
    const contentH = idxH + idxGap + title.height + barGap + barH + subGap + (sub?.height ?? 0);
    const contentW = Math.max(idxW, title.width, sub?.width ?? 0, 160);
    const cardH = contentH + 2 * pad.y;
    const cardW = contentW + 2 * pad.x;
    const top = placeInArea(area, cardH, zone);
    const cx = area.x + area.width / 2;
    let y = top + pad.y;
    const index = p.index ? { size: idxSize, text: p.index, box: { x: cx - idxW / 2, y, width: idxW, height: idxH } } : null;
    y += idxH + idxGap;
    const t = { fit: title, box: { x: cx - title.width / 2, y, width: title.width, height: title.height } };
    y += title.height + barGap;
    const barW = full ? 180 : 130;
    const bar = { x: cx - barW / 2, y, width: barW, height: barH };
    y += barH + subGap;
    const s = sub ? { fit: sub, box: { x: cx - sub.width / 2, y, width: sub.width, height: sub.height } } : null;
    const card = full ? null : { x: cx - cardW / 2, y: top, width: cardW, height: cardH };
    const texts = [{ field: "title", fit: title, preferred: full ? 120 : 72 }, ...(sub ? [{ field: "subtitle", fit: sub, preferred: full ? 44 : 36 }] : [])];
    return { layout: { card, index, title: t, bar, subtitle: s }, box: card ?? { x: cx - contentW / 2, y: top, width: contentW, height: contentH }, texts };
  },
  render({ layout, brand, frame, fps }) {
    const c = brand.colors;
    const idx = itemProgress(frame, 0, fps, 12);
    const title = itemProgress(frame, 3, fps, 11);
    const bar = landing(Math.min(1, Math.max(0, (frame - 8) / 10)));
    const sub = itemProgress(frame, 9, fps, 10);
    return (
      <>
        {layout.card ? <div style={panelStyle(brand, layout.card)} /> : null}
        {layout.index ? (
          <div
            style={{
              ...absolute(layout.index.box),
              ...fontStyle(brand.fonts.display, layout.index.size, 0.92),
              color: "transparent",
              WebkitTextStroke: `${Math.round(layout.index.size / 40)}px ${c.accent}`,
              textAlign: "center",
              whiteSpace: "pre",
              opacity: Math.min(1, idx * 1.5),
              transform: `translateY(${((1 - idx) * 50).toFixed(2)}px)`,
              textShadow: `0 0 60px ${alpha(c.accent, 0.25)}`,
            }}
          >
            {layout.index.text}
          </div>
        ) : null}
        <Lines
          fit={layout.title.fit}
          font={brand.fonts.display}
          lineHeight={TITLE_LH}
          color={c.text}
          box={layout.title.box}
          style={{ opacity: Math.min(1, title * 1.5), transform: `translateY(${((1 - title) * 40).toFixed(2)}px)` }}
        />
        <div style={{ ...absolute(layout.bar), borderRadius: layout.bar.height / 2, backgroundColor: c.accent, transform: `scaleX(${bar.toFixed(4)})` }} />
        {layout.subtitle ? (
          <Lines
            fit={layout.subtitle.fit}
            font={brand.fonts.body}
            lineHeight={SUB_LH}
            color={c.muted}
            box={layout.subtitle.box}
            style={{ opacity: Math.min(1, sub * 1.4), transform: `translateY(${((1 - sub) * 24).toFixed(2)}px)` }}
          />
        ) : null}
      </>
    );
  },
});
