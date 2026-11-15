import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay, type TextReport } from "./types";
import { absolute, fontStyle, Icon, Lines, panelStyle, placeInArea } from "./ui";

/**
 * ListReveal: a list whose items appear one by one, each on the word that names it
 * (`cues`, one per item). The newest item is bright, the earlier ones step back.
 */

export const ListRevealProps = z.strictObject({
  /** Heading of the list ("3 erreurs"), small, in the accent colour. */
  title: z.string().min(1).max(30).optional(),
  items: z.array(z.string().min(1).max(40)).min(2).max(5),
  /** Numbers in the bullets (else a check mark). */
  numbered: z.boolean().default(true),
});
type Props = z.infer<typeof ListRevealProps>;

const LH = 1.14;
const TITLE_LH = 1.2;

interface Row {
  fit: FitResult;
  bullet: Box;
  text: Box;
}

interface Layout {
  card: Box | null;
  title: { fit: FitResult; box: Box } | null;
  size: number;
  rows: Row[];
}

/** Frame at which item k appears without cues. */
const fallbackCue = (k: number) => 4 + k * 6;

export const ListReveal = defineOverlay<Props, Layout>({
  description: "Liste : un item par mention, chacun sur son mot",
  props: ListRevealProps,
  zones: ["top", "center", "full"],
  enter: { kind: "slide", duration: 0.33, direction: "left" },
  exit: { kind: "fade", duration: 0.17, direction: "left" },
  text: (p) => [p.title ?? "", ...p.items].join(" "),
  cueCount: (p) => p.items.length,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const pad = full ? { x: 10, y: 0 } : { x: 44, y: 40 };
    const inner = area.width - 2 * pad.x;
    const maxSize = full ? 84 : zone === "center" ? 60 : 54;
    const minSize = 34;
    let chosen: Layout | null = null;
    let reports: TextReport[] = [];
    for (let size = maxSize; size >= minSize; size -= 2) {
      const d = Math.round(size * 1.3);
      const gapX = Math.round(size * 0.45);
      const gapY = Math.round(size * 0.42);
      const titleFit = p.title
        ? fitText(
            p.title,
            { font: brand.fonts.display, maxWidth: inner, maxLines: 1, maxSize: Math.round(size * 0.78), minSize: 26, lineHeight: TITLE_LH, uppercase: true, letterSpacing: 0.06, language },
            measure,
          )
        : null;
      const fits = p.items.map((it) => fitText(it, { font: brand.fonts.caption, maxWidth: inner - d - gapX, maxLines: 2, maxSize: size, minSize: size, lineHeight: LH, language }, measure));
      const titleH = titleFit ? titleFit.height + gapY * 1.1 : 0;
      const rowHs = fits.map((f) => Math.max(d, f.height));
      const contentH = titleH + rowHs.reduce((a, b) => a + b, 0) + gapY * (fits.length - 1);
      const tooTall = contentH + 2 * pad.y > area.height - (zone === "top" ? 24 : 0);
      const overflow = fits.some((f) => f.overflow) || (titleFit?.overflow ?? false);
      reports = [
        ...(titleFit ? [{ field: "title", fit: titleFit, preferred: Math.round(maxSize * 0.78) }] : []),
        ...fits.map((f, k) => ({ field: `items[${k}]`, fit: { ...f, shrunk: size < maxSize }, preferred: maxSize })),
      ];
      if ((overflow || tooTall) && size - 2 >= minSize) continue;
      const contentW = Math.max(titleFit?.width ?? 0, ...fits.map((f) => d + gapX + f.width));
      const cardW = contentW + 2 * pad.x;
      const cardH = contentH + 2 * pad.y;
      const top = placeInArea(area, cardH, zone);
      const left = area.x + (area.width - cardW) / 2;
      const x0 = left + pad.x;
      let y = top + pad.y;
      const title = titleFit ? { fit: titleFit, box: { x: x0, y, width: titleFit.width, height: titleFit.height } } : null;
      y += titleH;
      const rows: Row[] = fits.map((f, k) => {
        const h = rowHs[k]!;
        const row = { fit: f, bullet: { x: x0, y: y + (h - d) / 2, width: d, height: d }, text: { x: x0 + d + gapX, y: y + (h - f.height) / 2, width: f.width, height: f.height } };
        y += h + gapY;
        return row;
      });
      if (tooTall) reports.push({ field: "items", fit: { ...fits[0]!, overflow: true, text: `${p.items.length} items` }, preferred: maxSize });
      chosen = { card: full ? null : { x: left, y: top, width: cardW, height: cardH }, title, size, rows };
      break;
    }
    const l = chosen!;
    const first = l.title?.box.y ?? l.rows[0]!.bullet.y;
    const lastRow = l.rows[l.rows.length - 1]!;
    const bottom = Math.max(lastRow.bullet.y + lastRow.bullet.height, lastRow.text.y + lastRow.text.height);
    const x0 = l.rows[0]!.bullet.x;
    const right = Math.max(l.title ? l.title.box.x + l.title.box.width : 0, ...l.rows.map((r) => r.text.x + r.text.width));
    const box = l.card ?? { x: x0, y: first, width: right - x0, height: bottom - first };
    return { layout: l, box, texts: reports };
  },
  render({ props, layout, brand, frame, fps, cues }) {
    const c = brand.colors;
    const at = (k: number) => cues[k] ?? fallbackCue(k);
    const shown = layout.rows.filter((_, k) => frame >= at(k) - 1).length;
    return (
      <>
        {layout.card ? <div style={panelStyle(brand, layout.card)} /> : null}
        {layout.title ? <Lines fit={layout.title.fit} font={brand.fonts.display} lineHeight={TITLE_LH} letterSpacing={0.06} color={c.accent} box={layout.title.box} align="left" /> : null}
        {layout.rows.map((r, k) => {
          const p = itemProgress(frame, at(k), fps);
          if (p <= 0) return null;
          const newest = k === shown - 1;
          // An earlier item steps back once the next one has landed.
          const back = newest ? 0 : landing(Math.min(1, Math.max(0, (frame - at(k + 1)) / 8)));
          const d = r.bullet.width;
          return (
            <div key={k} style={{ opacity: Math.min(1, p * 1.8), transform: `translateX(${((1 - p) * -60).toFixed(2)}px)` }}>
              <div
                style={{
                  ...absolute(r.bullet),
                  borderRadius: d / 2,
                  backgroundColor: c.accent,
                  color: c.onAccent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ...fontStyle(brand.fonts.display, d * 0.52, 1),
                  transform: `scale(${(0.6 + 0.4 * p).toFixed(4)})`,
                }}
              >
                {props.numbered ? k + 1 : <Icon name="check" size={d * 0.6} color={c.onAccent} strokeWidth={3.2} />}
              </div>
              <Lines fit={r.fit} font={brand.fonts.caption} lineHeight={LH} color={c.text} box={r.text} align="left" style={{ opacity: 1 - 0.45 * back }} />
            </div>
          );
        })}
      </>
    );
  },
});
