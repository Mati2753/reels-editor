import { Composition, type CalculateMetadataFunction } from "remotion";
import { defaultBrand } from "../brand";
import type { ResolvedEdl } from "../edl/resolved";
import { boldStyle } from "./captions/styles";
import { Reel, type ReelProps } from "./Reel";

/** Output format of every Reel, see CLAUDE.md. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

/** Shown in the Studio when no EDL is passed: one second of the brand background. */
const EMPTY_EDL: ResolvedEdl = {
  version: 1,
  title: "Empty",
  fps: REEL_FPS,
  width: REEL_WIDTH,
  height: REEL_HEIGHT,
  durationInFrames: REEL_FPS,
  brand: defaultBrand,
  captionStyle: boldStyle,
  segments: [],
  transitions: [],
  overlays: [],
  captions: { enabled: true, pages: [] },
  audio: { voice: { targetLufs: -14, denoise: false }, sfx: [] },
};

/** The duration and size come from the resolved EDL passed as input props. */
const calculateMetadata: CalculateMetadataFunction<ReelProps> = ({ props }) => ({
  durationInFrames: Math.max(1, props.edl.durationInFrames),
  fps: props.edl.fps,
  width: props.edl.width,
  height: props.edl.height,
});

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      width={REEL_WIDTH}
      height={REEL_HEIGHT}
      fps={REEL_FPS}
      durationInFrames={REEL_FPS}
      defaultProps={{ edl: EMPTY_EDL }}
      calculateMetadata={calculateMetadata}
    />
  );
};
