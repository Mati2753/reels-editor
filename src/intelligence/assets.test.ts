import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { overlays } from "../remotion/overlays";
import { presentations } from "../remotion/transitions";
import {
  AssetSchema,
  AssetSearchSchema,
  assetRegistry,
  BrollSelectionSchema,
  createAssetRegistry,
  searchAssets,
  selectBroll,
} from "./assets";

const phrase = (text: string, start = 4, end = 6) => ({ text, start, end });
const example = assetRegistry.find((a) => a.id === "photo-alpine")!;

describe("licensed studio asset registry", () => {
  it("has a tracked resource and an actual preview for every entry", () => {
    for (const asset of assetRegistry) {
      expect(AssetSchema.safeParse(asset).success, asset.id).toBe(true);
      for (const path of [asset.resource, asset.preview.path]) {
        expect(existsSync(fileURLToPath(new URL("../../" + path, import.meta.url))), path).toBe(true);
      }
    }
    expect(new Set(assetRegistry.map((a) => a.id)).size).toBe(assetRegistry.length);
  });
  it("keeps motion graphics and transition metadata synchronized with the actual rendering registry", () => {
    const catalog = assetRegistry.filter((a) => a.kind === "motion-graphic");
    expect(catalog.map((a) => a.selector).sort()).toEqual(Object.keys(overlays).sort());
    for (const asset of catalog) {
      const definition = overlays[asset.selector!]!.props.toJSONSchema() as { properties: Record<string, unknown> };
      expect(asset.implementations.find((i) => i.engine === "remotion")?.parameters.sort()).toEqual(
        Object.keys(definition.properties).sort(),
      );
    }
    expect(
      assetRegistry
        .filter((a) => a.kind === "transition")
        .map((a) => a.selector)
        .sort(),
    ).toEqual(Object.keys(presentations).sort());
  });
  it("rejects missing licenses, duplicate identifiers and untrusted paths", () => {
    expect(AssetSchema.safeParse({ ...example, license: undefined }).success).toBe(false);
    expect(AssetSchema.safeParse({ ...example, resource: "assets/../../private.mp4" }).success).toBe(false);
    expect(AssetSchema.safeParse({ ...example, resource: "https://example.org/image.jpg" }).success).toBe(false);
    expect(() => createAssetRegistry([example, example])).toThrow(/unique/);
    expect(() =>
      createAssetRegistry([
        { ...example, implementations: [example.implementations[0]!, example.implementations[0]!] },
      ]),
    ).toThrow(/engine/);
  });
  it("searches terms, enforces engine and license filters and returns inspectable reasons", () => {
    const matches = searchAssets({ query: "A quiet instrumental underscore", engine: "browser", kind: "music" });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      asset: { id: "music-drift", license: { id: "CC0-1.0" } },
      matched: expect.arrayContaining(["instrumental"]),
    });
    expect(matches[0]!.reason).toContain("instrumental");
    expect(searchAssets({ query: "testimonial", engine: "browser" })).toEqual([]);
    expect(searchAssets({ query: "testimonial", engine: "remotion" })[0]!.asset.id).toBe("graphic-quote-card");
    expect(searchAssets({ query: "testimonial", licensedMediaOnly: true })).toEqual([]);
    expect(searchAssets({ query: "montagne", kind: "stock-image", licensedMediaOnly: true })[0]!.asset.id).toBe(
      "photo-alpine",
    );
  });
  it("returns empty for missing categories, absent subjects and blank or spurious words", () => {
    for (const kind of ["lut", "texture", "3d-object", "stock-video", "vfx-overlay"] as const) {
      expect(searchAssets({ query: "landscape", kind })).toEqual([]);
    }
    for (const query of ["   ", "submarine", "blakerset", "lakeridgeperipherals"])
      expect(searchAssets({ query, kind: "stock-image" })).toEqual([]);
    expect(AssetSearchSchema.safeParse({ query: "mountains", limit: 400 }).success).toBe(false);
    expect(() => searchAssets({ query: "lake", limit: 0 })).toThrow();
  });
  it("allows an explicitly supplied validated catalog and reproducible ordering", () => {
    const rival = { ...example, id: "photo-a", name: "Another alpine image" };
    const catalog = createAssetRegistry([example, rival]);
    const reversed = createAssetRegistry([rival, example]);
    const q = { query: "mountains", kind: "stock-image" as const };
    expect(searchAssets(q, catalog).map((x) => x.asset.id)).toEqual(["photo-a", "photo-alpine"]);
    expect(searchAssets(q, reversed)).toEqual(searchAssets(q, catalog));
  });
});

describe("grounded cutaway selection", () => {
  it("anchors one literal visual to the retained phrase and caps its duration", () => {
    const candidate = selectBroll([
      phrase("A budget meeting.", 0, 3),
      phrase("We saw deer at the edge of the forest.", 7, 14),
    ]);
    expect(candidate).toMatchObject({
      assetId: "photo-forest",
      file: "broll-forest.jpg",
      start: 7,
      end: 10,
      matched: ["forest", "deer"],
    });
    expect(BrollSelectionSchema.safeParse(candidate).success).toBe(true);
    expect(candidate!.reason).toContain("We saw deer");
  });
  it("weights distinct visual subjects and breaks separate phrase ties by earliest output time", () => {
    const p1 = phrase("The forest is quiet.", 9, 11),
      p2 = phrase("The lake has a jetty.", 12, 14),
      p3 = phrase("See the mountains.", 3, 5);
    expect(selectBroll([p1, p2, p3])?.assetId).toBe("photo-lake");
    expect(selectBroll([p1, p3])?.assetId).toBe("photo-alpine");
    expect(selectBroll([p3, p1])?.start).toBe(3);
  });
  it("declines unsupported evidence, metaphors, explicitly negated images and ambiguous comparisons", () => {
    for (const text of [
      "A calm, quiet change.",
      "Build a data lake for the sales workflow.",
      "A random forest is a classifier.",
      "I have a mountain of paperwork.",
      "We never saw a lake.",
      "No deer appeared.",
      "Travel through the mountains or past the lake.",
      "No forest was visible.",
      "Architecture de notre lac de données.",
      "This mountainous problem needs fixing.",
    ]) {
      expect(selectBroll([phrase(text)]), text).toBeNull();
    }
    expect(selectBroll([phrase("Forest.", 2, 2.3)])).toBeNull();
    expect(selectBroll([phrase("The forest is here.")], { engine: "remotion" })).toBeNull();
    expect(() => selectBroll([phrase("Lake.", 4, 2)])).toThrow();
  });
  it("recognizes supported accented French natural subjects", () => {
    expect(selectBroll([phrase("Nous entrons dans la forêt.")])?.assetId).toBe("photo-forest");
    expect(selectBroll([phrase("Le ponton est au bord du lac.")])?.assetId).toBe("photo-lake");
  });
});
