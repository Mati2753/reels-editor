import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, alpha, bareWord, fontStyle, placeInArea, union } from "./ui";

/**
 * HookTitle: the promise of the Reel on screen from the first frame (docs/DIRECTOR.md,
 * Accroche: 3 to 7 words). Heavy capitals on dark line boxes, the key words in the accent
 * colour with a marker that sweeps under them, an optional kicker pill above.
 */

export const HookTitleProps = z.strictObject({
  /** The title, 3 to 7 words. */
  text: z.string().min(1).max(60),
  /** Words of `text` drawn in the accent colour (matched without case or punctuation). */
  highlight: z.array(z.string().min(1)).max(4).default([]),
  /** Short label above the title ("3 ASTUCES", "NOUVEAU"). */
  kicker: z.string().min(1).max(24).optional(),
});
type Props = z.infer<typeof HookTitleProps>;

const LH = 1.08;
const PAD = { x: 30, y: 12 };
const GAP = 10;
/** Distance from the zone's edge (top zone). */
const INSET = 24;

interface Layout {
  kicker: { fit: FitResult; box: Box } | null;
  title: FitResult;
  lines: Box[];
}

export const HookTitle = defineOverlay<Props, Layout>({
  description: "Titre d'accroche : 3 à 7 mots en capitales, mots clés en couleur d'accent",
  props: HookTitleProps,
  zones: ["top", "center"],
  enter: { kind: "scale", duration: 0.33, direction: "up" },
  exit: { kind: "fade", duration: 0.17, direction: "up" },
  text: (p) => [p.kicker ?? "", p.text].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    const f = brand.fonts.display;
    const kickerFit = p.kicker
      ? fitText(p.kicker, { font: f, maxWidth: area.width - 60, maxLines: 1, maxSize: 34, minSize: 26, lineHeight: 1.2, uppercase: true, letterSpacing: 0.08, language }, measure)
      : null;
    const kickerSpace = kickerFit ? kickerFit.fontSize * 1.2 + 24 + 22 : 0;
    const room = area.height - INSET - kickerSpace + GAP;
    const title = fitText(
      p.text,
      { font: f, maxWidth: area.width - 2 * PAD.x, maxLines: 3, maxSize: 96, minSize: 56, lineHeight: LH, uppercase: true, language, maxHeight: room, perLine: 2 * PAD.y + GAP },
      measure,
    );
    const lineH = title.fontSize * LH + 2 * PAD.y;
    const kickerH = kickerFit ? kickerFit.fontSize * 1.2 + 24 : 0;
    const kickerGap = kickerFit ? 22 : 0;
    const total = kickerH + kickerGap + title.lines.length * lineH + (title.lines.length - 1) * GAP;
    const top = placeInArea(area, total, zone);
    const cx = area.x + area.width / 2;
    const kicker = kickerFit ? { fit: kickerFit, box: { x: cx - (kickerFit.width + 48) / 2, y: top, width: kickerFit.width + 48, height: kickerH } } : null;
    const lines = title.lines.map((_, i) => {
      const w = (title.lineWidths[i] ?? 0) + 2 * PAD.x;
      return { x: cx - w / 2, y: top + kickerH + kickerGap + i * (lineH + GAP), width: w, height: lineH };
    });
    const texts = [{ field: "text", fit: title, preferred: 96 }, ...(kickerFit ? [{ field: "kicker", fit: kickerFit, preferred: 34 }] : [])];
    return { layout: { kicker, title, lines }, box: union(...lines, ...(kicker ? [kicker.box] : [])), texts };
  },
  render({ props, layout, brand, frame, fps }) {
    const c = brand.colors;
    const f = brand.fonts.display;
    const marks = new Set(props.highlight.flatMap((h) => h.split(/\s+/)).map(bareWord));
    const { title, kicker } = layout;
    return (
      <>
        {kicker ? (
          <div
            style={{
              ...absolute(kicker.box),
              ...fontStyle(f, kicker.fit.fontSize, 1.2, 0.08),
              borderRadius: kicker.box.height / 2,
              backgroundColor: c.accent,
              color: c.onAccent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "pre",
              boxShadow: brand.shape.shadow,
              opacity: itemProgress(frame, 0, fps),
            }}
          >
            {kicker.fit.lines[0]}
          </div>
        ) : null}
        {layout.lines.map((box, i) => {
          const p = itemProgress(frame, (kicker ? 2 : 0) + i * 3, fps);
          const words = (title.lines[i] ?? "").split(" ");
          return (
            <div
              key={i}
              style={{
                ...absolute(box),
                ...fontStyle(f, title.fontSize, LH),
                borderRadius: brand.shape.radius * 0.5,
                backgroundColor: alpha(c.panel, brand.shape.panelOpacity),
                boxShadow: brand.shape.shadow,
                color: c.text,
                padding: `${PAD.y}px ${PAD.x}px`,
                whiteSpace: "pre",
                opacity: Math.min(1, p * 1.6),
                transform: `translateY(${((1 - p) * 34).toFixed(2)}px)`,
              }}
            >
              {words.map((w, k) => {
                const hit = marks.has(bareWord(w));
                // Marker under a highlighted word, sweeping in once its line has landed.
                const sweep = hit ? landing(Math.min(1, Math.max(0, (frame - 8 - i * 3) / 9))) : 0;
                return (
                  <span key={k}>
                    {k > 0 ? " " : ""}
                    <span style={{ position: "relative", color: hit ? c.accent : c.text }}>
                      {hit ? (
                        <span
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: "0.04em",
                            height: "0.1em",
                            borderRadius: "0.05em",
                            backgroundColor: c.accent,
                            transform: `scaleX(${sweep.toFixed(3)})`,
                            transformOrigin: "left center",
                          }}
                        />
                      ) : null}
                      {w}
                    </span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </>
    );
  },
});
