# Reference evidence

The browser and native reference analyzers use the same measurements and detector in [evidence.ts](../src/intelligence/evidence.ts). A style contains a compact summary. The caller can retain the optional frame trace separately for inspection. Files follow schema version 1.

## Picture and timing

The input to `frameEvidence` is FFmpeg's `metadata=mode=print` text. Apply `REFERENCE_FRAME_FILTER` to the reference's decoded video stream, then append the metadata printer. This filter scales the picture to 144 pixels wide and 8-bit YUV 4:4:4, passes all decoded frames in presentation order, and emits `scdet` and `signalstats` measurements. Temporal sampling, an output frame rate filter or selection of keyframes before this filter changes the measurement. [FFmpeg filter reference](https://ffmpeg.org/ffmpeg-filters.html)

* `sourcePts` retains the presentation time printed by FFmpeg in seconds. `at` is relative to the first measured video frame. Each optional frame row also retains FFmpeg's integer PTS ticks as a string, including values that exceed JavaScript's safe integer range. The parent profile records the probed source time base, dimensions and frame rate where available. Irregular timing is preserved.
* `analyzedSeconds` is the requested measurement window. `coveredSeconds` estimates observed coverage from the last presentation time and a typical frame interval. `missingFrameNumbers` counts gaps between metadata frame numbers. A single frame can establish color at an instant, while its display duration requires an independent timing source.
* `luma`, `shadows` and `highlights` are time-weighted means of each proxy frame's average, 10th percentile and 90th percentile Y values. `contrast` is the time-weighted mean of the per-frame 90th-to-10th percentile span. `chromaU` and `chromaV` are time-weighted mean code values with neutral at 128. These fields use the 0–255 8-bit scale. `saturation` is the FFmpeg SATAVG chroma magnitude, approximately 0–181. The source range, color transfer and proxy conversion affect these figures.
* `motion.median` and `motion.p90` summarize FFmpeg's mean absolute change in Y between adjacent frames. This signal combines movements of subjects, movement of the camera, lighting changes and cuts. Spatial reduction loses fine detail, and source frame rate affects the amount of change per frame.
* A cut candidate retains its source timestamp, underlying scene score and triggering signal. A robust background score sets the threshold. A large adjacent picture change can flag a second closely spaced boundary with a suppressed scene score. Brief bright excursions returning to comparable YUV averages are separately flagged as possible flashes. Gradual dark-ended luminance ramps are possible fades. Natural lighting, camera exposure and rapid editorial cutaways can produce similar evidence.

Detections carry `status: "inferred"` and an evidence-strength score from 0 to 1. This score is heuristic and uncalibrated. The measured timestamp, code values and scene scores remain inspectable. Missing values are stored as `null`. An opaque editorial intention, an exact LUT, a camera trajectory or a specific mask needs additional independent evidence.

## Audio

`audioEvidence` accepts a normalized mono `Float32Array` and its decoded sample rate. It measures RMS and sample peak in dBFS, the count and proportion of samples whose magnitude reaches or exceeds digital full scale, and an RMS envelope. Silence is represented by `null` for logarithmic levels. Mono downmix can obscure clipping in an original channel. Sample peaks do not measure intersample true peak.

The envelope normally uses 100 ms windows and carries the actual window duration. An onset detector combines positive changes in signal energy and first-difference energy. Timestamp and strength accompany each attack. A tempo in BPM is inferred only with repeated, sufficiently consistent onset intervals. Speech, drum hits and effects can all produce attacks. A detected pulse alone does not identify music. Long recordings use at most 2,048 RMS windows and 65,536 onset analysis windows. Their actual time resolutions accompany the result.

`makeReferenceEvidence` accepts an independently measured integrated EBU R128 loudness in LUFS. RMS remains a separate measurement. The compact result describes the provenance of both and lists unmeasured capabilities. [EBU R128](https://tech.ebu.ch/publications/r128) · [FFmpeg ebur128 filter](https://ffmpeg.org/ffmpeg-filters.html#ebur128-1)

## Validation

`npm test -- src/intelligence/evidence.test.ts` exercises decoded frame counts, measured cut times, VFR and non-zero starting timestamps, tick preservation, weighted color, flash and fade ambiguity, invalid data, missing coverage, clipping, silence, and recovery of a 120 BPM click track.

On the bundled 12-second Alpine photo montage, native FFmpeg 7.1.5 and the shipped single-threaded FFmpeg WebAssembly core 0.12.10 decoded 360 frames and independently identified the two constructed cuts at 4.00 and 8.00 seconds. Native scene scores were 24.009 and 19.036. The audio detector abstained from assigning a tempo to the narration.

| One measurement on this CPU workspace | Native | Single-threaded WebAssembly |
| --- | ---: | ---: |
| Video decode and FFmpeg measurements | 709 ms | 2,229 ms |
| Parse and summarize the frame metadata | 7 ms | 5 ms |
| Initialize the WebAssembly core | — | 286 ms |
| Analyze decoded mono PCM in JavaScript | — | 17 ms |

The WebAssembly timing used the exact distributed core in a worker-compatible Node harness. Download time and user-device performance vary. The test fixture uses licensed photographs and synthetic narration. Artistic reproduction on an owner's footage requires their reference and raw clips.
