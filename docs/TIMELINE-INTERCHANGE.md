# Editable timeline interchange

ReelForge’s cut package records the order of scenes and the exact source frames to use. It contains no footage or credentials. Keep the original clips alongside the export. The OpenTimelineIO file opens those originals in an OTIO-capable editor. [Example timeline](../examples/browser-interchange/alpine-field-notes.otio) · [Source video](../assets/studio/alpine-field-notes.mp4) · [Rendered example](../assets/studio/sample-cut.mp4)

## Time, media and captions

| Field | Meaning |
| --- | --- |
| `schema`, `version`, `revision` | `org.reelforge.cut`, schema version 1 and the edit revision starting at 1. |
| `output` | Pixel width, pixel height, aspect ratio and a rational project frame rate. Vertical 9:16, horizontal 16:9 and square 1:1 are supported. The default clock is 30/1. A fractional rate such as 30000/1001 keeps its original numerator and denominator. |
| `sources` | Stable clip ID, original filename, byte length and probed duration in seconds. Audio presence and native rate can be recorded when known. |
| `scenes` | Stable scene ID, source clip ID and integer source trim measured on the project clock. The in frame is inclusive and the out frame exclusive. Consecutive scenes follow each other in array order. |
| `captions` | Stable cue ID, clip ID, text and source frame interval. An optional scene ID restricts the cue to one use of that media. Otherwise a repeated passage can carry its captions on each appearance. |
| `metadata` | JSON for director decisions, evidence, template settings, grading and application-specific effects. Scenes can also carry their own metadata. |

The package converts timestamps in seconds to the nearest project frame. Input media can have a different or variable native frame rate. Source trim values correspond to elapsed source time at the chosen project rate. A native image index for variable-rate footage requires its presentation timestamps.

`buildPortableCut` accepts director segments with `clip`, `in` and `out` values in source seconds. `PortableCutSchema.parse` validates a saved package, including media references, dimensions, frame bounds, unique IDs and caption ownership. `verifyPortableSources` checks rebound local files by source ID, name, byte count and probed duration to the nearest project frame. File-content authentication requires a separate digest.

`revisePortableCut` applies an array of trims or removals by scene ID. A successful call returns a new package with an incremented revision. Each caller can save the original and revised packages separately. An invalid change rejects the entire call. `projectCaptions` intersects source cues with each surviving source range and returns both source and program frame intervals.

## What moves to another editor

`exportOpenTimelineIO` creates a picture track of OTIO clips, external media references and rational time ranges. A second track carries original sound for sources with confirmed audio. Silent or unconfirmed sources occupy matching gaps on that track. Subtitle cues travel as ranged markers with source IDs and text. The receiving editor can use those markers to build its own subtitle track.

Titles, transitions, font choices, crop moves, grade settings, music, ducking and sound effects supplied in the package are carried in `timeline.metadata.ReelForge.portable_cut_json`. An external editor needs its own renderer to reproduce those application-specific instructions. The ReelForge-rendered MP4 preserves the baked visuals and mix. [OpenTimelineIO timeline structure and rendering](https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html)

Media filenames are URL-encoded and relative to the timeline. When two files have the same name, each reference gets its own source-ID directory. The bundled example uses explicit relative paths to the original under `assets/studio`. Publishing a cut records only the paths and metadata supplied by its caller.

## Verification

The three-shot example was generated from the repository’s Alpine field notes EDL, source identity, caption cues and actual exported MP4. OpenTimelineIO 0.18.1 read, serialized and re-read the example with object equivalence. Its three picture clips and three sound clips total 257 frames at 30 fps. Eight clipped cue markers map back to their exact positions on the source and output tracks. FFprobe independently counted 257 picture frames in the 1080 × 1920 MP4. This fixture uses licensed still photography and a narrated montage. Validation of a client’s artistic style requires their reference and raw footage. [OpenTimelineIO 0.18.1](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/releases/tag/v0.18.1) · [Fixture credits](../assets/LICENSES.md)

On Linux x64 with Node 24.22.3, a 200-run warm benchmark of package parsing, OTIO export and JSON serialization took 0.287 ms median and 0.888 ms at the 95th percentile for this example. These timings cover timeline operations. Video encoding and disk I/O have separate costs.

The project’s TypeScript runtime and Zod are sufficient to export. The optional Python reader was installed in an isolated environment for the interchange check. Source paths use portable URI syntax. Windows and third-party NLE import have not been exercised in this fixture.

Run the unit and error-handling tests from the repository root.

```sh
npx vitest run src/intelligence/timeline.test.ts
```

An environment with `opentimelineio==0.18.1` can repeat the independent read-back.

```python
import opentimelineio as otio

source = "examples/browser-interchange/alpine-field-notes.otio"
timeline = otio.adapters.read_from_file(source)
encoded = otio.adapters.write_to_string(timeline, adapter_name="otio_json")
restored = otio.adapters.read_from_string(encoded, adapter_name="otio_json")
assert restored.is_equivalent_to(timeline)
assert restored.duration() == otio.opentime.RationalTime(257, 30)
assert [track.kind for track in restored.tracks] == ["Video", "Audio"]
assert sum(len(clip.markers) for clip in restored.tracks[0]) == 8
```

