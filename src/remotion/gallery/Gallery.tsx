import { AbsoluteFill, Folder, Freeze, type CalculateMetadataFunction } from "remotion";
import { Composition } from "remotion";
import type { BrandKit } from "../../brand";
import { measurerFromFonts } from "../../edl/measure-core";
import { resolveEdl } from "../../edl/resolve";
import type { ResolvedEdl } from "../../edl/resolved";
import type { Edl } from "../../edl/schema";
import { safeArea, zoneArea } from "../../edl/zones";
import { FONT_URLS, useBrandFonts } from "../fonts";
import { overlays } from "../overlays";
import { Reel } from "../Reel";
import { overlaySampleEdl, overlaySamples, settledFrame, transitionSampleEdl, transitionSamples, type Background, type SheetCell } from "./samples";

/**
 * Gallery of the Studio (docs/ARCHITECTURE.md): one composition per overlay sample and per
 * transition, resolved in the browser by the same resolver as a real Reel (fonts measured
 * with the same files), plus contact sheets that tile many samples at a chosen state.
 */

async function browserMeasurer() {
  const buffers = new Map<string, ArrayBuffer>();
  await Promise.all(
    Object.entries(FONT_URLS).map(async ([file, url]) => {
      buffers.set(file, await (await fetch(url)).arrayBuffer());
    }),
  );
  return measurerFromFonts((font) => {
    const b = buffers.get(font.file);
    if (!b) throw new Error(`font ${font.file} is not bundled`);
    return b;
  });
}

export async function resolveSample(edl: Edl): Promise<ResolvedEdl> {
  const r = resolveEdl(edl, { probe: { version: 1, clips: [] }, analysis: { words: [] } }, { measure: await browserMeasurer() });
  if (!r.resolved) throw new Error(`gallery sample "${edl.meta.title}" does not resolve: ${r.issues.map((i) => i.message).join("; ")}`);
  const errors = r.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) console.warn(`gallery sample "${edl.meta.title}": ${errors.map((i) => `[${i.rule}] ${i.message}`).join("; ")}`);
  return r.resolved;
}

interface SampleProps extends Record<string, unknown> {
  edl: Edl;
  resolved: ResolvedEdl | null;
  guides: boolean;
}

const calculateSample: CalculateMetadataFunction<SampleProps> = async ({ props }) => {
  const resolved = await resolveSample(props.edl);
  return { durationInFrames: resolved.durationInFrames, props: { ...props, resolved } };
};

const Sample: React.FC<SampleProps> = ({ resolved, guides }) => {
  if (!resolved) return null;
  return (
    <AbsoluteFill>
      <Reel edl={resolved} />
      {guides ? <Guides brand={resolved.brand} /> : null}
    </AbsoluteFill>
  );
};

/** Thin lines on the safe area (magenta) and the zones (cyan), to check placements. */
export const Guides: React.FC<{ brand: BrandKit }> = ({ brand }) => {
  const s = safeArea(brand.safeZone);
  const zones = (["top", "center", "bottom"] as const).map((z) => zoneArea(z, brand.safeZone, true));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: s.x, top: s.y, width: s.width, height: s.height, outline: "3px dashed rgba(255, 0, 200, 0.9)" }} />
      {zones.map((z, i) => (
        <div key={i} style={{ position: "absolute", left: z.x, top: z.y, width: z.width, height: z.height, outline: "2px dotted rgba(0, 220, 255, 0.7)" }} />
      ))}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- contact sheets

interface SheetProps extends Record<string, unknown> {
  cells: SheetCell[];
  columns: number;
  /** Cell width, px (height follows 9:16). */
  cellWidth: number;
  guides: boolean;
  resolved: ResolvedEdl[] | null;
}

const LABEL_H = 34;

const calculateSheet: CalculateMetadataFunction<SheetProps> = async ({ props }) => {
  const resolved = await Promise.all(props.cells.map((c) => resolveSample(c.edl)));
  const rows = Math.ceil(props.cells.length / props.columns);
  const cellH = (props.cellWidth * 16) / 9 + LABEL_H;
  return { width: props.columns * props.cellWidth, height: Math.ceil(rows * cellH), durationInFrames: 900, props: { ...props, resolved } };
};

const Sheet: React.FC<SheetProps> = ({ cells, columns, cellWidth, guides, resolved }) => {
  const brand = resolved?.[0]?.brand;
  if (!resolved || !brand) return null;
  const k = cellWidth / 1080;
  const cellH = (cellWidth * 16) / 9;
  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      <SheetFonts brand={brand} />
      {cells.map((c, i) => {
        const edl = resolved[i]!;
        const x = (i % columns) * cellWidth;
        const y = Math.floor(i / columns) * (cellH + LABEL_H);
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: cellWidth, height: cellH + LABEL_H, overflow: "hidden" }}>
            <div style={{ height: LABEL_H, color: "#ddd", fontFamily: "sans-serif", fontSize: 18, lineHeight: `${LABEL_H}px`, paddingLeft: 8, whiteSpace: "nowrap", overflow: "hidden" }}>
              {c.label}
            </div>
            <div style={{ position: "absolute", top: LABEL_H, left: 0, width: 1080, height: 1920, transform: `scale(${k})`, transformOrigin: "0 0", overflow: "hidden" }}>
              <Freeze frame={c.frame}>
                <Reel edl={edl} />
                {guides ? <Guides brand={edl.brand} /> : null}
              </Freeze>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const SheetFonts: React.FC<{ brand: BrandKit }> = ({ brand }) => {
  useBrandFonts(brand);
  return null;
};

const DEFAULT_SHEET: SheetProps = {
  cells: overlaySamples.flatMap((s) => {
    const zone = overlays[s.component]?.zones[0] ?? "center";
    const edl = overlaySampleEdl(s, zone, "short", "dark");
    return [{ edl, frame: settledFrame(edl), label: `${s.component} (${zone})` }];
  }),
  columns: 4,
  cellWidth: 270,
  guides: false,
  resolved: null,
};

export const GalleryCompositions: React.FC = () => (
  <Folder name="Gallery">
    <Folder name="Overlays">
      {overlaySamples.flatMap((s) =>
        (overlays[s.component]?.zones ?? []).flatMap((zone) =>
          (["short", "long"] as const).map((variant) => {
            const bg: Background = variant === "short" ? "dark" : "light";
            const edl = overlaySampleEdl(s, zone, variant, bg);
            return (
              <Composition
                key={`${s.component}-${zone}-${variant}`}
                id={`${s.component}-${zone}-${variant}`}
                component={Sample}
                width={1080}
                height={1920}
                fps={30}
                durationInFrames={150}
                defaultProps={{ edl, resolved: null, guides: false }}
                calculateMetadata={calculateSample}
              />
            );
          }),
        ),
      )}
    </Folder>
    <Folder name="Transitions">
      {transitionSamples.map((t) => (
        <Composition
          key={t.type}
          id={`transition-${t.type}`}
          component={Sample}
          width={1080}
          height={1920}
          fps={30}
          durationInFrames={150}
          defaultProps={{ edl: transitionSampleEdl(t), resolved: null, guides: false }}
          calculateMetadata={calculateSample}
        />
      ))}
    </Folder>
    <Composition id="GallerySheet" component={Sheet} width={1080} height={1920} fps={30} durationInFrames={1} defaultProps={DEFAULT_SHEET} calculateMetadata={calculateSheet} />
  </Folder>
);
