import { AbsoluteFill } from "remotion";
import type { ResolvedEdl } from "../edl/resolved";
import { useBrandFonts } from "./fonts";
import { CaptionTrack } from "./tracks/CaptionTrack";
import { OverlayTrack } from "./tracks/OverlayTrack";
import { TransitionTrack } from "./tracks/TransitionTrack";
import { VideoTrack } from "./tracks/VideoTrack";

export interface ReelProps extends Record<string, unknown> {
  edl: ResolvedEdl;
}

/**
 * Stacks the Reel tracks, bottom to top: video (which plays the voice), transitions,
 * overlays of the "background" and "behind-captions" layers, captions, overlays of the
 * "front" layer. Music and sound effects (audio track) arrive in phase 5.
 */
export const Reel: React.FC<ReelProps> = ({ edl }) => {
  useBrandFonts(edl.brand);
  return (
    <AbsoluteFill style={{ backgroundColor: edl.brand.colors.background }}>
      <VideoTrack segments={edl.segments} />
      <TransitionTrack transitions={edl.transitions} brand={edl.brand} />
      <OverlayTrack overlays={edl.overlays} layer="background" brand={edl.brand} />
      <OverlayTrack overlays={edl.overlays} layer="behind-captions" brand={edl.brand} />
      {edl.captions.enabled ? <CaptionTrack pages={edl.captions.pages} style={edl.captionStyle} brand={edl.brand} /> : null}
      <OverlayTrack overlays={edl.overlays} layer="front" brand={edl.brand} />
    </AbsoluteFill>
  );
};
