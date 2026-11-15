import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { BrandKit } from "../../brand";
import type { ResolvedCaptionPage } from "../../edl/resolved";
import { CaptionPage } from "../captions/CaptionPage";
import type { CaptionStyle } from "../captions/styles";

/**
 * Caption pages derived by the resolver from the kept words. Shows the page whose frames
 * contain the current frame; the page highlights the word whose frames contain it.
 */
export const CaptionTrack: React.FC<{ pages: ResolvedCaptionPage[]; style: CaptionStyle; brand: BrandKit }> = ({ pages, style, brand }) => {
  const frame = useCurrentFrame();
  const page = pages.find((p) => frame >= p.fromFrame && frame < p.fromFrame + p.durationInFrames);
  if (!page) return null;
  return (
    <AbsoluteFill>
      <CaptionPage page={page} frame={frame} style={style} brand={brand} />
    </AbsoluteFill>
  );
};
