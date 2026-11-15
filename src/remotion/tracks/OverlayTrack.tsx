import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { BrandKit } from "../../brand";
import type { ResolvedOverlay } from "../../edl/resolved";
import { overlays as registry } from "../overlays";
import { enterProgress, exitProgress, motionStyle } from "../overlays/motion";
import { Backdrop } from "../overlays/ui";

/**
 * Overlays of one layer (docs/EDL.md, Overlays), each in its own sequence at the frames the
 * resolver gave it. The track applies the entrance and exit to the content (around the
 * centre of its box); a full-zone overlay also gets the brand's backdrop over the picture,
 * which replaces the image while the voice goes on.
 */
export const OverlayTrack: React.FC<{ overlays: ResolvedOverlay[]; layer: ResolvedOverlay["layer"]; brand: BrandKit }> = ({ overlays, layer, brand }) => {
  return (
    <>
      {overlays
        .filter((o) => o.layer === layer)
        .map((o) => (
          <Sequence key={o.id} name={`${o.component} ${o.id}`} from={o.fromFrame} durationInFrames={o.durationInFrames}>
            <OverlayView ov={o} brand={brand} />
          </Sequence>
        ))}
    </>
  );
};

export const OverlayView: React.FC<{ ov: ResolvedOverlay; brand: BrandKit }> = ({ ov, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const def = registry[ov.component];
  if (!def) throw new Error(`overlay component "${ov.component}" is not registered in src/remotion/overlays/index.ts`);
  const enter = enterProgress(frame, ov.enter, fps);
  const exit = exitProgress(frame, ov.durationInFrames, ov.exit);
  const origin = { x: ov.box.x + ov.box.width / 2, y: ov.box.y + ov.box.height / 2 };
  // The backdrop covers the picture fast (6 frames at most) and leaves with the exit.
  const backdropIn =
    ov.enter.kind === "none"
      ? 1
      : interpolate(frame + 1, [0, Math.min(6, ov.enter.durationInFrames)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill>
      {ov.zone === "full" ? <Backdrop brand={brand} opacity={backdropIn * (1 - exit)} /> : null}
      <AbsoluteFill style={motionStyle(enter, exit, ov.enter, ov.exit, origin)}>
        {def.render({
          props: ov.props,
          layout: ov.layout,
          brand,
          zone: ov.zone,
          area: ov.area,
          box: ov.box,
          frame,
          durationInFrames: ov.durationInFrames,
          fps,
          enter,
          exit,
          enterMotion: ov.enter,
          exitMotion: ov.exit,
          cues: ov.cues,
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
