import { ms } from "../edl/time";
import { FormatSchema, formatFromMeasurements, median, type Format } from "../studio/format-model";
import type { ReferenceEvidence } from "./evidence";
import {
  PreferencesSchema,
  StyleProfileSchema,
  StyleSourceSchema,
  type Preferences,
  type StyleSource,
} from "./style-model";

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, high));
function center(values: (number | null)[]): number | null {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return finite.length ? median(finite) : null;
}

export function describeReference(
  id: string,
  name: string,
  evidence: ReferenceEvidence,
  cueWords: number | null,
  pauseShare: number | null,
  medianLuma: number | null = null,
): StyleSource {
  const { source, visual, audio } = evidence;
  const times = [0, ...visual.cuts.map((c) => c.at).filter((t) => t > 0 && t < source.duration), source.duration];
  const lengths = times
    .slice(1)
    .map((t, i) => t - times[i]!)
    .filter((n) => n > 0);
  return StyleSourceSchema.parse({
    id,
    name,
    seconds: source.duration,
    frames: visual.frameCount,
    fps: source.fps,
    width: source.width,
    height: source.height,
    shots: lengths.length,
    cadence: median(lengths),
    pauseShare,
    motion: visual.motion.median,
    flashes: visual.transitions.filter((t) => t.kind === "flash").length,
    fades: visual.transitions.filter((t) => t.kind.startsWith("fade")).length,
    lufs: evidence.integratedLufs,
    cueWords,
    medianLuma,
    tempo: audio?.tempo && audio.tempo.confidence >= 0.55 ? audio.tempo.bpm : null,
    luma: visual.color.luma,
    contrast: visual.color.contrast,
    saturation: visual.color.saturation,
    confidence: visual.cuts.length ? center(visual.cuts.map((c) => c.confidence)) : 0.55,
    hasAudio: audio !== null,
  });
}

export function makeStyle(sources: StyleSource[], id: string, name: string, image: string): Format {
  if (!sources.length) throw Error("Choose at least one reference video.");
  const refs = Array.from(new Map(sources.map((s) => [s.id, StyleSourceSchema.parse(s)])).values());
  const duration = refs.reduce((n, r) => n + r.seconds, 0);
  const format = formatFromMeasurements(
    id,
    name,
    duration,
    refs.map((r) => r.cadence),
    center(refs.map((r) => r.motion)) ?? 0,
    refs.reduce((n, r) => n + r.flashes, 0),
    refs.some((r) => r.hasAudio),
    center(refs.map((r) => r.pauseShare)),
    center(refs.map((r) => r.lufs)),
    center(refs.map((r) => r.cueWords)),
  );
  const shots = refs.reduce((n, r) => n + r.shots, 0);
  if (format.reference) format.reference.shots = shots;
  // A transition is a recommendation from the measured edit grammar. Neutral joins are the fallback.
  format.transition = refs.some((r) => r.flashes) ? "flash" : refs.some((r) => r.fades) ? "fade" : "cut";
  const cadence = center(refs.map((r) => r.cadence))!;
  format.description =
    refs.length +
    " reference" +
    (refs.length === 1 ? "" : "s") +
    " · " +
    shots +
    " observed shots · " +
    cadence.toFixed(1) +
    "s typical shot";
  format.image = image;
  format.profile = StyleProfileSchema.parse({
    version: 2,
    family: id,
    revision: 1,
    parent: null,
    references: refs,
    preferences: {},
    reason: "Learned from the selected references",
    created: new Date().toISOString(),
    notes: [
      {
        rule: "Pacing",
        kind: "observation",
        basis: "Each reference contributes its median measured shot duration.",
        confidence: center(refs.map((r) => r.confidence)),
      },
      {
        rule: "Transitions",
        kind: "inference",
        basis: "Use a visible transition only when a measured flash or fade supports it.",
        confidence: refs.some((r) => r.fades || r.flashes) ? 0.65 : 0.52,
      },
      {
        rule: "Color",
        kind: "inference",
        basis: "Match exposure, contrast and saturation conservatively to the new pictures.",
        confidence: 0.56,
      },
      {
        rule: "Sound",
        kind: "inference",
        basis: "Source speech and silence guide music levels. Mixed audio does not identify the original tracks.",
        confidence: refs.some((r) => r.hasAudio) ? 0.5 : null,
      },
    ],
  });
  return FormatSchema.parse(format);
}

export function reviseStyle(original: Format, patch: Preferences, id: string, reason: string): Format {
  const current = FormatSchema.parse(original),
    update = PreferencesSchema.parse(patch),
    prior = current.profile;
  const preferences = { ...prior?.preferences, ...update };
  return FormatSchema.parse({
    ...current,
    id,
    shotSeconds: preferences.cadence ?? current.shotSeconds,
    zoom: preferences.zoom ?? current.zoom,
    captionWords: preferences.captionWords ?? current.captionWords,
    musicDb: preferences.musicDb !== undefined ? preferences.musicDb : current.musicDb,
    transition: preferences.transition ?? current.transition,
    profile: {
      version: 2,
      family: prior?.family ?? current.id,
      revision: (prior?.revision ?? 0) + 1,
      parent: current.id,
      references: prior?.references ?? [],
      preferences,
      reason,
      created: new Date().toISOString(),
      notes: [
        ...(prior?.notes ?? []).filter((n) => n.kind !== "preference"),
        { rule: "User direction", kind: "preference", basis: reason, confidence: null },
      ],
    },
  });
}

export function matchGrade(
  format: Format,
  actual: { luma: number | null; contrast: number | null; saturation: number | null },
) {
  const refs = format.profile?.references ?? [];
  const target = {
    luma: center(refs.map((r) => r.luma)),
    contrast: center(refs.map((r) => r.contrast)),
    saturation: center(refs.map((r) => r.saturation)),
  };
  const grade = format.profile?.preferences.grade !== false;
  const compare = (to: number | null, from: number | null, factor: number, low: number, high: number, base: number) =>
    grade && to !== null && from !== null ? ms(clamp(base + (to - from) * factor, low, high)) : base;
  return {
    brightness: compare(target.luma, actual.luma, 1 / 255, -0.08, 0.08, 0),
    contrast: compare(target.contrast, actual.contrast, 1 / 350, 0.9, 1.1, 1),
    saturation: compare(target.saturation, actual.saturation, 1 / 140, 0.85, 1.15, 1),
    targetLuma:
      grade && refs.some((r) => r.medianLuma != null) ? center(refs.map((r) => r.medianLuma ?? null))! / 255 : null,
  };
}

export function outputSize(ratio: string = "vertical", quality: string = "standard") {
  const short = quality === "draft" ? 360 : quality === "high" ? 1080 : 720,
    long = Math.round((short * 16) / 9 / 2) * 2;
  return ratio === "square"
    ? { width: short, height: short }
    : ratio === "horizontal"
      ? { width: long, height: short }
      : { width: short, height: long };
}
