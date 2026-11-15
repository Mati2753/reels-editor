import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import type { BrandKit, FontSpec } from "../../brand";
import type { Box } from "../../edl/resolved";
import type { FitResult } from "../../edl/textfit";

/**
 * Drawing primitives shared by the overlays. Every colour, font, radius and shadow comes
 * from the brand kit; sizes and positions come from the layout the resolver computed.
 */

/** A colour at an opacity (0..1), for any CSS colour of the brand. */
export function alpha(color: string, opacity: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(opacity * 1000) / 10}%, transparent)`;
}

export function fontStyle(font: FontSpec, size: number, lineHeight: number, letterSpacing = 0): CSSProperties {
  return { fontFamily: font.family, fontWeight: font.weight, fontSize: size, lineHeight: `${size * lineHeight}px`, letterSpacing: `${letterSpacing}em` };
}

/** Full-frame backdrop of a full-zone overlay: the brand's panel, a soft accent glow. */
export const Backdrop: React.FC<{ brand: BrandKit; opacity: number }> = ({ brand, opacity }) => {
  const c = brand.colors;
  return (
    <AbsoluteFill
      style={{
        opacity,
        background: [
          `radial-gradient(ellipse 70% 45% at 85% 8%, ${alpha(c.accent, 0.22)}, transparent 70%)`,
          `radial-gradient(ellipse 60% 40% at 10% 95%, ${alpha(c.active, 0.1)}, transparent 70%)`,
          `linear-gradient(165deg, ${c.panelAlt} 0%, ${c.panel} 62%)`,
        ].join(", "),
      }}
    />
  );
};

/** Dark card drawn over the picture. */
export function panelStyle(brand: BrandKit, box: Box, radius = brand.shape.radius): CSSProperties {
  return {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    borderRadius: radius,
    backgroundColor: alpha(brand.colors.panel, brand.shape.panelOpacity),
    boxShadow: brand.shape.shadow,
  };
}

/** Light card drawn over the picture. */
export function surfaceStyle(brand: BrandKit, box: Box, radius = brand.shape.radius): CSSProperties {
  return {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    borderRadius: radius,
    backgroundColor: brand.colors.surface,
    boxShadow: brand.shape.shadow,
  };
}

export function absolute(box: Box): CSSProperties {
  return { position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height };
}

/**
 * Lines of a fitted text, one div per line, exactly as measured: no wrapping by the
 * browser. `align` within `box`.
 */
export const Lines: React.FC<{
  fit: FitResult;
  font: FontSpec;
  lineHeight: number;
  letterSpacing?: number;
  color: string;
  box: Box;
  align?: "left" | "center" | "right";
  renderLine?: (line: string, index: number) => ReactNode;
  style?: CSSProperties;
}> = ({ fit, font, lineHeight, letterSpacing = 0, color, box, align = "center", renderLine, style }) => (
  <div style={{ ...absolute(box), ...fontStyle(font, fit.fontSize, lineHeight, letterSpacing), color, textAlign: align, ...style }}>
    {fit.lines.map((l, i) => (
      <div key={i} style={{ whiteSpace: "pre", height: fit.fontSize * lineHeight }}>
        {renderLine ? renderLine(l, i) : l}
      </div>
    ))}
  </div>
);

/** Icons drawn on a 24 px grid, stroked with the current colour. */
export type IconName = "follow" | "save" | "comment" | "share" | "like" | "link" | "person" | "pin" | "tool" | "brand" | "check" | "cross" | "arrow" | "bell" | "star" | "lock" | "quote";

const ICONS: Record<IconName, ReactNode> = {
  follow: (
    <>
      <circle cx="9.5" cy="8" r="3.6" />
      <path d="M3 20c.6-3.6 3.3-5.6 6.5-5.6s5.9 2 6.5 5.6" />
      <path d="M19 7.5v6M16 10.5h6" />
    </>
  ),
  save: <path d="M6.5 3.8h11a1 1 0 0 1 1 1V20.5l-6.5-4.4-6.5 4.4V4.8a1 1 0 0 1 1-1z" />,
  comment: <path d="M4 5.5h16a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H10l-4.5 3.6V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />,
  share: (
    <>
      <path d="M21 3.5 10.2 13.8" />
      <path d="M21 3.5 14.4 20.5l-4.2-6.7-6.7-4.2z" />
    </>
  ),
  like: <path d="M12 20.3S3.5 15 3.5 9.2A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.6C20.5 15 12 20.3 12 20.3z" />,
  link: (
    <>
      <path d="M10 14a4.2 4.2 0 0 0 6 0l3.2-3.2a4.2 4.2 0 0 0-6-6L12 6" />
      <path d="M14 10a4.2 4.2 0 0 0-6 0l-3.2 3.2a4.2 4.2 0 0 0 6 6L12 18" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c.7-4 3.7-6.2 7.5-6.2s6.8 2.2 7.5 6.2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.8" r="2.3" />
    </>
  ),
  tool: <path d="M14.6 6.2a4.3 4.3 0 0 0 5.2 5.2l-8.6 8.6a2 2 0 0 1-2.9 0l-.3-.3a2 2 0 0 1 0-2.9l8.6-8.6zM14.6 6.2 17.4 3.4M19.8 11.4l2.8-2.8" />,
  brand: <path d="M12 3.2 14.7 8.7l6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9z" />,
  star: <path d="M12 3.2 14.7 8.7l6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9z" />,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  cross: <path d="M6 6 18 18M18 6 6 18" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  quote: <path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h4v1.5A3.5 3.5 0 0 1 5.5 17M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h4v1.5a3.5 3.5 0 0 1-3.5 3.5" />,
  arrow: (
    <>
      <path d="M4 12h15" />
      <path d="M13.5 6 19.5 12l-6 6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
};

export const Icon: React.FC<{ name: IconName; size: number; color: string; strokeWidth?: number; style?: CSSProperties }> = ({ name, size, color, strokeWidth = 2.2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
    {ICONS[name]}
  </svg>
);

/** Union of boxes. */
export function union(...boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Vertical position of a block of height h in a zone: top-aligned in "top", bottom-aligned in "bottom", centred otherwise. */
export function placeInArea(area: Box, height: number, zone: string, inset = 24): number {
  if (zone === "top") return area.y + inset;
  if (zone === "bottom") return area.y + area.height - height - inset;
  return area.y + (area.height - height) / 2;
}

/** Normalized word, for matching highlights. */
export function bareWord(w: string): string {
  return w
    .toLocaleLowerCase("fr")
    .replace(/[’`]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
