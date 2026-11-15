import { AbsoluteFill, random } from "remotion";
import type { PresentationProps } from "./types";

/**
 * Digital glitch around the cut: the picture splits into horizontal bands shifted sideways,
 * colour channels separate, a few bars of the brand's accent colour flicker. Strongest on
 * the cut, where the outgoing picture gives way to the incoming one. Deterministic: the
 * noise is seeded by the transition and the frame.
 */
export function Glitch({ A, B, frame, cut, durationInFrames, brand, seed }: PresentationProps) {
  const before = frame < cut;
  const span = Math.max(1, before ? cut : durationInFrames - cut);
  const dist = before ? (cut - frame) / span : (frame - cut + 1) / span;
  const strength = Math.max(0.15, 1 - dist * 0.85);
  const r = (k: string) => random(`${seed}-${frame}-${k}`);
  const main = before ? A : B;
  const other = before ? B : A;
  const split = Math.round(8 + 26 * strength);
  const id = `glitch-rgb-${seed}-${frame}`;

  const bands: { top: number; height: number; dx: number; useOther: boolean }[] = [];
  const count = 4 + Math.floor(r("n") * 4);
  for (let i = 0; i < count; i++) {
    const height = 2 + r(`h${i}`) * 12;
    const top = r(`t${i}`) * (100 - height);
    const dx = (r(`x${i}`) - 0.5) * 2 * 14 * strength;
    bands.push({ top, height, dx, useOther: r(`o${i}`) < 0.3 * strength });
  }
  const bars = [0, 1].map((i) => ({ top: r(`bt${i}`) * 96, height: 0.4 + r(`bh${i}`) * 1.4, left: r(`bl${i}`) * 40, width: 30 + r(`bw${i}`) * 60, on: r(`bo${i}`) < 0.6 * strength }));
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
        <defs>
          <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={split} dy="0" result="ro" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
            <feOffset in="b" dx={-split} dy="0" result="bo" />
            <feBlend in="ro" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill style={{ filter: `url(#${id})` }}>
        <AbsoluteFill>{main}</AbsoluteFill>
        {bands.map((b, i) => (
          <AbsoluteFill key={i} style={{ clipPath: `inset(${b.top}% 0 ${100 - b.top - b.height}% 0)`, transform: `translateX(${b.dx}%)` }}>
            {b.useOther ? other : main}
          </AbsoluteFill>
        ))}
      </AbsoluteFill>
      {bars.map((b, i) =>
        b.on ? (
          <div
            key={i}
            style={{
              position: "absolute",
              top: `${b.top}%`,
              left: `${b.left}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
              backgroundColor: i === 0 ? brand.colors.accent : brand.colors.active,
              mixBlendMode: "screen",
              opacity: 0.85,
            }}
          />
        ) : null,
      )}
    </AbsoluteFill>
  );
}
