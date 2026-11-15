import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress } from "./motion";
import { defineOverlay, type TextReport } from "./types";
import { absolute, alpha, fontStyle, Lines, placeInArea } from "./ui";

/**
 * ChatBubble: 1 to 3 messages of a conversation (a question received, a reply), each
 * popping from its side on its word (`cues`). Messages from the other person on light
 * bubbles on the left, the creator's own in the accent colour on the right.
 */

export const ChatBubbleProps = z.strictObject({
  /** Name shown above the conversation ("Abonné", "@client"). */
  name: z.string().min(1).max(24).optional(),
  messages: z
    .array(z.strictObject({ text: z.string().min(1).max(60), from: z.enum(["them", "me"]).default("them") }))
    .min(1)
    .max(3),
});
type Props = z.infer<typeof ChatBubbleProps>;

const LH = 1.22;
/** Smallest message size, px: below it a phone screen no longer reads it. */
const MIN = 34;

interface Bubble {
  box: Box;
  fit: FitResult;
  text: Box;
  from: "them" | "me";
}

interface Layout {
  name: { fit: FitResult; box: Box } | null;
  bubbles: Bubble[];
}

const fallbackCue = (k: number) => 3 + k * 10;

export const ChatBubble = defineOverlay<Props, Layout>({
  description: "Message, question reçue, échange : bulles de conversation, une par mot",
  props: ChatBubbleProps,
  zones: ["center", "top", "full"],
  enter: { kind: "fade", duration: 0.17, direction: "up" },
  exit: { kind: "fade", duration: 0.17, direction: "up" },
  text: (p) => [p.name ?? "", ...p.messages.map((m) => m.text)].join(" "),
  cueCount: (p) => p.messages.length,
  layout(p, { brand, measure, language, zone, area }) {
    const full = zone === "full";
    const maxSize = full ? 60 : 52;
    let out: { layout: Layout; reports: TextReport[]; box: Box } | null = null;
    for (let size = maxSize; size >= MIN; size -= 2) {
      const padX = Math.round(size * 0.62);
      const padY = Math.round(size * 0.42);
      const gap = Math.round(size * 0.36);
      const maxBubble = area.width * 0.82;
      const nameFit = p.name
        ? fitText(p.name, { font: brand.fonts.body, maxWidth: area.width - 40, maxLines: 1, maxSize: Math.round(size * 0.66), minSize: 24, lineHeight: 1.2, language }, measure)
        : null;
      const fits = p.messages.map((m) => fitText(m.text, { font: brand.fonts.body, maxWidth: maxBubble - 2 * padX, maxLines: 3, maxSize: size, minSize: size, lineHeight: LH, language }, measure));
      const hs = fits.map((f) => f.height + 2 * padY);
      const nameH = nameFit ? nameFit.height + 16 + gap : 0;
      const height = nameH + hs.reduce((a, b) => a + b, 0) + gap * (fits.length - 1);
      const reports: TextReport[] = [
        ...(nameFit ? [{ field: "name", fit: nameFit, preferred: Math.round(maxSize * 0.72) }] : []),
        ...fits.map((f, k) => ({ field: `messages[${k}].text`, fit: { ...f, shrunk: size < maxSize }, preferred: maxSize })),
      ];
      const ok = height <= area.height - 24 && !fits.some((f) => f.overflow);
      if (!ok && size - 2 >= MIN) continue;
      if (!ok) reports.push({ field: "messages", fit: { ...fits[0]!, overflow: true, text: `${p.messages.length} messages` }, preferred: maxSize });
      let y = placeInArea(area, height, zone);
      const top = y;
      const name = nameFit ? { fit: nameFit, box: { x: area.x + 20, y: y + 8, width: nameFit.width, height: nameFit.height } } : null;
      y += nameH;
      const bubbles = fits.map((f, k) => {
        const from = p.messages[k]!.from;
        const w = f.width + 2 * padX;
        const x = from === "me" ? area.x + area.width - w : area.x;
        const box = { x, y, width: w, height: hs[k]! };
        y += hs[k]! + gap;
        return { box, fit: f, text: { x: x + padX, y: box.y + padY, width: f.width, height: f.height }, from };
      });
      out = { layout: { name, bubbles }, reports, box: { x: area.x, y: top, width: area.width, height: height } };
      break;
    }
    return { layout: out!.layout, box: out!.box, texts: out!.reports };
  },
  render({ layout, brand, frame, fps, cues }) {
    const c = brand.colors;
    const at = (k: number) => cues[k] ?? fallbackCue(k);
    return (
      <>
        {layout.name ? (
          <>
            <div
              style={{
                position: "absolute",
                left: layout.name.box.x - 20,
                top: layout.name.box.y - 8,
                width: layout.name.box.width + 40,
                height: layout.name.box.height + 16,
                borderRadius: 999,
                backgroundColor: alpha(c.panel, brand.shape.panelOpacity),
              }}
            />
            <Lines fit={layout.name.fit} font={brand.fonts.body} lineHeight={1.2} color={c.text} box={layout.name.box} align="left" />
          </>
        ) : null}
        {layout.bubbles.map((b, k) => {
          const p = itemProgress(frame, at(k), fps, 9);
          if (p <= 0) return null;
          const me = b.from === "me";
          const h = b.box.height;
          const r = Math.min(h / 2, 44);
          // The tail corner (bottom, towards the speaker) stays tight.
          const radius = me ? `${r}px ${r}px 10px ${r}px` : `${r}px ${r}px ${r}px 10px`;
          return (
            <div key={k} style={{ transform: `scale(${(0.6 + 0.4 * p).toFixed(4)})`, transformOrigin: `${me ? b.box.x + b.box.width : b.box.x}px ${b.box.y + h}px`, opacity: Math.min(1, p * 2) }}>
              <div style={{ ...absolute(b.box), borderRadius: radius, backgroundColor: me ? c.accent : c.surface, boxShadow: brand.shape.shadow }} />
              <Lines
                fit={b.fit}
                font={brand.fonts.body}
                lineHeight={LH}
                color={me ? c.onAccent : c.onSurface}
                box={b.text}
                align="left"
                style={{ ...fontStyle(brand.fonts.body, b.fit.fontSize, LH) }}
              />
            </div>
          );
        })}
      </>
    );
  },
});
