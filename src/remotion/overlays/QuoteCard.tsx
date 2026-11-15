import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, fontStyle, Lines, placeInArea, surfaceStyle } from "./ui";

/**
 * QuoteCard: a quotation or a review on a light card: a large accent quote mark, the words,
 * and who said it, with the initials in an accent disc. A rule under the author draws itself.
 */

export const QuoteCardProps = z.strictObject({
  /** The quotation, short: it must be read twice in the time it stays (docs/DIRECTOR.md). */
  quote: z.string().min(1).max(90),
  author: z.string().min(1).max(30).optional(),
  /** Under the author ("Client depuis 2021", "Commentaire Instagram"). */
  detail: z.string().min(1).max(36).optional(),
});
type Props = z.infer<typeof QuoteCardProps>;

const Q_LH = 1.22;
const A_LH = 1.2;

interface Layout {
  card: Box;
  mark: Box;
  quote: { fit: FitResult; box: Box };
  author: { fit: FitResult; box: Box } | null;
  detail: { fit: FitResult; box: Box } | null;
  avatar: Box | null;
  initials: string;
  rule: Box;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase("fr"))
    .join("");
}

export const QuoteCard = defineOverlay<Props, Layout>({
  description: "Citation, avis, commentaire : carte claire, guillemet d'accent, auteur",
  props: QuoteCardProps,
  zones: ["center", "full"],
  enter: { kind: "scale", duration: 0.33, direction: "up" },
  exit: { kind: "scale", duration: 0.17, direction: "up" },
  text: (p) => [p.quote, p.author ?? "", p.detail ?? ""].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const pad = full ? 60 : 48;
    const inner = area.width - 2 * pad;
    const markH = full ? 110 : 84;
    const avatarS = p.author ? (full ? 92 : 76) : 0;
    const authorBlockH = p.author ? Math.max(avatarS, 0) + 32 : 0;
    const ruleGap = 28;
    const room = area.height - 2 * pad - markH * 0.6 - ruleGap - 6 - authorBlockH - 24;
    const quote = fitText(p.quote, { font: brand.fonts.caption, maxWidth: inner, maxLines: full ? 6 : 4, maxSize: full ? 72 : 58, minSize: 34, lineHeight: Q_LH, language, maxHeight: room }, measure);
    const nameW = inner - avatarS - 24;
    const author = p.author ? fitText(p.author, { font: brand.fonts.display, maxWidth: nameW, maxLines: 1, maxSize: full ? 40 : 34, minSize: 26, lineHeight: A_LH, language }, measure) : null;
    const detail = p.detail ? fitText(p.detail, { font: brand.fonts.body, maxWidth: nameW, maxLines: 1, maxSize: full ? 32 : 28, minSize: 22, lineHeight: A_LH, language }, measure) : null;
    const cardH = pad + markH * 0.6 + quote.height + ruleGap + 6 + authorBlockH + pad;
    const top = placeInArea(area, cardH, zone);
    const card = { x: area.x, y: top, width: area.width, height: cardH };
    const x = area.x + pad;
    const mark = { x: x - 6, y: top + pad - markH * 0.38, width: markH, height: markH };
    let y = top + pad + markH * 0.6;
    const q = { fit: quote, box: { x, y, width: quote.width, height: quote.height } };
    y += quote.height + ruleGap;
    const rule = { x, y, width: 90, height: 6 };
    y += 6 + 26;
    const avatar = p.author ? { x, y, width: avatarS, height: avatarS } : null;
    const nx = x + avatarS + 24;
    const nameH = (author?.height ?? 0) + (detail?.height ?? 0);
    const ny = y + (avatarS - nameH) / 2;
    const a = author ? { fit: author, box: { x: nx, y: ny, width: author.width, height: author.height } } : null;
    const d = detail ? { fit: detail, box: { x: nx, y: ny + (author?.height ?? 0), width: detail.width, height: detail.height } } : null;
    const texts = [
      { field: "quote", fit: quote, preferred: full ? 72 : 58 },
      ...(author ? [{ field: "author", fit: author, preferred: full ? 40 : 34 }] : []),
      ...(detail ? [{ field: "detail", fit: detail, preferred: full ? 32 : 28 }] : []),
    ];
    return { layout: { card, mark, quote: q, author: a, detail: d, avatar, initials: p.author ? initialsOf(p.author) : "", rule }, box: card, texts };
  },
  render({ layout, brand, frame, fps }) {
    const c = brand.colors;
    const mark = itemProgress(frame, 2, fps, 12);
    const rule = landing(Math.min(1, Math.max(0, (frame - 8) / 10)));
    const who = itemProgress(frame, 9, fps, 10);
    return (
      <>
        <div style={surfaceStyle(brand, layout.card)} />
        <div
          style={{
            ...absolute(layout.mark),
            ...fontStyle(brand.fonts.display, layout.mark.height * 1.6, 1),
            color: c.accent,
            lineHeight: `${layout.mark.height * 1.25}px`,
            opacity: Math.min(1, mark * 1.5),
            transform: `scale(${(0.5 + 0.5 * mark).toFixed(4)}) rotate(${((1 - mark) * -12).toFixed(2)}deg)`,
            transformOrigin: "30% 60%",
          }}
        >
          “
        </div>
        <Lines fit={layout.quote.fit} font={brand.fonts.caption} lineHeight={Q_LH} color={c.onSurface} box={layout.quote.box} align="left" />
        <div style={{ ...absolute(layout.rule), borderRadius: 3, backgroundColor: c.accent, transform: `scaleX(${rule.toFixed(4)})`, transformOrigin: "left" }} />
        <div style={{ opacity: Math.min(1, who * 1.5), transform: `translateY(${((1 - who) * 20).toFixed(2)}px)` }}>
          {layout.avatar ? (
            <div
              style={{
                ...absolute(layout.avatar),
                borderRadius: layout.avatar.width / 2,
                backgroundColor: c.accent,
                color: c.onAccent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...fontStyle(brand.fonts.display, layout.avatar.width * 0.38, 1),
              }}
            >
              {layout.initials}
            </div>
          ) : null}
          {layout.author ? <Lines fit={layout.author.fit} font={brand.fonts.display} lineHeight={A_LH} color={c.onSurface} box={layout.author.box} align="left" /> : null}
          {layout.detail ? <Lines fit={layout.detail.fit} font={brand.fonts.body} lineHeight={A_LH} color={c.mutedOnSurface} box={layout.detail.box} align="left" /> : null}
        </div>
      </>
    );
  },
});
