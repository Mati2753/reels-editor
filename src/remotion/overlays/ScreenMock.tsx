import { z } from "zod";
import type { Box } from "../../edl/resolved";
import { fitText, type FitResult } from "../../edl/textfit";
import { itemProgress, landing, smooth } from "./motion";
import { defineOverlay, type TextReport } from "./types";
import { absolute, alpha, fontStyle, Icon, Lines } from "./ui";

/**
 * ScreenMock: a site, an app, a screen, as a drawn device (a phone, or a browser window)
 * that rises into place and whose page scrolls gently: address or app bar, a hero block in
 * the brand colours, the title, up to three lines, a button. A b-roll stand-in until real
 * screen recordings arrive with the b-roll (phase 7).
 */

export const ScreenMockProps = z.strictObject({
  device: z.enum(["phone", "browser"]).default("phone"),
  /** Address shown in the bar ("monsite.fr"), or the app's name. */
  url: z.string().min(1).max(28),
  title: z.string().min(1).max(40),
  lines: z.array(z.string().min(1).max(40)).max(3).default([]),
  /** Button label; none when absent. */
  button: z.string().min(1).max(18).optional(),
});
type Props = z.infer<typeof ScreenMockProps>;

const TITLE_LH = 1.12;
const LINE_LH = 1.3;

interface Layout {
  device: Box;
  screen: Box;
  bar: Box;
  urlFit: FitResult;
  hero: Box;
  title: { fit: FitResult; box: Box };
  lines: { fit: FitResult; box: Box }[];
  button: { fit: FitResult; box: Box } | null;
  /** Placeholder rows under the content, so the page reads as a page (no text). */
  rows: Box[];
  phone: boolean;
}

export const ScreenMock = defineOverlay<Props, Layout>({
  description: "Site, application, écran : appareil dessiné, page qui défile (b-roll)",
  props: ScreenMockProps,
  zones: ["full"],
  enter: { kind: "slide", duration: 0.4, direction: "down" },
  exit: { kind: "fade", duration: 0.2, direction: "down" },
  text: (p) => [p.title, ...p.lines, p.button ?? ""].join(" "),
  cueCount: () => 0,
  layout(p, { brand, measure, language, area }) {
    const phone = p.device === "phone";
    const bezel = phone ? 18 : 0;
    const h = Math.min(area.height - 20, phone ? 940 : 760);
    const w = phone ? Math.round(h * 0.5) : area.width;
    const device = { x: area.x + (area.width - w) / 2, y: area.y + (area.height - h) / 2, width: w, height: h };
    const screen = { x: device.x + bezel, y: device.y + bezel, width: w - 2 * bezel, height: h - 2 * bezel };
    const pad = phone ? 30 : 40;
    const inner = screen.width - 2 * pad;
    const barTop = screen.y + (phone ? 64 : 24);
    const barH = phone ? 58 : 62;
    const bar = { x: screen.x + pad, y: barTop, width: inner, height: barH };
    const urlFit = fitText(p.url, { font: brand.fonts.body, maxWidth: inner - 110, maxLines: 1, maxSize: phone ? 26 : 28, minSize: 18, lineHeight: 1.2, language }, measure);
    const heroH = phone ? Math.round(screen.height * 0.27) : Math.round(screen.height * 0.3);
    const hero = { x: screen.x + pad, y: bar.y + barH + 28, width: inner, height: heroH };
    const title = fitText(p.title, { font: brand.fonts.display, maxWidth: inner, maxLines: 3, maxSize: phone ? 48 : 52, minSize: 30, lineHeight: TITLE_LH, language }, measure);
    let y = hero.y + heroH + 30;
    const t = { fit: title, box: { x: screen.x + pad, y, width: title.width, height: title.height } };
    y += title.height + 18;
    const lines = p.lines.map((l) => {
      const f = fitText(l, { font: brand.fonts.body, maxWidth: inner, maxLines: 2, maxSize: phone ? 28 : 30, minSize: 22, lineHeight: LINE_LH, language }, measure);
      const box = { x: screen.x + pad, y, width: f.width, height: f.height };
      y += f.height + 8;
      return { fit: f, box };
    });
    let button: Layout["button"] = null;
    const texts: TextReport[] = [
      { field: "url", fit: urlFit, preferred: phone ? 26 : 28 },
      { field: "title", fit: title, preferred: phone ? 48 : 52 },
      ...lines.map((l, k) => ({ field: `lines[${k}]`, fit: l.fit, preferred: phone ? 28 : 30 })),
    ];
    if (p.button) {
      const f = fitText(p.button, { font: brand.fonts.caption, maxWidth: inner - 60, maxLines: 1, maxSize: phone ? 32 : 34, minSize: 22, lineHeight: 1.2, language }, measure);
      y += 18;
      button = { fit: f, box: { x: screen.x + pad, y, width: f.width + 64, height: f.height + 30 } };
      texts.push({ field: "button", fit: f, preferred: phone ? 32 : 34 });
      y += f.height + 30;
    }
    const rows: Box[] = [];
    const rowH = phone ? 120 : 110;
    for (let ry = y + 34; ry + rowH <= screen.y + screen.height + 80; ry += rowH + 22) rows.push({ x: screen.x + pad, y: ry, width: inner, height: rowH });
    // Content taller than the screen: what does not fit is clipped by the screen, reported.
    if (y > screen.y + screen.height - 20) texts.push({ field: "lines", fit: { ...title, overflow: true, text: "page content" }, preferred: title.fontSize });
    return { layout: { device, screen, bar, urlFit, hero, title: t, lines, button, rows, phone }, box: device, texts };
  },
  render({ layout, brand, frame, fps, durationInFrames }) {
    const c = brand.colors;
    const { device, screen, bar, hero, phone } = layout;
    // The page scrolls up a little over the whole overlay, starting once the device has landed.
    const scroll = 40 * smooth(Math.min(1, Math.max(0, (frame - 12) / Math.max(1, durationInFrames - 20))));
    const tilt = 1 - itemProgress(frame, 0, fps, 16);
    const content = landing(Math.min(1, Math.max(0, (frame - 4) / 12)));
    const r = phone ? 64 : 26;
    const shift = (b: Box): Box => ({ ...b, y: b.y - scroll });
    return (
      <div style={{ perspective: 1600, position: "absolute", inset: 0 }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotateX(${(tilt * 14).toFixed(2)}deg)`, transformOrigin: `${device.x + device.width / 2}px ${device.y + device.height}px` }}>
          <div
            style={{ ...absolute(device), borderRadius: r, backgroundColor: phone ? "#0a0b0d" : c.surface, boxShadow: `0 40px 90px ${alpha(c.outline, 0.55)}, 0 0 0 2px ${alpha(c.muted, 0.35)}` }}
          />
          <div style={{ ...absolute(screen), borderRadius: phone ? r - 16 : r, overflow: "hidden", backgroundColor: c.surface }}>
            {/* Page, in frame coordinates, offset by the screen and the scroll. */}
            <div style={{ position: "absolute", left: -screen.x, top: -screen.y, width: 1080, height: 1920, opacity: content }}>
              <div
                style={{
                  ...absolute(shift(bar)),
                  borderRadius: bar.height / 2,
                  backgroundColor: alpha(c.onSurface, 0.07),
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  paddingLeft: 22,
                  color: c.mutedOnSurface,
                }}
              >
                <Icon name="lock" size={bar.height * 0.42} color={c.mutedOnSurface} />
                <span style={{ ...fontStyle(brand.fonts.body, layout.urlFit.fontSize, 1.2), whiteSpace: "pre" }}>{layout.urlFit.lines[0]}</span>
              </div>
              <div
                style={{
                  ...absolute(shift(hero)),
                  borderRadius: 22,
                  overflow: "hidden",
                  background: `radial-gradient(circle at 78% 30%, ${alpha(c.active, 0.85)} 0 12%, transparent 13%), linear-gradient(135deg, ${c.accent}, ${c.panelAlt})`,
                }}
              >
                <div style={{ position: "absolute", left: "8%", bottom: "-30%", width: "55%", height: "80%", borderRadius: "50%", backgroundColor: alpha(c.surface, 0.18) }} />
              </div>
              <Lines fit={layout.title.fit} font={brand.fonts.display} lineHeight={TITLE_LH} color={c.onSurface} box={shift(layout.title.box)} align="left" />
              {layout.lines.map((l, k) => (
                <Lines key={k} fit={l.fit} font={brand.fonts.body} lineHeight={LINE_LH} color={c.mutedOnSurface} box={shift(l.box)} align="left" />
              ))}
              {layout.rows.map((row, k) => {
                const b = shift(row);
                const thumb = b.height;
                return (
                  <div key={`r${k}`}>
                    <div style={{ position: "absolute", left: b.x, top: b.y, width: thumb, height: thumb, borderRadius: 18, backgroundColor: alpha(k % 2 ? c.accent : c.active, 0.22) }} />
                    <div
                      style={{
                        position: "absolute",
                        left: b.x + thumb + 24,
                        top: b.y + 14,
                        width: (b.width - thumb - 24) * 0.85,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: alpha(c.onSurface, 0.14),
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: b.x + thumb + 24,
                        top: b.y + 52,
                        width: (b.width - thumb - 24) * 0.6,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: alpha(c.onSurface, 0.08),
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: b.x + thumb + 24,
                        top: b.y + 84,
                        width: (b.width - thumb - 24) * 0.4,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: alpha(c.onSurface, 0.08),
                      }}
                    />
                  </div>
                );
              })}
              {layout.button ? (
                <div
                  style={{
                    ...absolute(shift(layout.button.box)),
                    borderRadius: layout.button.box.height / 2,
                    backgroundColor: c.accent,
                    color: c.onAccent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...fontStyle(brand.fonts.caption, layout.button.fit.fontSize, 1.2),
                    whiteSpace: "pre",
                  }}
                >
                  {layout.button.fit.lines[0]}
                </div>
              ) : null}
            </div>
            {phone ? (
              // Status bar and notch drawn over the page.
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  right: 0,
                  height: 56,
                  backgroundColor: c.surface,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 34px",
                  color: c.onSurface,
                  ...fontStyle(brand.fonts.caption, 24, 1),
                }}
              >
                <span>9:41</span>
                <span style={{ width: 120, height: 32, borderRadius: 16, backgroundColor: "#0a0b0d" }} />
                <span style={{ display: "flex", gap: 6 }}>
                  <span style={{ width: 26, height: 14, borderRadius: 4, border: `2px solid ${c.onSurface}` }} />
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
});
