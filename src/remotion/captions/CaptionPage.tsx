import { Easing, interpolate } from "remotion";
import type { BrandKit } from "../../brand";
import type { ResolvedCaptionPage, ResolvedToken } from "../../edl/resolved";
import type { CaptionStyle } from "./styles";

/**
 * One caption page in the "bold" family of styles: bold outlined text, the spoken word in
 * the brand's active colour and slightly larger, emphasis in the brand's accent colour,
 * larger, or on an accent box. Lines and font size come laid out from the resolver; the
 * box is the one validate checked against the safe zone.
 */
export const CaptionPage: React.FC<{ page: ResolvedCaptionPage; frame: number; style: CaptionStyle; brand: BrandKit }> = ({ page, frame, style, brand }) => {
  const font = brand.fonts.caption;
  const filterId = "reel-caption-outline";
  const enter = interpolate(frame - page.fromFrame, [0, style.enterFrames], [style.enterScale, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div
      style={{
        position: "absolute",
        left: page.box.x,
        top: page.box.y,
        width: page.box.width,
        height: page.box.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${enter})`,
        fontFamily: font.family,
        fontWeight: font.weight,
        fontSize: page.fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: `${style.letterSpacing}em`,
        wordSpacing: `${style.wordSpacing}em`,
        color: brand.colors.text,
      }}
    >
      <OutlineFilter id={filterId} style={style} color={brand.colors.outline} />
      {page.lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: "pre", height: page.fontSize * style.lineHeight, display: "flex", alignItems: "center" }}>
          {line.map((t, k) => (
            <span key={t.word + k}>
              {k > 0 ? " " : ""}
              <Token token={t} active={frame >= t.fromFrame && frame < t.toFrame} style={style} brand={brand} filter={`url(#${filterId})`} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Outline and shadow of the text: the glyphs' alpha dilated by the outline width (square
 * corners, no miter spikes on V, M or A as with -webkit-text-stroke), filled with the
 * brand's outline colour, plus a soft shadow.
 */
const OutlineFilter: React.FC<{ id: string; style: CaptionStyle; color: string }> = ({ id, style, color }) => (
  <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
    <defs>
      <filter id={id} x="-40%" y="-60%" width="180%" height="220%" colorInterpolationFilters="sRGB">
        <feMorphology in="SourceAlpha" operator="dilate" radius={style.outlineWidth} result="dilated" />
        <feFlood floodColor={color} result="ink" />
        <feComposite in="ink" in2="dilated" operator="in" result="outline" />
        <feGaussianBlur in="outline" stdDeviation={style.shadowBlur / 2} result="blur" />
        <feOffset in="blur" dy={style.shadowBlur / 4} result="shadow" />
        <feComponentTransfer in="shadow" result="softShadow">
          <feFuncA type="linear" slope={0.7} />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="softShadow" />
          <feMergeNode in="outline" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  </svg>
);

const Token: React.FC<{ token: ResolvedToken; active: boolean; style: CaptionStyle; brand: BrandKit; filter: string }> = ({ token, active, style, brand, filter }) => {
  const c = brand.colors;
  const base: React.CSSProperties = {
    display: "inline-block",
    transform: active ? `scale(${style.activeScale})` : undefined,
    color: active ? c.active : c.text,
    filter,
  };
  if (token.emphasis === "color") return <span style={{ ...base, color: c.accent }}>{token.text}</span>;
  if (token.emphasis === "scale") return <span style={{ ...base, fontSize: `${style.emphasisScale}em` }}>{token.text}</span>;
  if (token.emphasis === "box") {
    return (
      <span
        style={{
          ...base,
          color: c.onAccent,
          filter: undefined,
          background: c.accent,
          padding: `${style.boxPadding.y}em ${style.boxPadding.x}em`,
          borderRadius: "0.14em",
          lineHeight: 1,
        }}
      >
        {token.text}
      </span>
    );
  }
  return <span style={base}>{token.text}</span>;
};
