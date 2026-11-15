import { AbsoluteFill } from "remotion";
import type { ResolvedEdl } from "../edl/resolved";
import { useBrandFonts } from "./fonts";
import { CaptionTrack } from "./tracks/CaptionTrack";
import { VideoTrack } from "./tracks/VideoTrack";

export interface ReelProps extends Record<string, unknown> {
  edl: ResolvedEdl;
}

/**
 * Stacks the Reel tracks: video, then captions. Overlays, transitions and the audio
 * track (music, effects) arrive in phases 3 and 5; until then validate refuses EDLs that
 * use them. The voice is the clips' own audio, played by the video track.
 */
export const Reel: React.FC<ReelProps> = ({ edl }) => {
  useBrandFonts(edl.brand);
  return (
    <AbsoluteFill style={{ backgroundColor: edl.brand.colors.background }}>
      <VideoTrack segments={edl.segments} />
      {edl.captions.enabled ? <CaptionTrack pages={edl.captions.pages} style={edl.captionStyle} brand={edl.brand} /> : null}
    </AbsoluteFill>
  );
};
