import { Composition } from "remotion";
import { Reel } from "./Reel";

/** Output format of every Reel, see CLAUDE.md. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

/**
 * Placeholder length until the resolved EDL drives the duration (phase 2).
 */
const PLACEHOLDER_DURATION_IN_FRAMES = REEL_FPS;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      width={REEL_WIDTH}
      height={REEL_HEIGHT}
      fps={REEL_FPS}
      durationInFrames={PLACEHOLDER_DURATION_IN_FRAMES}
    />
  );
};
