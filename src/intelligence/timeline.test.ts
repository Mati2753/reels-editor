import { describe, expect, it } from "vitest";
import {
  buildPortableCut,
  exportOpenTimelineIO,
  PortableCutSchema,
  projectCaptions,
  revisePortableCut,
  verifyPortableSources,
  type BuildPortableCutInput,
} from "./timeline";

function fixture(): BuildPortableCutInput {
  return {
    title: "Interview and the ridge",
    output: { width: 720, height: 1280 },
    sources: [
      { id: "a", name: "interview #1.mp4", bytes: 2048, duration: 12, hasAudio: true },
      { id: "b", name: "ridge.mp4", bytes: 4096, duration: 6, hasAudio: false },
    ],
    segments: [
      { id: "opening", clip: "a", in: 1, out: 3 },
      { id: "cutaway", clip: "b", in: 2, out: 3.5 },
      { id: "return", clip: "a", in: 7, out: 9 },
    ],
    captions: [
      { id: "greeting", clip: "a", start: 0.5, end: 1.5, text: "Come along" },
      { id: "top", clip: "a", sceneId: "return", start: 7.25, end: 7.75, text: "The top" },
    ],
    metadata: { grade: { contrast: 1.05 }, decisions: [{ reason: "Show the mountain when it is mentioned." }] },
  };
}

describe("portable editing timeline", () => {
  it.each([
    [720, 1280, "9:16"],
    [1920, 1080, "16:9"],
    [1080, 1080, "1:1"],
  ] as const)("validates the %i × %i canvas and preserves its ratio", (width, height, ratio) => {
    const input = fixture();
    input.output = { width, height };
    const cut = buildPortableCut(input);
    expect(cut.output).toEqual({ width, height, ratio, rate: { numerator: 30, denominator: 1 } });
    expect(PortableCutSchema.parse(JSON.parse(JSON.stringify(cut)))).toEqual(cut);
  });

  it("retains the rational clock and rounds source trims to integral project frames", () => {
    const input = fixture();
    const rate = { numerator: 30000, denominator: 1001 };
    input.output.rate = rate;
    input.segments[0]!.in = 1.017;
    const cut = buildPortableCut(input);
    expect(cut.scenes[0]?.inFrame).toBe(30);
    const otio = exportOpenTimelineIO(cut);
    expect(otio.global_start_time.rate).toBe(30000 / 1001);
    expect(otio.metadata.ReelForge.output.rate).toEqual(rate);
  });

  it.each([
    "empty",
    "past end",
    "negative",
    "unknown media",
    "duplicate scene",
    "duplicate media",
    "unknown caption scene",
    "caption mismatch",
    "unknown caption source",
    "duplicate caption",
    "caption outside media",
    "portrait ratio mismatch",
    "path masquerading as filename",
  ])("rejects %s", (problem) => {
    const cut = buildPortableCut(fixture());
    switch (problem) {
      case "empty":
        cut.scenes[0]!.outFrame = cut.scenes[0]!.inFrame;
        break;
      case "past end":
        cut.scenes[0]!.outFrame = 361;
        break;
      case "negative":
        cut.scenes[0]!.inFrame = -1;
        break;
      case "unknown media":
        cut.scenes[0]!.clip = "missing";
        break;
      case "duplicate scene":
        cut.scenes[1]!.id = cut.scenes[0]!.id;
        break;
      case "duplicate media":
        cut.sources[1]!.id = cut.sources[0]!.id;
        break;
      case "unknown caption scene":
        cut.captions[0]!.sceneId = "missing";
        break;
      case "caption mismatch":
        cut.captions[0]!.sceneId = "cutaway";
        break;
      case "unknown caption source":
        cut.captions[0]!.clip = "missing";
        break;
      case "duplicate caption":
        cut.captions[1]!.id = cut.captions[0]!.id;
        break;
      case "caption outside media":
        cut.captions[0]!.endFrame = 1000;
        break;
      case "portrait ratio mismatch":
        cut.output.ratio = "1:1";
        break;
      case "path masquerading as filename":
        cut.sources[0]!.name = "../outside.mp4";
        break;
    }
    expect(PortableCutSchema.safeParse(cut).success).toBe(false);
  });

  it("requires matching file identity, byte count and source duration when relinking an imported package", () => {
    const cut = buildPortableCut(fixture());
    expect(() => verifyPortableSources(cut, [...cut.sources].reverse())).not.toThrow();
    expect(() => verifyPortableSources(cut, [cut.sources[0]!, cut.sources[0]!])).toThrow();
    expect(() =>
      verifyPortableSources(
        cut,
        cut.sources.map((s) => ({ ...s, bytes: s.bytes + 1 })),
      ),
    ).toThrow();
    expect(() =>
      verifyPortableSources(
        cut,
        cut.sources.map((s) => ({ ...s, name: "wrong.mp4" })),
      ),
    ).toThrow();
    expect(() =>
      verifyPortableSources(
        cut,
        cut.sources.map((s) => ({ ...s, duration: s.duration + 0.1 })),
      ),
    ).toThrow();
  });

  it("projects inherited captions at two appearances of the same footage", () => {
    const input = fixture();
    input.segments.push({ id: "again", clip: "a", in: 1.2, out: 1.6 });
    const cut = buildPortableCut(input);
    expect(projectCaptions(cut).map((c) => [c.sceneId, c.sourceIn, c.sourceOut, c.startFrame, c.endFrame])).toEqual([
      ["opening", 30, 45, 0, 15],
      ["return", 218, 233, 113, 128],
      ["again", 36, 45, 165, 174],
    ]);
  });

  it("revises two scenes without altering past trims, original sources, or caption source timing", () => {
    const previous = buildPortableCut(fixture());
    const snapshot = JSON.stringify(previous);
    const next = revisePortableCut(previous, [
      { sceneId: "opening", inFrame: 42 },
      { sceneId: "cutaway", remove: true },
    ]);
    expect(JSON.stringify(previous)).toBe(snapshot);
    expect(next.revision).toBe(2);
    expect(next.sources).toEqual(previous.sources);
    expect(next.scenes.map((s) => s.id)).toEqual(["opening", "return"]);
    expect(next.captions).toEqual(previous.captions);
    expect(projectCaptions(next)[0]).toMatchObject({ startFrame: 0, endFrame: 3, sourceIn: 42, sourceOut: 45 });
  });

  it("rejects invalid requests atomically", () => {
    const cut = buildPortableCut(fixture());
    const snapshot = JSON.stringify(cut);
    expect(() =>
      revisePortableCut(cut, [
        { sceneId: "opening", inFrame: 50 },
        { sceneId: "missing", remove: true },
      ]),
    ).toThrow();
    expect(() =>
      revisePortableCut(cut, [
        { sceneId: "opening", outFrame: 40 },
        { sceneId: "opening", outFrame: 41 },
      ]),
    ).toThrow();
    expect(() => revisePortableCut(cut, [{ sceneId: "opening", inFrame: 90 }])).toThrow();
    expect(() => revisePortableCut(cut, [{ sceneId: "opening", inFrame: 31, remove: true }])).toThrow();
    expect(() =>
      revisePortableCut(
        cut,
        cut.scenes.map((s) => ({ sceneId: s.id, remove: true })),
      ),
    ).toThrow();
    expect(JSON.stringify(cut)).toBe(snapshot);
  });

  it("removes only scene-specific captions when deleting a scene", () => {
    const cut = buildPortableCut(fixture());
    const next = revisePortableCut(cut, [{ sceneId: "return", remove: true }]);
    expect(next.captions.map((c) => c.id)).toEqual(["greeting"]);
    expect(cut.captions.map((c) => c.id)).toEqual(["greeting", "top"]);
  });
});

describe("OpenTimelineIO interchange", () => {
  it("exports picture clips, source sound with a silent gap, clipped source-time subtitle markers and reconstruction metadata", () => {
    const cut = buildPortableCut(fixture());
    const json = exportOpenTimelineIO(cut);
    const [picture, audio] = json.tracks.children;
    const tracks = JSON.parse(JSON.stringify(json.tracks)) as {
      children: Array<{
        children: Array<{
          OTIO_SCHEMA: string;
          source_range: { start_time: { value: number }; duration: { value: number } };
          media_references?: { DEFAULT_MEDIA: { target_url: string } };
          markers: Array<{ marked_range: { start_time: { value: number }; duration: { value: number } } }>;
        }>;
      }>;
    };
    expect(json.OTIO_SCHEMA).toBe("Timeline.1");
    expect(picture?.kind).toBe("Video");
    expect(audio?.kind).toBe("Audio");
    const clips = tracks.children[0]!.children;
    expect(clips.map((c) => [c.source_range.start_time.value, c.source_range.duration.value])).toEqual([
      [30, 60],
      [60, 45],
      [210, 60],
    ]);
    expect(clips[0]!.media_references?.DEFAULT_MEDIA.target_url).toBe("./interview%20%231.mp4");
    expect(clips[0]!.markers[0]!.marked_range).toMatchObject({ start_time: { value: 30 }, duration: { value: 15 } });
    expect(tracks.children[1]?.children.map((c) => c.OTIO_SCHEMA)).toEqual(["Clip.2", "Gap.1", "Clip.2"]);
    const reconstructed = PortableCutSchema.parse(JSON.parse(json.metadata.ReelForge.portable_cut_json));
    expect(reconstructed).toEqual(cut);
  });

  it("disambiguates equal local filenames with different source IDs", () => {
    const input = fixture();
    input.sources[1]!.name = input.sources[0]!.name;
    const visual = exportOpenTimelineIO(buildPortableCut(input)).tracks.children[0]!.children;
    expect(visual[0]).toMatchObject({
      media_references: { DEFAULT_MEDIA: { target_url: "./a/interview%20%231.mp4" } },
    });
    expect(visual[1]).toMatchObject({
      media_references: { DEFAULT_MEDIA: { target_url: "./b/interview%20%231.mp4" } },
    });
  });

  it("exports an explicitly selected relative media location and rejects a remote or mismatched override", () => {
    const cut = buildPortableCut(fixture());
    const location = (name: string) => exportOpenTimelineIO(cut, { relativeMediaPaths: { a: name } });
    expect(location("../media/interview #1.mp4").tracks.children[0]!.children[0]).toMatchObject({
      media_references: { DEFAULT_MEDIA: { target_url: "../media/interview%20%231.mp4" } },
    });
    for (const path of ["https://example.test/interview #1.mp4", "/interview #1.mp4", "../wrong.mp4"]) {
      expect(() => location(path)).toThrow();
    }
  });

  it("leaves out the source audio track when selected media has no confirmed audio", () => {
    const input = fixture();
    input.segments = [input.segments[1]!];
    input.captions = [];
    expect(exportOpenTimelineIO(buildPortableCut(input)).tracks.children).toHaveLength(1);
  });
});
