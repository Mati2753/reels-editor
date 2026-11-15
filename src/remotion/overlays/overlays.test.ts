import { describe, expect, it } from "vitest";
import { defaultBrand } from "../../brand";
import { measureText } from "../../edl/measure";
import { fitText } from "../../edl/textfit";
import { validateEdl } from "../../edl/validate";
import { inside, safeArea } from "../../edl/zones";
import { overlaySampleEdl, overlaySamples, transitionSampleEdl, transitionSamples } from "../gallery/samples";
import { overlays } from ".";

const facts = { probe: { version: 1 as const, clips: [] }, analysis: { words: [] } };

describe("overlay library", () => {
  it("has a gallery sample for every registered component", () => {
    expect(overlaySamples.map((s) => s.component).sort()).toEqual(Object.keys(overlays).sort());
  });

  for (const s of overlaySamples) {
    for (const zone of overlays[s.component]!.zones) {
      for (const variant of ["short", "long"] as const) {
        it(`${s.component} in ${zone}, ${variant} text: fits, inside the safe zone, no error (real fonts)`, () => {
          const r = validateEdl(overlaySampleEdl(s, zone, variant, "dark"), facts, { measure: measureText });
          const errors = r.issues.filter((i) => i.severity === "error" && i.rule !== "duration");
          expect(errors).toEqual([]);
          const ov = r.resolved!.overlays[0]!;
          expect(inside(ov.box, safeArea(defaultBrand.safeZone))).toBe(true);
          if (zone !== "full") expect([ov.box.y >= ov.area.y - 1, ov.box.y + ov.box.height <= ov.area.y + ov.area.height + 1]).toEqual([true, true]);
        });
      }
    }
  }

  it("every transition sample validates", () => {
    for (const t of transitionSamples) expect(validateEdl(transitionSampleEdl(t), facts, { measure: measureText }).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("fitText", () => {
  const font = defaultBrand.fonts.display;
  it("keeps the largest size that fits, breaking into balanced lines", () => {
    const f = fitText("trois astuces pour filmer", { font, maxWidth: 840, maxLines: 3, maxSize: 96, minSize: 56, lineHeight: 1.1, uppercase: true, language: "fr" }, measureText);
    expect(f.overflow).toBe(false);
    expect(f.fontSize).toBe(96);
    expect(f.lines).toEqual(["TROIS ASTUCES", "POUR FILMER"]);
    expect(Math.max(...f.lineWidths)).toBeLessThanOrEqual(840);
  });
  it("shrinks a long text, and reports a word that never fits", () => {
    const f = fitText("anticonstitutionnellement", { font, maxWidth: 800, maxLines: 2, maxSize: 96, minSize: 40, lineHeight: 1.1, language: "fr" }, measureText);
    expect(f.shrunk).toBe(true);
    expect(f.overflow).toBe(false);
    const g = fitText("anticonstitutionnellement", { font, maxWidth: 300, maxLines: 2, maxSize: 96, minSize: 40, lineHeight: 1.1, language: "fr" }, measureText);
    expect(g.overflow).toBe(true);
  });
  it("does not end a line on an article when it can avoid it", () => {
    // One px per character: "un deux la" (10) / "trois" would be widest-balanced but ends on "la".
    const mono = (t: string, _f: unknown, size: number) => [...t].length * size;
    const f = fitText("un deux la trois", { font, maxWidth: 10, maxLines: 2, maxSize: 1, minSize: 1, lineHeight: 1, language: "fr" }, mono);
    expect(f.lines).toEqual(["un deux", "la trois"]);
  });
});
