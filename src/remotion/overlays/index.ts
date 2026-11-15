import { BigNumber } from "./BigNumber";
import { CtaCard } from "./CtaCard";
import { HookTitle } from "./HookTitle";
import { KeywordPop } from "./KeywordPop";
import { LabelTag } from "./LabelTag";
import { ListReveal } from "./ListReveal";
import { SectionTitle } from "./SectionTitle";
import type { OverlayDefinition } from "./types";

/**
 * Overlay library: every animation the director may place in `overlays` (docs/EDL.md).
 * A component is usable once it is registered here and listed in the catalogue of
 * docs/DIRECTOR.md (section 5). One file per component (docs/ARCHITECTURE.md, Extension).
 */
export type { OverlayDefinition } from "./types";

export type OverlayRegistry = Readonly<Record<string, OverlayDefinition>>;

export const overlays: OverlayRegistry = {
  HookTitle,
  KeywordPop,
  BigNumber,
  ListReveal,
  CtaCard,
  SectionTitle,
  LabelTag,
};
