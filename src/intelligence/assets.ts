import { z } from "zod";

export const AssetKindSchema = z.enum([
  "animation",
  "transition",
  "motion-graphic",
  "sound-effect",
  "music",
  "font",
  "icon",
  "lut",
  "texture",
  "stock-video",
  "stock-image",
  "3d-object",
  "vfx-overlay",
  "subtitle-style",
  "composition",
]);
export const AssetEngineSchema = z.enum(["browser", "remotion", "ffmpeg"]);
export type AssetEngine = z.infer<typeof AssetEngineSchema>;
const label = z.string().trim().min(1).max(240);
const repoPath = z
  .string()
  .regex(/^(?:assets|src|examples)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/)
  .refine((p) => p.split("/").every((s) => s !== "." && s !== ".."), "Use a tracked relative resource path.");
const licenseSchema = z.object({
  id: label,
  terms: z.url().startsWith("https://"),
  notice: z.string().min(1),
  permission: z.enum(["licensed-media", "owner-project"]),
});
const implementation = z.object({
  engine: AssetEngineSchema,
  parameters: z.array(label),
  requires: label,
});
export const AssetSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: label,
    kind: AssetKindSchema,
    description: label,
    tags: z.array(label).nonempty(),
    resource: repoPath,
    selector: label.optional(),
    preview: z.object({
      type: z.enum(["image", "audio", "video", "font", "composition"]),
      path: repoPath,
      composition: label.optional(),
    }),
    license: licenseSchema,
    origin: label,
    sourceURL: z.url().startsWith("https://").optional(),
    implementations: z.array(implementation).nonempty(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    seconds: z.number().positive().optional(),
    sampleRate: z.number().int().positive().optional(),
    // Literal subject terms are curated from the image itself. Broad discovery tags cannot trigger an insert.
    subjects: z.array(z.object({ label, terms: z.array(label).nonempty() })).default([]),
    exclusions: z.array(label).default([]),
  })
  .refine(
    (asset) => new Set(asset.implementations.map((i) => i.engine)).size === asset.implementations.length,
    "Specify each rendering engine once per asset.",
  );
export type Asset = z.infer<typeof AssetSchema>;
type AssetInput = z.input<typeof AssetSchema>;
type License = z.infer<typeof licenseSchema>;

const project: License = {
  id: "LicenseRef-Repository",
  terms: "https://github.com/Mati2753/reels-editor",
  permission: "owner-project",
  notice:
    "Use within the authorized project. The repository has no general software license. Review implementation and Remotion licensing for redistribution.",
};
const cc0: License = {
  id: "CC0-1.0",
  terms: "https://creativecommons.org/publicdomain/zero/1.0/",
  permission: "licensed-media",
  notice: "Original studio recording dedicated to the public domain in assets/LICENSES.md.",
};
const ofl: License = {
  id: "OFL-1.1",
  terms: "https://openfontlicense.org/open-font-license-official-text/",
  permission: "licensed-media",
  notice: "Include the bundled OFL and copyright notice when redistributing the font file.",
};
const unsplash: License = {
  id: "LicenseRef-Unsplash",
  terms: "https://unsplash.com/license",
  permission: "licensed-media",
  notice:
    "May be incorporated into an edit. The Unsplash License restricts selling substantially unmodified images or compiling a competing image service.",
};
const use = (engine: AssetEngine, parameters: string[], requires: string) => ({ engine, parameters, requires });
const thumb = (filename: string) => ({ type: "image" as const, path: "assets/library/" + filename });

const photos = [
  {
    key: "alpine",
    name: "Alpine valley",
    description: "A broad mountain valley surrounded by snowy ridges, with evergreens in the foreground.",
    tags: ["landscape", "outdoors", "panoramic", "quiet", "exploration", "travel"],
    width: 950,
    photo: "1464822759023-fed622ff2c3b",
    subjects: [
      {
        label: "mountains",
        terms: [
          "mountain",
          "mountains",
          "mountain range",
          "mountain peaks",
          "snowy peaks",
          "montagne",
          "montagnes",
          "sommets enneigés",
        ],
      },
      { label: "alpine valley", terms: ["alpine valley", "mountain valley", "vallée alpine", "vallée de montagne"] },
    ],
    exclusions: [
      "mountain of",
      "mountains of",
      "mountain dew",
      "mountain climber exercise",
      "mountain climbers exercise",
      "move mountains",
      "mountain bike",
      "mountain biking",
      "mountain lion",
      "mountain goat",
      "montagne de",
      "montagnes de",
      "montagnes russes",
      "mountain pose",
    ],
  },
  {
    key: "forest",
    name: "Deer at the forest edge",
    description: "Deer in a meadow below a conifer forest and a sunlit granite cliff.",
    tags: ["landscape", "wildlife", "quiet", "outdoors", "woodland", "travel"],
    width: 850,
    photo: "1472396961693-142e6e269027",
    subjects: [
      {
        label: "forest",
        terms: [
          "forest",
          "forests",
          "woodland",
          "woodlands",
          "pine woods",
          "pine forest",
          "forêt",
          "forêts",
          "forêt de pins",
        ],
      },
      { label: "deer", terms: ["deer", "deer grazing", "cerf", "cerfs", "chevreuil", "biche"] },
      { label: "meadow", terms: ["mountain meadow", "forest meadow", "prairie de montagne"] },
    ],
    exclusions: [
      "random forest",
      "random forests",
      "decision forest",
      "black forest cake",
      "data forest",
      "forest green",
      "forêt aléatoire",
      "forêts aléatoires",
      "forêt noire gâteau",
      "forest fire",
      "wildfire",
      "forest for the trees",
      "john deere",
    ],
  },
  {
    key: "lake",
    name: "Lakeside boathouse",
    description: "A timber boathouse and a jetty beside a still alpine lake with reflections.",
    tags: ["landscape", "water", "reflection", "calm", "quiet", "travel", "outdoors"],
    width: 850,
    photo: "1470770841072-f978cf4d019e",
    subjects: [
      {
        label: "lake",
        terms: ["lake", "lakes", "lakeside", "lakeshore", "lakeside cabin", "lac", "lacs", "bord du lac"],
      },
      { label: "boathouse", terms: ["boathouse", "boat house", "jetty", "hangar à bateaux", "ponton"] },
    ],
    exclusions: [
      "data lake",
      "data lakes",
      "lake house architecture",
      "lakehouse architecture",
      "lac de données",
      "lacs de données",
      "lake of fire",
      "lake como",
      "lake michigan",
      "lake superior",
      "lake tahoe",
      "loch ness",
    ],
  },
];
const entries: AssetInput[] = photos.map((p) => ({
  id: "photo-" + p.key,
  name: p.name,
  kind: "stock-image",
  description: p.description,
  tags: p.tags,
  subjects: p.subjects,
  exclusions: p.exclusions,
  resource: "assets/library/broll-" + p.key + ".jpg",
  preview: thumb("broll-" + p.key + ".jpg"),
  width: p.width,
  height: 1100,
  license: unsplash,
  origin: "Unsplash photograph used in the studio sample",
  sourceURL: "https://images.unsplash.com/photo-" + p.photo,
  implementations: [
    use("browser", ["start", "end", "crop"], "Bundled JPEG picture insert"),
    use("ffmpeg", ["scale", "crop", "overlay"], "JPEG decoder and overlay filter"),
  ],
}));

const sounds = [
  {
    id: "music-drift",
    name: "Drift",
    kind: "music" as const,
    file: "music/drift.m4a",
    seconds: 12,
    description: "A quiet, pulsing instrumental bed for a reflective passage.",
    tags: ["music", "ambient", "calm", "quiet", "instrumental", "reflective", "underscore", "musique", "ambiance"],
    params: ["gainDb", "duck", "fadeOut"],
  },
  {
    id: "sfx-pulse",
    name: "Pulse",
    kind: "sound-effect" as const,
    file: "sfx/pulse.wav",
    seconds: 0.28,
    description: "A short, low synthesized accent with a fast decay.",
    tags: ["sound effect", "pulse", "impact", "accent", "beat", "low", "emphasis", "accent sonore"],
    params: ["at", "gainDb"],
  },
  {
    id: "sfx-sweep",
    name: "Sweep",
    kind: "sound-effect" as const,
    file: "sfx/sweep.wav",
    seconds: 0.42,
    description: "A soft, filtered noise sweep for a motion cue.",
    tags: ["sound effect", "sweep", "whoosh", "soft", "motion", "transition", "balayage"],
    params: ["at", "gainDb"],
  },
];
for (const s of sounds) {
  const path = "assets/" + s.file;
  entries.push({
    id: s.id,
    name: s.name,
    kind: s.kind,
    description: s.description,
    tags: s.tags,
    resource: path,
    preview: { type: "audio", path },
    license: cc0,
    origin: "Original synthesis for Cutroom",
    seconds: s.seconds,
    sampleRate: 44100,
    implementations: [
      use("browser", s.params, "FFmpeg.wasm audio mixer"),
      use("ffmpeg", s.params, "Native studio audio mixer"),
    ],
  });
}

const fonts = [
  {
    id: "montserrat-extra-bold",
    name: "Montserrat ExtraBold",
    path: "fonts/Montserrat-ExtraBold.ttf",
    weight: 800,
    usage: "captions",
    engines: ["remotion", "browser", "ffmpeg"],
  },
  {
    id: "montserrat-black",
    name: "Montserrat Black",
    path: "fonts/Montserrat-Black.ttf",
    weight: 900,
    usage: "display",
    engines: ["remotion", "ffmpeg"],
  },
  {
    id: "montserrat-semibold",
    name: "Montserrat SemiBold",
    path: "fonts/Montserrat-SemiBold.ttf",
    weight: 600,
    usage: "body",
    engines: ["remotion", "ffmpeg"],
  },
  { id: "dm-sans", name: "DM Sans", path: "studio/dm-sans.woff2", weight: 0, usage: "interface", engines: ["browser"] },
] as const;
for (const f of fonts) {
  const path = "assets/" + f.path;
  entries.push({
    id: "font-" + f.id,
    name: f.name,
    kind: "font",
    description: f.name + " used for " + f.usage + " in the studio.",
    tags: ["font", "sans serif", f.usage, f.name, "typographie"],
    resource: path,
    preview: { type: "font", path },
    license: ofl,
    origin: f.id === "dm-sans" ? "The DM Sans Project Authors" : "The Montserrat Project Authors",
    sourceURL: "https://github.com/google/fonts/tree/main/ofl/" + (f.id === "dm-sans" ? "dmsans" : "montserrat"),
    implementations: f.engines.map((e) =>
      use(
        e,
        ["size", "color"],
        f.weight ? "Bundled TrueType face, weight " + f.weight : "WOFF2 variable interface font",
      ),
    ),
  });
}

// Shared metadata stays small enough to import in a browser worker. Tests check these controls against the actual overlay Zod schemas.
const graphics: [string, string, string[], string[]][] = [
  [
    "HookTitle",
    "Opening title",
    ["opening", "headline", "hook", "introduction", "accroche"],
    ["text", "highlight", "kicker"],
  ],
  ["KeywordPop", "Emphasized word", ["keyword", "emphasis", "mot clé"], ["text", "tone", "tilt"]],
  [
    "BigNumber",
    "Number callout",
    ["number", "percentage", "statistic", "metric", "chiffre"],
    ["value", "decimals", "prefix", "suffix", "label", "countFrom"],
  ],
  ["ListReveal", "Progressive list", ["list", "checklist", "tips", "liste"], ["title", "items", "numbered"]],
  [
    "CtaCard",
    "Call to action",
    ["follow", "subscribe", "save", "appel à l action"],
    ["title", "subtitle", "action", "handle"],
  ],
  [
    "SectionTitle",
    "Chapter title",
    ["chapter", "section", "chapter break", "chapitre"],
    ["index", "title", "subtitle"],
  ],
  [
    "LabelTag",
    "Lower-third label",
    ["speaker", "lower third", "location", "identification"],
    ["name", "detail", "icon"],
  ],
  [
    "SplitCompare",
    "Side-by-side comparison",
    ["compare", "comparison", "before and after", "comparaison"],
    ["left", "right", "winner", "badge"],
  ],
  ["StepFlow", "Step sequence", ["steps", "procedure", "process", "étapes"], ["title", "steps"]],
  ["QuoteCard", "Quotation", ["quote", "quotation", "testimonial", "citation"], ["quote", "author", "detail"]],
  ["ChatBubble", "Conversation", ["chat", "conversation", "messages"], ["name", "messages"]],
  [
    "ChartGrow",
    "Bar chart",
    ["chart", "graph", "statistics", "graphique"],
    ["title", "bars", "unit", "decimals", "highlight"],
  ],
  ["LogoCard", "Brand card", ["logo", "brand", "signature", "marque"], ["name", "initials", "tagline", "shape"]],
  [
    "ScreenMock",
    "Device display",
    ["device", "screen", "interface", "écran"],
    ["device", "url", "title", "lines", "button"],
  ],
];
const slug = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
for (const [component, name, tags, parameters] of graphics) {
  const id = slug(component);
  const implementations = [use("remotion", parameters, "Remotion 4 composition and the project brand kit")];
  if (component === "HookTitle" || component === "BigNumber") {
    implementations.push(
      use(
        "browser",
        component === "HookTitle" ? ["text"] : ["value", "decimals", "prefix", "suffix"],
        "Browser FFmpeg text renderer",
      ),
    );
  }
  entries.push({
    id: "graphic-" + id,
    name,
    kind: "motion-graphic",
    description: name + " timed to a segment or a word.",
    tags,
    resource: "src/remotion/overlays/" + component + ".tsx",
    selector: component,
    preview: thumb("preview-" + id + ".webp"),
    implementations,
    origin: "Cutroom motion graphics library",
    license: project,
  });
}

const transitions = [
  ["fade", ["soft", "dissolve", "gentle", "fondu"]],
  ["slide", ["slide", "directional", "glisser"]],
  ["whip", ["whip pan", "speed", "panoramique"]],
  ["zoom", ["zoom", "punch in", "approach"]],
  ["flash", ["flash", "light", "éclair"]],
  ["glitch", ["digital", "glitch", "distortion"]],
] as const;
for (const [id, tags] of transitions) {
  const implementations = [
    use(
      "remotion",
      ["duration", ...(["slide", "whip"].includes(id) ? ["direction"] : [])],
      "Native Remotion transition track",
    ),
  ];
  if (["zoom", "fade", "flash"].includes(id))
    implementations.push(use("browser", ["duration"], "FFmpeg picture effect; the browser fade passes through black"));
  entries.push({
    id: "transition-" + id,
    name: id[0]!.toUpperCase() + id.slice(1),
    kind: "transition",
    description: "Transition at a junction between two source segments.",
    tags: [id, ...tags],
    resource: "src/remotion/transitions/" + id + ".tsx",
    selector: id,
    preview: thumb("preview-transition-" + id + ".webp"),
    license: project,
    origin: "Cutroom transition library",
    implementations,
  });
}
entries.push(
  {
    id: "caption-bold",
    name: "Bold word captions",
    kind: "subtitle-style",
    description: "Grouped speech captions using the studio Montserrat face.",
    tags: ["subtitles", "captions", "word timing", "speech", "sous titres", "parole"],
    resource: "src/remotion/captions/styles.ts",
    selector: "bold",
    preview: { type: "video", path: "assets/studio/sample-cut.mp4" },
    license: project,
    origin: "Cutroom caption library",
    implementations: [
      use(
        "remotion",
        ["maxWordsPerPage", "position", "emphasis", "overrides", "hide"],
        "Resolved EDL with timed words",
      ),
      use("browser", ["maxWordsPerPage"], "Timed words, bundled font and FFmpeg drawtext"),
    ],
  },
  {
    id: "composition-reel",
    name: "Layered reel",
    kind: "composition",
    description: "Frame-resolved clip, caption, overlay and transition tracks.",
    tags: ["editing composition", "reel", "timeline", "vertical", "montage"],
    resource: "src/remotion/Reel.tsx",
    selector: "Reel",
    preview: { type: "video", path: "assets/studio/sample-cut.mp4" },
    license: project,
    origin: "Cutroom renderer",
    implementations: [use("remotion", ["edl"], "Resolved project EDL and source footage")],
  },
  {
    id: "icon-line-symbols",
    name: "Studio line icons",
    kind: "icon",
    description: "Seventeen vector symbols used by built-in graphics and call-to-action cards.",
    tags: ["icon", "symbol", "person", "pin", "tool", "star", "save", "like", "follow", "location", "symbole"],
    resource: "src/remotion/overlays/ui.tsx",
    selector: "Icon",
    preview: thumb("preview-icons.webp"),
    license: project,
    origin: "Cutroom overlay drawing library",
    implementations: [
      use("remotion", ["name", "size", "color", "strokeWidth"], "A graphic that accepts the chosen symbol"),
    ],
  },
);

export function createAssetRegistry(input: readonly AssetInput[]): readonly Asset[] {
  const assets = z.array(AssetSchema).parse(input);
  if (new Set(assets.map((a) => a.id)).size !== assets.length) throw Error("Asset IDs must be unique.");
  return assets;
}
export const assetRegistry = createAssetRegistry(entries);
export const AssetSearchSchema = z.object({
  query: z.string().trim().max(1200),
  kind: AssetKindSchema.optional(),
  engine: AssetEngineSchema.optional(),
  licensedMediaOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(10),
});
export type AssetSearch = z.input<typeof AssetSearchSchema>;
export const AssetMatchSchema = z.object({
  asset: AssetSchema,
  score: z.number().int().positive(),
  matched: z.array(label).nonempty(),
  reason: z.string().min(1),
});

function tokens(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
function occurrence(haystack: readonly string[], needle: string, literal = false): boolean {
  const search = tokens(needle);
  if (!search.length) return false;
  return haystack.some((word, at) => {
    if (word !== search[0] || !search.every((s, j) => s === haystack[at + j])) return false;
    if (!literal) return true;
    const context = haystack.slice(Math.max(0, at - 4), at);
    return !context.some((s) =>
      ["no", "not", "never", "without", "aucun", "aucune", "sans", "pas", "ni", "neither"].includes(s),
    );
  });
}
function subjects(asset: Asset, words: readonly string[]): string[] {
  if (asset.exclusions.some((p) => occurrence(words, p))) return [];
  return asset.subjects.filter((s) => s.terms.some((term) => occurrence(words, term, true))).map((s) => s.label);
}
const compatible = (asset: Asset, engine?: AssetEngine) =>
  !engine || asset.implementations.some((i) => i.engine === engine);
const alphabetical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function searchAssets(
  input: AssetSearch,
  registry: readonly Asset[] = assetRegistry,
): z.infer<typeof AssetMatchSchema>[] {
  const { query, kind, engine, limit, licensedMediaOnly } = AssetSearchSchema.parse(input);
  const words = tokens(query);
  const hits: z.infer<typeof AssetMatchSchema>[] = [];
  for (const asset of registry) {
    if (
      (kind && asset.kind !== kind) ||
      !compatible(asset, engine) ||
      (licensedMediaOnly && asset.license.permission !== "licensed-media")
    )
      continue;
    const objects = subjects(asset, words);
    const terms = [
      ...new Set([asset.name, asset.kind.replaceAll("-", " "), ...asset.tags].filter((t) => occurrence(words, t))),
    ];
    const matched = [...new Set([...objects, ...terms])];
    if (!matched.length) continue;
    hits.push({
      asset,
      score: objects.length * 6 + terms.length * 2,
      matched,
      reason: "Matched catalog terms “" + matched.join("”, “") + "”.",
    });
  }
  return hits.sort((a, b) => b.score - a.score || alphabetical(a.asset.id, b.asset.id)).slice(0, limit);
}

const phraseSchema = z
  .object({ text: z.string().max(5000), start: z.number().nonnegative(), end: z.number().positive() })
  .refine((p) => p.end > p.start, "Phrase end must follow its start.");
export const BrollSelectionSchema = z
  .object({
    assetId: label,
    file: z.string().regex(/^broll-[a-z0-9-]+\.jpg$/),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    matched: z.array(label).nonempty(),
    reason: z.string().min(1),
    score: z.number().int().positive(),
  })
  .refine((s) => s.end > s.start, "The picture insert needs positive duration.");
export type BrollSelection = z.infer<typeof BrollSelectionSchema>;

export function selectBroll(
  phrases: readonly z.input<typeof phraseSchema>[],
  options: { engine?: AssetEngine } = {},
): BrollSelection | null {
  const candidates: BrollSelection[] = [];
  for (const phrase of z.array(phraseSchema).parse(phrases)) {
    if (phrase.end - phrase.start < 0.75) continue;
    const words = tokens(phrase.text);
    const viable = assetRegistry
      .filter((a) => a.kind === "stock-image" && compatible(a, options.engine ?? "browser"))
      .map((asset) => ({ asset, matched: subjects(asset, words) }))
      .filter((m) => m.matched.length)
      .sort((a, b) => b.matched.length - a.matched.length);
    const best = viable[0];
    // With equally literal alternatives in the same phrase, retain the source picture.
    if (!best || viable[1]?.matched.length === best.matched.length) continue;
    candidates.push({
      assetId: best.asset.id,
      file: best.asset.resource.split("/").at(-1)!,
      start: phrase.start,
      end: Math.min(phrase.end, phrase.start + 3),
      matched: best.matched,
      score: best.matched.length * 6,
      reason:
        "The spoken phrase “" +
        phrase.text.trim() +
        "” names “" +
        best.matched.join("”, “") +
        "”, visible in " +
        best.asset.name +
        ".",
    });
  }
  const chosen = candidates.sort(
    (a, b) => b.score - a.score || a.start - b.start || alphabetical(a.assetId, b.assetId),
  )[0];
  return chosen ? BrollSelectionSchema.parse(chosen) : null;
}
