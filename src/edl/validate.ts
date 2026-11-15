import type { z } from "zod";
import { overlays as overlayRegistry, type OverlayRegistry } from "../remotion/overlays";
import { IssueList, type Issue } from "./issues";
import type { ResolvedEdl } from "./resolved";
import { FPS, HEIGHT, resolveEdl, WIDTH, type Facts, type KeptWord, type ResolveEnv } from "./resolve";
import { EdlSchema, type Edl, type TransitionType } from "./schema";
import { wordCount } from "./textfit";
import { inside, intersects, safeArea } from "./zones";

/**
 * validate(json, facts): the zod schema, then the rules of docs/EDL.md ("Règles de
 * validation"). Errors block preview and render; warnings do not.
 */

export const MIN_DURATION = 5;
export const MAX_DURATION = 90;

/** Longest transition accepted, seconds. */
export const MAX_TRANSITION = 1;

/** Durations docs/DIRECTOR.md gives each transition (seconds); outside them, a warning. */
export const TRANSITION_RANGES: Readonly<Record<Exclude<TransitionType, "cut">, [number, number]>> = {
  fade: [0.3, 0.5],
  slide: [0.2, 0.3],
  whip: [0.2, 0.3],
  zoom: [0.15, 0.25],
  flash: [0.1, 0.15],
  glitch: [0.15, 0.2],
};

/** Transitions where a direction means something. */
export const DIRECTED_TRANSITIONS: readonly TransitionType[] = ["slide", "whip"];

/** docs/DIRECTOR.md, Dosage: words per overlay; Synchronisation: 1.2 to 4 s on screen. */
export const MAX_OVERLAY_WORDS = 6;
export const OVERLAY_SECONDS: [number, number] = [1.2, 4];

export interface ValidateEnv extends ResolveEnv {
  overlays?: OverlayRegistry;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  edl: Edl | null;
  /** Present when the EDL could be resolved (it may still have errors). */
  resolved: ResolvedEdl | null;
  kept: Map<string, KeptWord>;
}

export function formatZodIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({ severity: "error", rule: "schema", path: i.path.map(String).join(".") || "(root)", message: i.message }));
}

export function validateEdl(json: unknown, facts: Facts, env: ValidateEnv): ValidationResult {
  const parsed = EdlSchema.safeParse(json);
  if (!parsed.success) return { ok: false, issues: formatZodIssues(parsed.error), edl: null, resolved: null, kept: new Map() };
  const edl = parsed.data;
  const issues = new IssueList();
  const registry = env.overlays ?? overlayRegistry;

  // ---- segments
  const ids = new Map<string, number>();
  edl.segments.forEach((seg, i) => {
    const path = `segments[${i}]`;
    if (ids.has(seg.id)) issues.error("duplicate-id", `${path}.id`, `segment id "${seg.id}" is used twice`);
    ids.set(seg.id, i);
    if (seg.type === "clip") {
      const clip = facts.probe.clips.find((c) => c.id === seg.clip);
      if (seg.in >= seg.out) issues.error("segment-in-out", path, `segment "${seg.id}": in (${seg.in}) must be before out (${seg.out})`);
      if (clip && seg.out > clip.normalized.duration + 1e-6) issues.error("segment-out-of-clip", `${path}.out`, `segment "${seg.id}": out ${seg.out} s is past the end of clip ${seg.clip} (${clip.normalized.duration} s)`);
    } else if (seg.background.kind === "image" || seg.background.kind === "video") {
      issues.error("not-rendered-yet", `${path}.background`, `scene "${seg.id}": ${seg.background.kind} backgrounds are rendered from phase 6; use "color" or "gradient"`);
    }
  });

  // ---- transitions
  const junctions = new Set<string>();
  edl.transitions.forEach((tr, i) => {
    const path = `transitions[${i}]`;
    const a = ids.get(tr.between[0]);
    const b = ids.get(tr.between[1]);
    if (a === undefined || b === undefined) {
      issues.error("transition-unknown-segment", `${path}.between`, `transition between "${tr.between[0]}" and "${tr.between[1]}": unknown segment`);
      return;
    }
    if (b !== a + 1) issues.error("transition-not-consecutive", `${path}.between`, `transition between "${tr.between[0]}" and "${tr.between[1]}": the segments are not consecutive`);
    const key = tr.between.join("→");
    if (junctions.has(key)) issues.error("transition-duplicate", path, `two transitions on the junction ${key}`);
    junctions.add(key);
    if (tr.type === "cut" && tr.duration !== 0) issues.error("transition-duration", `${path}.duration`, `a cut lasts 0 s`);
    if (tr.type !== "cut") {
      if (tr.duration <= 0) issues.error("transition-duration", `${path}.duration`, `a ${tr.type} transition needs a duration`);
      else if (tr.duration > MAX_TRANSITION) issues.error("transition-too-long", `${path}.duration`, `a transition lasts ${MAX_TRANSITION} s at most (${tr.duration} s given)`);
      else {
        const [lo, hi] = TRANSITION_RANGES[tr.type];
        if (tr.duration < lo - 1e-9 || tr.duration > hi + 1e-9) issues.warn("transition-range", `${path}.duration`, `docs/DIRECTOR.md gives a ${tr.type} ${lo}-${hi} s; ${tr.duration} s given`);
      }
    }
    if (tr.direction && !DIRECTED_TRANSITIONS.includes(tr.type)) issues.error("transition-direction", `${path}.direction`, `a ${tr.type} transition has no direction (only ${DIRECTED_TRANSITIONS.join(" and ")} do)`);
  });

  // ---- overlays (schema of each component's props; layout and placement after resolution)
  const overlayIds = new Set<string>();
  edl.overlays.forEach((ov, i) => {
    const path = `overlays[${i}]`;
    if (overlayIds.has(ov.id)) issues.error("duplicate-id", `${path}.id`, `overlay id "${ov.id}" is used twice`);
    overlayIds.add(ov.id);
    const def = registry[ov.component];
    if (!def) {
      const known = Object.keys(registry);
      issues.error(
        "unknown-overlay",
        `${path}.component`,
        `overlay component "${ov.component}" is not in src/remotion/overlays/index.ts (${known.length ? `known: ${known.join(", ")}` : "no overlay exists before phase 3"})`,
      );
      return;
    }
    const props = def.props.safeParse(ov.props);
    if (!props.success) {
      for (const z of formatZodIssues(props.error)) issues.error("overlay-props", `${path}.props.${z.path}`, z.message);
      return;
    }
    const words = wordCount(def.text(props.data));
    if (words > MAX_OVERLAY_WORDS) issues.warn("overlay-word-count", `${path}.props`, `${ov.component} "${ov.id}" shows ${words} words; docs/DIRECTOR.md says ${MAX_OVERLAY_WORDS} at most`);
    if (ov.duration < OVERLAY_SECONDS[0] || ov.duration > OVERLAY_SECONDS[1]) issues.warn("overlay-duration", `${path}.duration`, `overlay "${ov.id}" lasts ${ov.duration} s; docs/DIRECTOR.md says ${OVERLAY_SECONDS[0]} to ${OVERLAY_SECONDS[1]} s`);
  });

  // ---- audio
  if (edl.audio.voice.denoise) issues.error("not-rendered-yet", "audio.voice.denoise", "noise reduction arrives in phase 5; set denoise to false");
  if (edl.audio.music) issues.error("not-rendered-yet", "audio.music", "music is rendered from phase 5");
  if (edl.audio.sfx.length > 0) issues.error("not-rendered-yet", "audio.sfx", "sound effects are rendered from phase 5");

  // ---- resolution: anchors, cuts inside words, framing, caption layout
  const { resolved, issues: resolveIssues, kept } = resolveEdl(edl, facts, env);
  issues.items.push(...resolveIssues);

  if (resolved) {
    // Transition shorter than both segments.
    resolved.transitions.forEach((tr, i) => {
      const a = resolved.segments.find((s) => s.id === tr.between[0]);
      const b = resolved.segments.find((s) => s.id === tr.between[1]);
      if (a && b && tr.durationInFrames > 0 && tr.durationInFrames >= Math.min(a.durationInFrames, b.durationInFrames)) {
        issues.error("transition-too-long", `transitions[${i}].duration`, `transition ${tr.between.join("→")} lasts as long as one of its segments or longer`);
      }
    });

    // Windows of consecutive transitions never overlap: each half-window is shorter than
    // half of the longer transition, itself shorter than the segment between them.

    // Overlay motion: entrance and exit fit in the overlay; the exit is the shorter.
    const safeRect = safeArea(resolved.brand.safeZone);
    resolved.overlays.forEach((ov) => {
      const i = edl.overlays.findIndex((o) => o.id === ov.id);
      const path = `overlays[${i}]`;
      const enter = ov.enter.kind === "none" ? 0 : ov.enter.durationInFrames;
      const exit = ov.exit.kind === "none" ? 0 : ov.exit.durationInFrames;
      if (enter + exit > ov.durationInFrames) issues.error("overlay-motion", path, `overlay "${ov.id}": entrance (${enter} frames) and exit (${exit} frames) are longer than the overlay (${ov.durationInFrames} frames)`);
      else if (enter > 0 && exit > enter) issues.warn("overlay-motion", path, `overlay "${ov.id}": the exit (${exit} frames) is longer than the entrance (${enter} frames); docs/DIRECTOR.md wants it shorter`);
      // The content stays in its zone (a full-screen overlay: above the captions' lower third).
      if (ov.box.y < ov.area.y - 1 || ov.box.y + ov.box.height > ov.area.y + ov.area.height + 1) {
        issues.error("overlay-zone-overflow", path, `overlay "${ov.id}" (${ov.component}) is ${Math.round(ov.box.height)} px tall and leaves its zone ${ov.zone} (y ${ov.area.y}-${ov.area.y + ov.area.height}): shorten its text`);
      }
      // Text never leaves the safe zone.
      if (!inside(ov.box, safeRect)) {
        issues.error("overlay-safe-zone", path, `overlay "${ov.id}" draws x ${Math.round(ov.box.x)}-${Math.round(ov.box.x + ov.box.width)}, y ${Math.round(ov.box.y)}-${Math.round(ov.box.y + ov.box.height)}: outside the safe zone x ${safeRect.x}-${safeRect.x + safeRect.width}, y ${safeRect.y}-${safeRect.y + safeRect.height}`);
      }
      // Captions never cover an overlay (they move with position "auto", or are hidden).
      for (const p of resolved.captions.pages) {
        if (p.fromFrame >= ov.fromFrame + ov.durationInFrames || ov.fromFrame >= p.fromFrame + p.durationInFrames) continue;
        if (!intersects(p.box, ov.box)) continue;
        const text = p.lines.map((l) => l.map((t) => t.text).join(" ")).join(" / ");
        issues.error("caption-overlay-overlap", path, `caption page "${text}" at ${(p.fromFrame / FPS).toFixed(2)} s covers overlay "${ov.id}" (${ov.component}, zone ${ov.zone}): use captions.position "auto", another zone, or captions.hide`);
      }
    });

    // Overlays of the same zone and layer never overlap.
    const ovs = [...resolved.overlays].sort((a, b) => a.fromFrame - b.fromFrame);
    for (let i = 0; i < ovs.length; i++) {
      for (let j = i + 1; j < ovs.length; j++) {
        const a = ovs[i]!;
        const b = ovs[j]!;
        if (a.zone === b.zone && a.layer === b.layer && b.fromFrame < a.fromFrame + a.durationInFrames) {
          issues.error("overlay-overlap", "overlays", `overlays "${a.id}" and "${b.id}" share zone "${a.zone}" and layer "${a.layer}" and overlap in time`);
        }
      }
    }

    // No text outside the safe zone.
    const safe = resolved.brand.safeZone;
    const area = { left: safe.left, top: safe.top, right: WIDTH - safe.right, bottom: HEIGHT - safe.bottom };
    resolved.captions.pages.forEach((p) => {
      const b = p.box;
      if (b.x < area.left - 0.5 || b.y < area.top - 0.5 || b.x + b.width > area.right + 0.5 || b.y + b.height > area.bottom + 0.5) {
        const text = p.lines.map((l) => l.map((t) => t.text).join(" ")).join(" / ");
        issues.error(
          "caption-safe-zone",
          "captions",
          `page "${text}" at ${(p.fromFrame / FPS).toFixed(2)} s spans x ${Math.round(b.x)}-${Math.round(b.x + b.width)}, y ${Math.round(b.y)}-${Math.round(b.y + b.height)}: outside the safe zone x ${area.left}-${area.right}, y ${area.top}-${area.bottom}`,
        );
      }
    });

    // Total duration.
    const seconds = resolved.durationInFrames / FPS;
    if (seconds < MIN_DURATION || seconds > MAX_DURATION) {
      issues.error("duration", "segments", `the Reel lasts ${seconds.toFixed(2)} s; it must last between ${MIN_DURATION} and ${MAX_DURATION} s`);
    }
  }

  const ok = issues.errors.length === 0;
  return { ok, issues: issues.items, edl, resolved, kept };
}
