import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import type { BrandKit } from "../../brand";
import { framingAt } from "../../edl/framing";
import type { ResolvedTransition, TransitionSide } from "../../edl/resolved";
import { presentations } from "../transitions";
import { SceneView, SourcePicture } from "./VideoTrack";

/**
 * Transitions, drawn over the video track during their window (docs/EDL.md, Transitions).
 * The window is centred on the cut and does not change the timeline: before the cut the
 * incoming picture is its own source just before its `in` (muted), after the cut the
 * outgoing picture is its source just after its `out` (muted). The voice is the video
 * track's, a straight cut. Every presentation is opaque over the whole frame.
 */
export const TransitionTrack: React.FC<{ transitions: ResolvedTransition[]; brand: BrandKit }> = ({ transitions, brand }) => {
  return (
    <>
      {transitions
        .filter((t) => t.type !== "cut" && t.durationInFrames > 0)
        .map((t) => (
          <Sequence key={t.between.join("→")} name={`${t.type} ${t.between.join(" → ")}`} from={t.fromFrame} durationInFrames={t.durationInFrames}>
            <TransitionView t={t} brand={brand} />
          </Sequence>
        ))}
    </>
  );
};

const TransitionView: React.FC<{ t: ResolvedTransition; brand: BrandKit }> = ({ t, brand }) => {
  const frame = useCurrentFrame();
  if (t.type === "cut") return null;
  const Presentation = presentations[t.type];
  const cut = t.atFrame - t.fromFrame;
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <Presentation
        A={<SideView side={t.outgoing} frame={frame} />}
        B={<SideView side={t.incoming} frame={frame} />}
        frame={frame}
        durationInFrames={t.durationInFrames}
        cut={cut}
        progress={(frame + 1) / t.durationInFrames}
        direction={t.direction ?? "left"}
        brand={brand}
        seed={t.between.join("-")}
      />
    </AbsoluteFill>
  );
};

/** One side of a transition at window frame `frame`: its source frame (clamped to the clip) under its framing. */
const SideView: React.FC<{ side: TransitionSide; frame: number }> = ({ side, frame }) => {
  if (side.kind === "scene") return <SceneView background={side.background.value} />;
  const sourceFrame = Math.min(side.sourceFrames - 1, Math.max(0, Math.round(side.firstSourceFrame + frame * side.playbackRate)));
  const segFrame = Math.min(side.segmentFrames - 1, Math.max(0, side.firstSegmentFrame + frame));
  const state = framingAt(side.framing, segFrame, side.segmentFrames);
  return <SourcePicture src={side.src} sourceWidth={side.sourceWidth} sourceHeight={side.sourceHeight} scale={state.scale} origin={state.origin} sourceFrame={sourceFrame} />;
};
