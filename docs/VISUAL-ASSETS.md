# On-screen text and reference-image semantics

The native `inspectVisualAssets` tool reads a local reference file, decodes selected source frames, reads visible words using Tesseract and optionally ranks a caller-supplied set of visual descriptions using a locally installed CLIP model. FFmpeg keeps the source timestamps. Each sample reports the decoded integer presentation timestamp, stream time base, source-relative seconds, analyzed dimensions, normalized OCR word/line boxes and Tesseract recognition scores. Rotated video is measured in its displayed orientation. Input and output paths stay with the calling project.

The default budget is 16 frames spanning the duration. Callers can give precise times or raise the budget to 48. The selected frame is the first decoded frame at or after each requested time. Multiple target times within the same frame interval can produce a single observation. A reported cue contains its first and last sightings and the adjacent sample times. Exact visibility between those samples is unknown. A stable lower-screen region with changing text can yield a positioning and cue-length suggestion. Exact font family, animation curve, dialogue attribution and artistic intent remain unresolved.

The worker compares robust pixel-color clusters inside word boxes with pixels around them. An ink/background estimate needs a clear local background, sufficient contrasting pixel support and a measured luminance contrast ≥3. Busy backgrounds frequently produce a null result. OCR can read environmental signs and can misread texture as short words. Retain the frame/time evidence when reviewing a proposed subtitle style.

## Runtime

OCR uses Python 3.10+, FFmpeg with FFprobe, and Tesseract 5 with installed trained data for the selected language, such as `eng` or `eng+fra`. The OCR-only path uses the Python standard library. Set `REELS_VISUAL_PYTHON` to select a Python interpreter. The local site or MCP handler must supply its authorized media directory as the third argument to `inspectVisualAssets`. The worker accepts regular media files, restricts FFmpeg container and protocol handling, and removes its temporary images.

Tesseract 5.5.0, FFmpeg 7.1.5 and English data were exercised on Linux CPU. Tesseract publishes its engine under Apache-2.0. Its TSV mode returns per-word confidence and geometry. The official browser port Tesseract.js uses WebAssembly and workers. The native tool uses the installed executable. [Tesseract TSV documentation](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html#tsv-output) · [Engine and license](https://github.com/tesseract-ocr/tesseract) · [Browser port](https://github.com/naptha/tesseract.js)

## Optional local image/text model

Set `REELS_CLIP_MODEL_DIR` to an operator-prepared directory containing `onnx/model_quantized.onnx`, `tokenizer.json` and `preprocessor_config.json` from revision `6b7c523703ae26e39be4b03774966f8571c7f523` of `Xenova/clip-vit-base-patch32`. The separate Python environment needs ONNX Runtime CPU, numpy, tokenizers and Pillow. The worker checks the 153,695,702-byte quantized graph against SHA-256 `0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328`. The model card identifies the ONNX conversion as MIT. Preprocessing center-crops sampled frames and uses the pinned processor's channel normalization. [Pinned model files and card](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/6b7c523703ae26e39be4b03774966f8571c7f523) · [Original CLIP implementation](https://github.com/openai/CLIP)

Supplying 2–12 `semanticLabels` enables local image/text matching. An absent model/dependency produces an explicit unavailable reason while OCR continues. Results include candidate logits and a softmax across the supplied choices. A higher score means a better match among those choices. It cannot establish a subject's identity or an editor's intended emotion. The worker makes zero provider requests.

## Measured checks

| Input | Result on the test CPU |
| --- | --- |
| Rendered 640×360 two-card fixture, 10 fps, 3 seconds | Six sampled images in 2.10 s. Recognized both two-word lines. Last sighting of the first line 1.2 s; first sighting of the second 1.6 s. Estimated ink white, line center at 71.1% of frame height. The authored cue switch was at 1.5 s. |
| Licensed alpine demo, source times 0.5, 5 and 9 s | OCR + CPU ONNX inference in 1.94 s after installing model assets. Top scene candidates were snowy mountains (0.923), forest trees (0.593) and a lake (0.709), from four choices including a city street. |
| Irregular-frame-rate fixture | Tests check that requested times 1.05 s and 1.30 s resolve to actual decoded frames at 1.25 s and 1.50 s. Blank images produce zero caption cues. |

These fixtures exercise timing, image measurements and local inference. The user's own reference supplies the evidence for a judgment about how faithfully an edit reproduces their style.
