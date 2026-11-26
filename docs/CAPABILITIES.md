# ReelForge capability matrix

Cutroom is the studio in this repository. The audit baseline is commit ddc317c. It contained 109 source files, two Claude Code agent definitions, one review command, a 14-component motion library, six rendered transitions, a native director and a separate browser renderer. Nine suites had 203 passing tests. Native VFR ingest, word alignment, font measurement, safe-zone validation, pre-render checks, audio mixing and rendering already existed. The browser previously sampled references at 4 fps, stored one source and labeled RMS as LUFS. Both runtimes now share versioned style data and the reference measurement code.

| Capability | Status and scope |
| --- | --- |
| Reference inspection | Operational for decodable media. Every decoded reference frame contributes timestamped measurements at reduced spatial resolution. Cut, flash and fade classifications have heuristic confidence. Separate PCM, EBU R128, onset and tempo evidence. |
| Style templates | Operational in the browser. Select several reference files together, inspect/download their evidence, change pacing and caption groups and preserve prior versions. Preferences are local to this device. |
| Content-aware direction | Operational for speech grouping, retakes, source order, emphasis, source changes, conditional transitions and limited licensed B-roll. Per-scene reasons export in the portable timeline. Narrative intent and artistic merit still require review. |
| Visual semantics | Optional representative-frame CLIP classification. Local native CLIP was exercised on mountains, forest and lake. Browser model weights download on first use. Low-margin classifications abstain. |
| Subtitle analysis | Embedded text and word timing are supported. Local browser and native Tesseract OCR measure visible text, geometry and contrast. The browser learns grouping, height and vertical placement from changing centered text. Exact font identification and arbitrary subtitle animations remain unresolved. |
| Picture and sound | Operational browser color matching, framing, zooms, timed graphics, ducking and mix. One original music bed and two effects. Frontal-face reframing, green/blue screen isolation and tracked foreground reframing are available in browser edit settings. Ordinary-background portrait matting and per-scene mask export run locally. General object matting and advanced VFX remain unavailable. |
| Formats and interchange | Vertical, horizontal and square browser renders. Multiple clips, frame-aligned editable source trims, JSON and OpenTimelineIO export. Remotion's native composition remains vertical. Effects travel in application metadata when another editor cannot reproduce them. |
| Asset search and memory | Operational typed tagged search of shipped assets, negative matches, rights metadata and previews. User-directed revisions persist. Explicit camera, caption, music and B-roll feedback is retrieved by template family and speech presence. Up to 30 past edit or feedback records remain on the device. Learning from unlabelled creative outcomes is partial. No model training occurs. |
| Post-render checks | The browser decodes the finished MP4 and compares dimensions, timing, cuts and picture/audio levels. Bounded rerenders adjust exposure and gain, and can add a backplate to specific captions flagged by sampled OCR. Unknown checks are reported. Semantic coherence, caption contrast on every frame, and perceived intelligibility do not have a complete automated verifier. |
| Recovery | Source media stays unchanged. The browser caches completed scene renders and the last successful output in IndexedDB when device storage permits. Interrupted native local jobs also resume with the original edit ID. |
| Tools and providers | Local MCP exposes analysis, reference fusion, style revision, OCR, asset search, quality evaluation and OTIO. Native HTTP endpoints include asset search, export and technical evaluation. Server-side Pexels, Freesound and ElevenLabs adapters have contract tests. Live calls require separately authorized accounts, rights and for voice a configured budget. No paid provider was called in validation. |
| Compute | Browser single-thread FFmpeg WASM and native CPU rendering verified on Linux. Native optional CLIP and OCR run in separate processes. Native H.264 adapter probing and CPU fallback were exercised. Physical GPU encoding, hosted GPU workers and Windows execution still require hardware validation. |
| Generative and advanced production | Local percentage illustrations render from literal speech. An optional native ComfyUI image adapter has contract tests and requires a licensed local checkpoint. Prompt-to-video generation, general object replacement and full scene relighting remain unavailable. Professional fidelity across arbitrary styles remains unvalidated. |

## Evidence and examples

The square example combines the licensed narrated photo montage with a six-second technical fixture. Its MP4, original-source timeline and output quality report are checked in together. The renderer used the original shots, speech and a licensed matching illustration. The example exercises the pipeline. Customer footage is still needed to evaluate whether the results reproduce the intended creative style. [Rendered example](../examples/verified-browser/reel.mp4) · [Source timeline](../examples/verified-browser/timeline.json) · [Quality observations](../examples/verified-browser/quality.json)

[Native frame evidence and profiling](REFERENCE-EVIDENCE.md) · [Dependency compatibility and licensing](RESEARCH-EDITING.md) · [Official OTIO round trip](TIMELINE-INTERCHANGE.md)

## Claude Code and Codex

Start the stdio server using the repository's Node environment with `npm run --silent mcp`. Set `REELS_PROJECTS_ROOT` to the trusted media directory. Filesystem tools resolve paths inside that directory. The browser keeps media on the device. Provider credentials are supplied to the local server process. Automatic paid voice synthesis is absent from the tool list until the operator configures credentials and a positive credit ceiling.

## Vision and external providers

SAM 2 requires a compatible PyTorch environment and is a prompt-conditioned segmentation model. Depth Anything V2 Small has an Apache-2.0 license, while the larger official weights have noncommercial conditions. These model families are alternatives for a future isolated GPU worker. Pexels stock search and Freesound metadata require per-item licensing and attribution checks. Higgsfield video generation requires an authorized account and budget. No browser code handles provider keys. [SAM 2](https://github.com/facebookresearch/sam2) · [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) · [Pexels](https://www.pexels.com/api/documentation/) · [Freesound](https://freesound.org/docs/api/) · [Higgsfield](https://open.higgsfield.ai/quick-start) · [ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

The independent FFprobe check counted all 422 planned pictures in the square render. The QA report marks properties without independent evidence as unmeasured. The native OCR fixture and observed boxes are in the same example directory. The verified source-rate and OTIO timings are documented separately above.

[Feedback, caption learning and tracked-screen validation](DIRECTOR-VALIDATION.md)

[Portrait matting, downloadable masks and verified composites](PORTRAIT-MATTES.md)

| Additional capability | Verified scope |
| --- | --- |
| Audio recognition and revision | Browser and native reference analysis use local YAMNet acoustic tags. The browser preserves existing sustained music and can lower added sound over time ranges where a rendered mix masks speech. Human listening remains necessary. |
| Approved examples | A user can keep a camera, subtitle or mix treatment and replay the last three approved source/edit examples on the same device. Preference retrieval and playback after reload were exercised in Chromium. |

[Sound direction and before/after validation](AUDIO-DIRECTION.md)

All fifteen requested asset categories now contain resources and previews. The browser can insert moving NASA footage for a relevant spoken phrase. The native processor can apply a built-in LUT, texture, mesh rendition or VFX overlay over a specified interval. [Rendered examples and limits](PRODUCTION-ASSETS.md) · [Coverage of the original brief](BRIEF-COVERAGE.md)
