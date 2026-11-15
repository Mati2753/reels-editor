import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cropRect, framingAt, placeSource } from "../../edl/framing";
import type { ResolvedClipSegment, ResolvedSegment } from "../../edl/resolved";
import type { Point } from "../../edl/schema";

/**
 * Main track: the segments, one after the other, at the frames the resolver gave them.
 * It also carries the voice: each clip segment plays its own audio for exactly its frames,
 * so transitions (drawn above by the TransitionTrack) never double or cut the voice.
 */
export const VideoTrack: React.FC<{ segments: ResolvedSegment[] }> = ({ segments }) => {
  return (
    <>
      {segments.map((seg) => (
        <Sequence key={seg.id} name={seg.id} from={seg.fromFrame} durationInFrames={seg.durationInFrames}>
          {seg.type === "clip" ? <ClipView seg={seg} /> : <SceneView background={seg.background.value} />}
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
  const state = framingAt(seg.framing, frame, seg.durationInFrames);
  return (
    <SourcePicture src={seg.src} sourceWidth={seg.sourceWidth} sourceHeight={seg.sourceHeight} scale={state.scale} origin={state.origin} trimBefore={seg.trimBefore} playbackRate={seg.playbackRate} />
  );
};

export interface SourcePictureProps {
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  origin: Point;
  /** Live playback (with audio) from this source frame... */
  trimBefore?: number;
  playbackRate?: number;
  /** ...or this one source frame, muted (transition handles). */
  sourceFrame?: number;
}

/** The source picture of a clip under a framing state, live or frozen on one source frame. */
export const SourcePicture: React.FC<SourcePictureProps> = (p) => {
  const { width, height } = useVideoConfig();
  const source = { width: p.sourceWidth, height: p.sourceHeight };
  const output = { width, height };
  const place = placeSource(source, output, cropRect(source, output, p.scale, p.origin));
  const style = { position: "absolute", left: place.x, top: place.y, width: place.width, height: place.height, maxWidth: "none" } as const;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {p.sourceFrame === undefined ? (
        <OffthreadVideo src={staticFile(p.src)} trimBefore={p.trimBefore ?? 0} playbackRate={p.playbackRate ?? 1} style={style} />
      ) : (
        <Freeze frame={p.sourceFrame}>
          <OffthreadVideo src={staticFile(p.src)} muted style={style} />
        </Freeze>
      )}
    </AbsoluteFill>
  );
};

/** Scene segment (animation mode, phase 6): only colour and gradient backgrounds for now. */
export const SceneView: React.FC<{ background: string }> = ({ background }) => {
  return <AbsoluteFill style={{ background }} />;
};
