import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cropRect, framingAt, placeSource } from "../../edl/framing";
import type { ResolvedClipSegment, ResolvedSceneSegment, ResolvedSegment } from "../../edl/resolved";

/** Main track: the segments, one after the other, at the frames the resolver gave them. */
export const VideoTrack: React.FC<{ segments: ResolvedSegment[] }> = ({ segments }) => {
  return (
    <>
      {segments.map((seg) => (
        <Sequence key={seg.id} name={seg.id} from={seg.fromFrame} durationInFrames={seg.durationInFrames}>
          {seg.type === "clip" ? <ClipView seg={seg} /> : <SceneView seg={seg} />}
        </Sequence>
      ))}
    </>
  );
};

/**
 * A clip segment: the source picture placed so that the framing's crop fills the frame.
 * The crop follows the move frame by frame (src/edl/framing.ts); nothing is decided here.
 */
const ClipView: React.FC<{ seg: ResolvedClipSegment }> = ({ seg }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const source = { width: seg.sourceWidth, height: seg.sourceHeight };
  const output = { width, height };
  const state = framingAt(seg.framing, frame, seg.durationInFrames);
  const place = placeSource(source, output, cropRect(source, output, state.scale, state.origin));
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={staticFile(seg.src)}
        trimBefore={seg.trimBefore}
        playbackRate={seg.playbackRate}
        style={{ position: "absolute", left: place.x, top: place.y, width: place.width, height: place.height, maxWidth: "none" }}
      />
    </AbsoluteFill>
  );
};

/** Scene segment (animation mode, phase 6): only colour and gradient backgrounds for now. */
const SceneView: React.FC<{ seg: ResolvedSceneSegment }> = ({ seg }) => {
  return <AbsoluteFill style={{ background: seg.background.value }} />;
};
