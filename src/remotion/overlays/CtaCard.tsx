import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing } from "./motion";
import { defineOverlay } from "./types";
import { absolute, alpha, fontStyle, Icon, Lines, placeInArea, surfaceStyle } from "./ui";

/**
 * CtaCard: the single call to action of the end (docs/DIRECTOR.md, Fin): a light card with
 * the action's icon in an accent button that taps once it has landed, the action in heavy
 * type, an optional line under it and the account handle.
 */

export const CtaCardProps = z.strictObject({
  /** The action, imperative ("Abonne-toi", "Enregistre ce Reel"). */
  title: z.string().min(1).max(28),
  subtitle: z.string().min(1).max(44).optional(),
  action: z.enum(["follow", "save", "comment", "share", "like", "link"]).default("follow"),
  /** Account name shown under the text ("@moncompte"). */
  handle: z.string().min(1).max(24).optional(),
});
type Props = z.infer<typeof CtaCardProps>;

const TITLE_LH = 1.08;
const SUB_LH = 1.25;

interface Layout {
  card: Box;
  button: Box;
  title: { fit: FitResult; box: Box };
  subtitle: { fit: FitResult; box: Box } | null;
  handle: { fit: FitResult; box: Box } | null;
  align: "left" | "center";
}

export const CtaCard = defineOverlay<Props, Layout>({
  description: "Appel à l'action final : carte claire, icône de l'action, compte",
  props: CtaCardProps,
  zones: ["bottom", "center", "full"],
  enter: { kind: "slide", duration: 0.37, direction: "down" },
  exit: { kind: "slide", duration: 0.2, direction: "down" },
  text: (p) => [p.title, p.subtitle ?? "", p.handle ?? ""].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, zone, area }) {
    const big = zone === "full";
    const sizes = big ? { title: 88, sub: 44, handle: 40 } : { title: 64, sub: 36, handle: 32 };
    const texts = (textW: number) => {
      const title = fitText(p.title, { font: brand.fonts.display, maxWidth: textW, maxLines: 2, maxSize: sizes.title, minSize: 44, lineHeight: TITLE_LH, language }, measure);
      const sub = p.subtitle ? fitText(p.subtitle, { font: brand.fonts.body, maxWidth: textW, maxLines: 2, maxSize: sizes.sub, minSize: 26, lineHeight: SUB_LH, language }, measure) : null;
      const handle = p.handle ? fitText(p.handle, { font: brand.fonts.caption, maxWidth: textW - 28, maxLines: 1, maxSize: sizes.handle, minSize: 24, lineHeight: 1.2, language }, measure) : null;
      return { title, sub, handle };
    };
    const subGap = p.subtitle ? 14 : 0;
    const handleGap = p.handle ? 22 : 0;
    const stackH = (t: ReturnType<typeof texts>) => t.title.height + subGap + (t.sub?.height ?? 0) + handleGap + (t.handle ? t.handle.height + 8 : 0);
    let card: Box;
    let button: Box;
    let tx: number;
    let ty: number;
    let align: "left" | "center";
    let t: ReturnType<typeof texts>;
    if (big) {
      // End card: the button above, the text centred under it, on a card as wide as the zone.
      const pad = 64;
      const b = 190;
      const gap = 44;
      t = texts(area.width - 2 * pad);
      const h = stackH(t);
      const cardH = pad + b + gap + h + pad;
      const top = placeInArea(area, cardH, zone);
      card = { x: area.x, y: top, width: area.width, height: cardH };
      button = { x: area.x + (area.width - b) / 2, y: top + pad, width: b, height: b };
      tx = area.x + area.width / 2;
      ty = top + pad + b + gap;
      align = "center";
    } else {
      // Horizontal card across the zone: the button on the left, the text beside it.
      const pad = 44;
      const b = 136;
      const gap = 36;
      t = texts(area.width - 2 * pad - b - gap);
      const h = stackH(t);
      const cardH = Math.max(b, h) + 2 * pad;
      const top = placeInArea(area, cardH, zone, 30);
      card = { x: area.x, y: top, width: area.width, height: cardH };
      button = { x: area.x + pad, y: top + (cardH - b) / 2, width: b, height: b };
      tx = area.x + pad + b + gap;
      ty = top + (cardH - h) / 2;
      align = "left";
    }
    const place = (w: number, x0: number) => (align === "center" ? x0 - w / 2 : x0);
    const title = { fit: t.title, box: { x: place(t.title.width, tx), y: ty, width: t.title.width, height: t.title.height } };
    ty += t.title.height + subGap;
    const subtitle = t.sub ? { fit: t.sub, box: { x: place(t.sub.width, tx), y: ty, width: t.sub.width, height: t.sub.height } } : null;
    ty += (t.sub?.height ?? 0) + handleGap;
    const handle = t.handle ? { fit: t.handle, box: { x: place(t.handle.width, tx) + (align === "center" ? 0 : 14), y: ty + 4, width: t.handle.width, height: t.handle.height } } : null;
    const reports = [
      { field: "title", fit: t.title, preferred: sizes.title },
      ...(t.sub ? [{ field: "subtitle", fit: t.sub, preferred: sizes.sub }] : []),
      ...(t.handle ? [{ field: "handle", fit: t.handle, preferred: sizes.handle }] : []),
    ];
    return { layout: { card, button, title, subtitle, handle, align }, box: card, texts: reports };
  },
  render({ props, layout, brand, frame, fps, enterMotion }) {
    const c = brand.colors;
    const { card, button } = layout;
    const landed = enterMotion.durationInFrames + 4;
    // One tap on the button after the card has landed, with a ripple.
    const tap = frame >= landed ? Math.sin(Math.min(1, (frame - landed) / 10) * Math.PI) : 0;
    const ripple = landing(Math.min(1, Math.max(0, (frame - landed) / 18)));
    const icon = itemProgress(frame, 3, fps, 12);
    return (
      <>
        <div style={surfaceStyle(brand, card)} />
        <div
          style={{
            ...absolute(button),
            borderRadius: button.width / 2,
            border: `4px solid ${c.accent}`,
            opacity: frame >= landed ? 0.7 * (1 - ripple) : 0,
            transform: `scale(${(1 + 0.45 * ripple).toFixed(4)})`,
          }}
        />
        <div
          style={{
            ...absolute(button),
            borderRadius: button.width / 2,
            backgroundColor: c.accent,
            boxShadow: `0 10px 26px ${alpha(c.accent, 0.45)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${((0.5 + 0.5 * icon) * (1 - 0.1 * tap)).toFixed(4)})`,
          }}
        >
          <Icon name={props.action} size={button.width * 0.5} color={c.onAccent} strokeWidth={2.4} />
        </div>
        <Lines fit={layout.title.fit} font={brand.fonts.display} lineHeight={TITLE_LH} color={c.onSurface} box={layout.title.box} align={layout.align} />
        {layout.subtitle ? <Lines fit={layout.subtitle.fit} font={brand.fonts.body} lineHeight={SUB_LH} color={c.mutedOnSurface} box={layout.subtitle.box} align={layout.align} /> : null}
        {layout.handle ? (
          <div style={{ ...absolute(layout.handle.box), ...fontStyle(brand.fonts.caption, layout.handle.fit.fontSize, 1.2), color: c.onSurface, whiteSpace: "pre" }}>
            <span style={{ position: "absolute", inset: "-4px -14px", borderRadius: 999, backgroundColor: alpha(c.accent, 0.2) }} />
            <span style={{ position: "relative" }}>{layout.handle.fit.lines[0]}</span>
          </div>
        ) : null}
      </>
    );
  },
});
