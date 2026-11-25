import { z } from "zod";

/** Every frame index in a cut uses the output timebase. Source ranges are half-open. */
const frame = z.number().int().nonnegative();
const seconds = z.number().finite().nonnegative();
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const metadata = z.record(z.string(), z.json());
const filename = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) => !/[/\\\u0000-\u001f\u007f]/u.test(name) && name !== "." && name !== "..",
    "Use the original local filename without a directory.",
  );
const rateSchema = z
  .object({
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  })
  .strict();
type Rate = z.infer<typeof rateSchema>;

function asFrame(time: number, rate: Rate): number {
  return Math.round((time * rate.numerator) / rate.denominator);
}

const knownRatios = ["9:16", "16:9", "1:1"] as const;
function aspect(width: number, height: number): (typeof knownRatios)[number] | undefined {
  if (width === height) return "1:1";
  if (width * 16 === height * 9) return "9:16";
  if (width * 9 === height * 16) return "16:9";
  return undefined;
}

const dimensions = {
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
};
const sourceSchema = z
  .object({
    id,
    name: filename,
    bytes: z.number().int().positive(),
    duration: seconds.positive(),
    hasAudio: z.boolean().optional(),
    nativeRate: rateSchema.optional(),
  })
  .strict();

const sceneSchema = z
  .object({
    id,
    clip: id,
    inFrame: frame,
    outFrame: frame,
    name: z.string().min(1).max(256).optional(),
    metadata: metadata.optional(),
  })
  .strict();
const captionSchema = z
  .object({
    id,
    clip: id,
    sceneId: id.optional(),
    startFrame: frame,
    endFrame: frame,
    text: z.string().trim().min(1),
  })
  .strict();

const cutShape = z
  .object({
    schema: z.literal("org.reelforge.cut"),
    version: z.literal(1),
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(512),
    output: z.object({ ...dimensions, ratio: z.enum(knownRatios), rate: rateSchema }).strict(),
    sources: z.array(sourceSchema).min(1),
    scenes: z.array(sceneSchema).min(1),
    captions: z.array(captionSchema),
    metadata: metadata.optional(),
  })
  .strict();

export const PortableCutSchema = cutShape.superRefine((cut, ctx) => {
  const report = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const { rate, width, height, ratio } = cut.output;
  if (aspect(width, height) !== ratio) report(["output", "ratio"], "Canvas dimensions do not match the aspect ratio.");
  const durationFrames = new Map<string, number>();
  cut.sources.forEach((source, i) => {
    if (durationFrames.has(source.id)) report(["sources", i, "id"], "Duplicate source ID.");
    const length = asFrame(source.duration, rate);
    if (!Number.isSafeInteger(length) || length < 1)
      report(["sources", i, "duration"], "Source duration must fit at least one frame on this timebase.");
    durationFrames.set(source.id, length);
  });

  function checkRange(path: (string | number)[], clip: string, start: number, end: number) {
    const length = durationFrames.get(clip);
    if (length === undefined) return report([...path, "clip"], "Unknown source ID.");
    if (end <= start || end > length) report(path, "Source frame range is empty or exceeds the media duration.");
  }
  const sceneClips = new Map<string, string>();
  let sequenceLength = 0;
  cut.scenes.forEach((scene, i) => {
    if (sceneClips.has(scene.id)) report(["scenes", i, "id"], "Duplicate scene ID.");
    sceneClips.set(scene.id, scene.clip);
    checkRange(["scenes", i], scene.clip, scene.inFrame, scene.outFrame);
    sequenceLength += scene.outFrame - scene.inFrame;
  });
  if (!Number.isSafeInteger(sequenceLength)) report(["scenes"], "Sequence frame count exceeds integer precision.");
  const captionIds = new Set<string>();
  cut.captions.forEach((caption, i) => {
    if (captionIds.has(caption.id)) report(["captions", i, "id"], "Duplicate caption ID.");
    captionIds.add(caption.id);
    checkRange(["captions", i], caption.clip, caption.startFrame, caption.endFrame);
    if (caption.sceneId && sceneClips.get(caption.sceneId) !== caption.clip)
      report(["captions", i, "sceneId"], "Caption scene must reference the same source clip.");
  });
});
export type PortableCut = z.infer<typeof PortableCutSchema>;

/** Verify file-picker/probe results before applying an imported cut to local source media. */
export function verifyPortableSources(
  cutInput: PortableCut,
  provided: readonly Pick<PortableCut["sources"][number], "id" | "name" | "bytes" | "duration">[],
): void {
  const cut = PortableCutSchema.parse(cutInput);
  const bindings = z
    .array(sourceSchema.pick({ id: true, name: true, bytes: true, duration: true }).strip())
    .parse(provided);
  const sources = new Map(bindings.map((source) => [source.id, source]));
  if (sources.size !== bindings.length || sources.size !== cut.sources.length)
    throw new Error("Relink one original file for each source ID in the timeline.");
  for (const expected of cut.sources) {
    const actual = sources.get(expected.id);
    if (
      !actual ||
      actual.name !== expected.name ||
      actual.bytes !== expected.bytes ||
      asFrame(actual.duration, cut.output.rate) !== asFrame(expected.duration, cut.output.rate)
    )
      throw new Error("The selected file does not match timeline source " + expected.id + " (" + expected.name + ").");
  }
}

const inputSchema = z.object({
  title: cutShape.shape.title,
  output: z.object({ ...dimensions, rate: rateSchema.optional() }),
  sources: z.array(sourceSchema),
  segments: z.array(
    z.object({
      id,
      clip: id,
      in: seconds,
      out: seconds,
      name: sceneSchema.shape.name,
      metadata: metadata.optional(),
    }),
  ),
  captions: z
    .array(
      z.object({
        id: id.optional(),
        clip: id,
        sceneId: id.optional(),
        start: seconds,
        end: seconds,
        text: captionSchema.shape.text,
      }),
    )
    .optional(),
  metadata: metadata.optional(),
});
export type BuildPortableCutInput = z.input<typeof inputSchema>;

/** Adapt director segment seconds and source-timed caption cues to the portable frame contract. */
export function buildPortableCut(input: BuildPortableCutInput): PortableCut {
  const data = inputSchema.parse(input);
  const { width, height } = data.output;
  const rate = data.output.rate ?? { numerator: 30, denominator: 1 };
  const scenes = data.segments.map(({ in: start, out: end, ...scene }) => ({
    ...scene,
    inFrame: asFrame(start, rate),
    outFrame: asFrame(end, rate),
  }));
  const captions = (data.captions ?? []).map(({ start, end, ...cue }, i) => ({
    ...cue,
    id: cue.id ?? "cue-" + (i + 1),
    startFrame: asFrame(start, rate),
    endFrame: asFrame(end, rate),
  }));
  return PortableCutSchema.parse({
    schema: "org.reelforge.cut",
    version: 1,
    revision: 1,
    title: data.title,
    output: { width, height, rate, ratio: aspect(width, height) },
    sources: data.sources,
    scenes,
    captions,
    metadata: data.metadata,
  });
}

export const SceneRevisionSchema = z
  .object({
    sceneId: id,
    inFrame: frame.optional(),
    outFrame: frame.optional(),
    remove: z.boolean().optional(),
  })
  .strict()
  .refine(
    (change) =>
      change.remove
        ? change.inFrame === undefined && change.outFrame === undefined
        : change.inFrame !== undefined || change.outFrame !== undefined,
    "Specify new source frames or remove the scene.",
  );
export type SceneRevision = z.infer<typeof SceneRevisionSchema>;

/** All changes are atomic. A retained input package remains a fully playable earlier revision. */
export function revisePortableCut(input: PortableCut, revisions: readonly SceneRevision[]): PortableCut {
  const cut = PortableCutSchema.parse(input);
  const changes = z.array(SceneRevisionSchema).min(1).parse(revisions);
  const byId = new Map(changes.map((change) => [change.sceneId, change]));
  if (byId.size !== changes.length) throw new Error("A revision can change a scene only once.");
  const sceneIds = new Set(cut.scenes.map((scene) => scene.id));
  if (changes.some((change) => !sceneIds.has(change.sceneId))) throw new Error("Unknown scene ID in revision.");
  const scenes = cut.scenes
    .filter((scene) => !byId.get(scene.id)?.remove)
    .map((scene) => {
      const change = byId.get(scene.id);
      return change
        ? { ...scene, inFrame: change.inFrame ?? scene.inFrame, outFrame: change.outFrame ?? scene.outFrame }
        : scene;
    });
  const captions = cut.captions.filter((cue) => !cue.sceneId || !byId.get(cue.sceneId)?.remove);
  return PortableCutSchema.parse({ ...cut, scenes, captions, revision: cut.revision + 1 });
}

/** Intersect source-linked captions with each selected occurrence and project them onto the output. */
export function projectCaptions(input: PortableCut) {
  const cut = PortableCutSchema.parse(input);
  let cursor = 0;
  return cut.scenes.flatMap((scene) => {
    const start = cursor;
    cursor += scene.outFrame - scene.inFrame;
    return cut.captions
      .filter((cue) => cue.clip === scene.clip && (!cue.sceneId || cue.sceneId === scene.id))
      .map((cue) => {
        const sourceIn = Math.max(scene.inFrame, cue.startFrame);
        const sourceOut = Math.min(scene.outFrame, cue.endFrame);
        return {
          cueId: cue.id,
          sceneId: scene.id,
          clip: scene.clip,
          text: cue.text,
          sourceIn,
          sourceOut,
          startFrame: start + sourceIn - scene.inFrame,
          endFrame: start + sourceOut - scene.inFrame,
        };
      })
      .filter((cue) => cue.endFrame > cue.startFrame)
      .sort((a, b) => a.startFrame - b.startFrame);
  });
}

const item = (schema: string, name: string) => ({
  OTIO_SCHEMA: schema,
  name,
  metadata: {},
  source_range: null,
  effects: [],
  markers: [],
  enabled: true,
  color: null,
});

/** OTIO 0.18 Clip.2, ExternalReference.1, and Marker.2 interchange, plus lossless ReelForge metadata. */
export function exportOpenTimelineIO(
  input: PortableCut,
  options: { relativeMediaPaths?: Readonly<Record<string, string>> } = {},
) {
  const cut = PortableCutSchema.parse(input);
  const fps = cut.output.rate.numerator / cut.output.rate.denominator;
  const rational = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", value, rate: fps });
  const range = (start: number, duration: number) => ({
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rational(start),
    duration: rational(duration),
  });
  const mediaById = new Map(cut.sources.map((source) => [source.id, source]));
  const filenameCounts = new Map<string, number>();
  for (const source of cut.sources) {
    const key = source.name.normalize("NFC").toLowerCase();
    filenameCounts.set(key, (filenameCounts.get(key) ?? 0) + 1);
  }
  const cues = projectCaptions(cut);
  const picture = cut.scenes.map((scene) => {
    const source = mediaById.get(scene.clip)!;
    const collision = filenameCounts.get(source.name.normalize("NFC").toLowerCase())! > 1;
    // A bundled example can link to its sibling asset folder. Browser exports default to adjacent originals.
    const requested = options.relativeMediaPaths?.[source.id];
    if (
      requested !== undefined &&
      (requested.startsWith("/") ||
        requested.includes("\\") ||
        /^[a-z][a-z0-9+.-]*:/i.test(requested) ||
        requested.split("/").at(-1) !== source.name ||
        /[\u0000-\u001f\u007f]/.test(requested))
    )
      throw new Error("A media override must be a relative local path ending in the original filename.");
    const relative = requested ?? (collision ? source.id + "/" : "") + source.name;
    const uri = (relative.startsWith("../") ? "" : "./") + relative.split("/").map(encodeURIComponent).join("/");
    return {
      ...item("Clip.2", scene.name ?? scene.id),
      source_range: range(scene.inFrame, scene.outFrame - scene.inFrame),
      metadata: { ReelForge: { scene_id: scene.id, source_id: scene.clip } },
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: "ExternalReference.1",
          name: source.name,
          target_url: uri,
          available_image_bounds: null,
          available_range: range(0, asFrame(source.duration, cut.output.rate)),
          metadata: { ReelForge: { source_id: source.id, bytes: source.bytes, duration_seconds: source.duration } },
        },
      },
      active_media_reference_key: "DEFAULT_MEDIA",
      markers: cues
        .filter((cue) => cue.sceneId === scene.id)
        .map((cue) => ({
          OTIO_SCHEMA: "Marker.2",
          name: cue.text,
          comment: cue.text,
          color: "YELLOW",
          marked_range: range(cue.sourceIn, cue.sourceOut - cue.sourceIn),
          metadata: { ReelForge: { kind: "caption", cue_id: cue.cueId, scene_id: scene.id, source_id: scene.clip } },
        })),
    };
  });
  const haveAudio = cut.scenes.some((scene) => mediaById.get(scene.clip)?.hasAudio === true);
  const tracks = [
    { ...item("Track.1", "Picture"), kind: "Video", children: picture },
    ...(haveAudio
      ? [
          {
            ...item("Track.1", "Original audio"),
            kind: "Audio",
            children: picture.map((clip) => {
              const source = mediaById.get(clip.metadata.ReelForge.source_id)!;
              if (source.hasAudio) return { ...clip, markers: [] };
              return { ...item("Gap.1", ""), source_range: range(0, clip.source_range.duration.value) };
            }),
          },
        ]
      : []),
  ];
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: cut.title,
    global_start_time: rational(0),
    metadata: {
      ReelForge: {
        version: cut.version,
        revision: cut.revision,
        output: cut.output,
        caption_representation: "picture clip markers",
        application_metadata:
          "Titles, motion, transitions, grading and the final sound mix use the ReelForge renderer.",
        // JSON text preserves arbitrary app metadata, including objects with reserved OTIO_SCHEMA keys.
        portable_cut_json: JSON.stringify(cut),
      },
    },
    tracks: { ...item("Stack.1", "tracks"), children: tracks },
  };
}
