import type { ResolvedTransition } from "../../edl/resolved";
import { Fade } from "./fade";
import { Flash } from "./flash";
import { Glitch } from "./glitch";
import { Slide } from "./slide";
import type { Presentation } from "./types";
import { Whip } from "./whip";
import { Zoom } from "./zoom";

/** One presentation per transition type of the EDL (docs/EDL.md, Transitions). */
export const presentations: Readonly<Record<Exclude<ResolvedTransition["type"], "cut">, Presentation>> = {
  fade: Fade,
  slide: Slide,
  whip: Whip,
  zoom: Zoom,
  flash: Flash,
  glitch: Glitch,
};
