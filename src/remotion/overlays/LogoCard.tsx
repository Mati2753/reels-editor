import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, alpha, fontStyle, Lines, panelStyle, placeInArea } from "./ui";

/**
 * LogoCard: a brand, a tool, an app, as a monogram tile (the initials on an accent tile
 * that turns in) beside its name and a tagline, on a dark card. Image logos need media
 * files, which arrive with the b-roll (phase 7): until then the tile shows initials.
 */

export const LogoCardProps = z.strictObject({
  name: z.string().min(1).max(24),
  /** Initials on the tile (1 to 3 characters); by default from the name. */
  initials: z.string().min(1).max(3).optional(),
  tagline: z.string().min(1).max(36).optional(),
  shape: z.enum(["rounded", "circle"]).default("rounded"),
});
type Props = z.infer<typeof LogoCardProps>;

const NAME_LH = 1.1;
const TAG_LH = 1.25;

interface Layout {
  card: Box;
  tile: Box;
  initials: { text: string; size: number };
  name: { fit: FitResult; box: Box };
  tagline: { fit: FitResult; box: Box } | null;
}

export const LogoCard = defineOverlay<Props, Layout>({
  description: "Marque, outil, application : monogramme, nom, accroche",
  props: LogoCardProps,
  zones: ["top", "center"],
  enter: { kind: "scale", duration: 0.33, direction: "up" },
  exit: { kind: "scale", duration: 0.17, direction: "up" },
  text: (p) => [p.name, p.tagline ?? ""].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    const pad = 36;
    const tileS = 150;
    const gap = 34;
    const textW = area.width - 2 * pad - tileS - gap;
    const name = fitText(p.name, { font: brand.fonts.display, maxWidth: textW, maxLines: 2, maxSize: 64, minSize: 40, lineHeight: NAME_LH, language }, measure);
    const tag = p.tagline ? fitText(p.tagline, { font: brand.fonts.body, maxWidth: textW, maxLines: 2, maxSize: 34, minSize: 26, lineHeight: TAG_LH, language }, measure) : null;
    const tagGap = tag ? 10 : 0;
    const textH = name.height + tagGap + (tag?.height ?? 0);
    const cardH = Math.max(tileS, textH) + 2 * pad;
    const cardW = Math.min(area.width, 2 * pad + tileS + gap + Math.max(name.width, tag?.width ?? 0));
    const top = placeInArea(area, cardH, zone);
    const left = area.x + (area.width - cardW) / 2;
    const tile = { x: left + pad, y: top + (cardH - tileS) / 2, width: tileS, height: tileS };
    const tx = tile.x + tileS + gap;
    const ty = top + (cardH - textH) / 2;
    const initials = (
      p.initials ??
      p.name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0] ?? "")
        .join("")
    ).toLocaleUpperCase(language);
    let size = 76;
    while (size > 36 && measure(initials, brand.fonts.display, size, 0) > tileS * 0.72) size -= 2;
    return {
      layout: {
        card: { x: left, y: top, width: cardW, height: cardH },
        tile,
        initials: { text: initials, size },
        name: { fit: name, box: { x: tx, y: ty, width: name.width, height: name.height } },
        tagline: tag ? { fit: tag, box: { x: tx, y: ty + name.height + tagGap, width: tag.width, height: tag.height } } : null,
      },
      box: { x: left, y: top, width: cardW, height: cardH },
      texts: [{ field: "name", fit: name, preferred: 64 }, ...(tag ? [{ field: "tagline", fit: tag, preferred: 34 }] : [])],
    };
  },
  render({ props, layout, brand, frame, fps }) {
    const c = brand.colors;
    const turn = itemProgress(frame, 1, fps, 13);
    const text = landing(Math.min(1, Math.max(0, (frame - 5) / 10)));
    const shine = landing(Math.min(1, Math.max(0, (frame - 10) / 14)));
    const radius = props.shape === "circle" ? layout.tile.width / 2 : brand.shape.radius * 0.8;
    return (
      <>
        <div style={panelStyle(brand, layout.card)} />
        <div style={{ ...absolute(layout.tile), perspective: 800 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: radius,
              overflow: "hidden",
              background: `linear-gradient(145deg, ${c.accent}, ${alpha(c.accent, 0.72)})`,
              boxShadow: `0 14px 34px ${alpha(c.accent, 0.35)}`,
              color: c.onAccent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              ...fontStyle(brand.fonts.display, layout.initials.size, 1),
              transform: `rotateY(${((1 - turn) * 80).toFixed(2)}deg) scale(${(0.7 + 0.3 * turn).toFixed(4)})`,
            }}
          >
            {layout.initials.text}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(115deg, transparent ${(shine * 120 - 30).toFixed(1)}%, ${alpha(c.surface, 0.45)} ${(shine * 120 - 15).toFixed(1)}%, transparent ${(shine * 120).toFixed(1)}%)`,
              }}
            />
          </div>
        </div>
        <div style={{ opacity: text, transform: `translateX(${((1 - text) * 30).toFixed(2)}px)` }}>
          <Lines fit={layout.name.fit} font={brand.fonts.display} lineHeight={NAME_LH} color={c.text} box={layout.name.box} align="left" />
          {layout.tagline ? <Lines fit={layout.tagline.fit} font={brand.fonts.body} lineHeight={TAG_LH} color={c.muted} box={layout.tagline.box} align="left" /> : null}
        </div>
      </>
    );
  },
});
