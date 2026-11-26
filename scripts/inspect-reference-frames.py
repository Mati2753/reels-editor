"""Measure text and optional local CLIP candidates at selected source frame timestamps."""

import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path

MODEL = "Xenova/clip-vit-base-patch32"
REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523"
MODEL_SHA = "0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328"
INPUT_POLICY = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mpegts"]
MAX_FRAMES = 48


def command(arguments, *, timeout=120, binary=False):
    try:
        result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=timeout, check=False, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    except FileNotFoundError as error:
        raise ValueError(f"{arguments[0]} must be installed on this computer.") from error
    except subprocess.TimeoutExpired as error:
        raise ValueError(f"{arguments[0]} exceeded the reference-analysis time budget.") from error
    if result.returncode:
        reason = result.stderr.decode(errors="replace").strip().splitlines()
        raise ValueError(f"{arguments[0]} failed: " + " ".join(reason[-4:])[-650:])
    return result.stdout if binary else result.stdout.decode("utf-8", errors="replace"), result.stderr.decode(errors="replace")


def source_info(file):
    data, _ = command(["ffprobe", "-v", "error", *INPUT_POLICY, "-show_streams", "-show_format",
                       "-of", "json", str(file)], timeout=30)
    meta = json.loads(data)
    picture = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"
                    and not s.get("disposition", {}).get("attached_pic")), None)
    if not picture:
        raise ValueError("The reference has no readable picture stream.")
    duration = float(picture.get("duration") or meta.get("format", {}).get("duration") or 0)
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("A finite source duration is required.")
    return {"duration": duration, "startSeconds": float(picture.get("start_time") or 0),
            "streamIndex": picture["index"], "width": picture["width"], "height": picture["height"]}


def sample_targets(duration, options):
    limit = int(options.get("maxFrames", 16))
    if not 1 <= limit <= MAX_FRAMES:
        raise ValueError("Choose a sampling budget from 1 to 48 frames.")
    requested = options.get("timestamps")
    if requested is None:
        count = min(limit, max(1, math.ceil(duration / .5)))
        # Include source start. The last target lies inside the final sampling interval.
        return [i * duration / count for i in range(count)]
    targets = sorted(set(float(t) for t in requested))
    if not targets or len(targets) > limit or any(not math.isfinite(t) or t < 0 or t >= duration for t in targets):
        raise ValueError("Each requested time must be inside the source and fit the frame budget.")
    return targets


def extract(file, folder, source, targets):
    # prev_t is the previous decoded input frame, including frames rejected by select.
    # -copyts keeps each selected frame's source PTS. Output numbering is independent.
    tests = []
    for relative in targets:
        target = format(source["startSeconds"] + relative, ".12f")
        tests.append(f"gte(t,{target})*if(isnan(prev_t),1,lt(prev_t,{target}))")
    graph = "select='" + "+".join(tests) + "',showinfo,scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease"
    _, log = command(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-copyts", *INPUT_POLICY,
                      "-threads", "1", "-i", str(file), "-map", f"0:{source['streamIndex']}", "-an", "-sn",
                      "-vf", graph, "-filter_threads", "1", "-fps_mode", "passthrough", "-frames:v", str(len(targets)),
                      "-pix_fmt", "rgb24", "-c:v", "ppm", "-threads", "1", "-start_number", "0", str(folder / "%04d.ppm")])
    base = re.search(r"config in time_base:\s*(\d+)/(\d+)", log)
    pts_values = re.findall(r"\bn:\s*\d+\s+pts:\s*(-?\d+)\s+pts_time:", log)
    files = sorted(folder.glob("*.ppm"))
    if not base or len(files) != len(pts_values):
        raise ValueError("Decoded frame timestamps could not be matched to the images.")
    if not files:
        raise ValueError("No decoded frame was available at the selected times.")
    num, den = map(int, base.groups())
    records = []
    for file, pts in zip(files, map(int, pts_values)):
        seconds = max(0., pts * num / den - source["startSeconds"])
        records.append((file, pts, seconds))
    return {"numerator": num, "denominator": den}, records


def ppm(file):
    # FFmpeg's RGB24 PPM writer emits a numeric header and binary RGB data.
    with file.open("rb") as handle:
        tokens = []
        while len(tokens) < 4:
            line = handle.readline(256)
            if not line:
                raise ValueError("Incomplete decoded frame.")
            tokens.extend(line.partition(b"#")[0].split())
        if len(tokens) != 4 or tokens[0] != b"P6" or tokens[3] != b"255":
            raise ValueError("Unexpected pixel layout in decoded frame.")
        w, h = int(tokens[1]), int(tokens[2])
        if not (0 < w <= 960 and 0 < h <= 960):
            raise ValueError("Unexpected image dimensions.")
        pixels = handle.read(w * h * 3 + 1)
        if len(pixels) != w * h * 3:
            raise ValueError("Incomplete decoded frame.")
        return w, h, pixels


def box(x, y, w, h, frame_width, frame_height):
    return {"x": x / frame_width, "y": y / frame_height, "width": w / frame_width, "height": h / frame_height}


def luminance(rgb):
    def linear(value):
        value /= 255
        return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4
    return sum(weight * linear(value) for value, weight in zip(rgb, (.2126, .7152, .0722)))


def caption_color(frame, boxes):
    width, height, pixels = frame
    inside, around = defaultdict(list), defaultdict(list)

    def take(group, x, y):
        if 0 <= x < width and 0 <= y < height:
            index = (y * width + x) * 3
            rgb = pixels[index:index + 3]
            group[tuple(channel // 32 for channel in rgb)].append(rgb)

    for x, y, w, h in boxes:
        stride = max(1, math.ceil(math.sqrt(w * h / 750)))
        for yy in range(y, y + h, stride):
            for xx in range(x, x + w, stride):
                take(inside, xx, yy)
        gap = max(2, round(h * .14))
        for xx in range(x, x + w, max(1, w // 30)):
            take(around, xx, y - gap)
            take(around, xx, y + h + gap)
        for yy in range(y, y + h, max(1, h // 16)):
            take(around, x - gap, yy)
            take(around, x + w + gap, yy)
    if not around or not inside:
        return None

    def central(colors):
        return tuple(round(statistics.median(ch)) for ch in zip(*colors))

    background = max(around.values(), key=len)
    agreement = len(background) / sum(map(len, around.values()))
    if agreement < .48:
        return None
    bg = central(background)
    base_luma = luminance(bg)
    total = sum(map(len, inside.values()))
    # A contrasting cluster must cover a meaningful part of the OCR word boxes.
    for group in sorted(inside.values(), key=len, reverse=True):
        share = len(group) / total
        if not .08 <= share <= .85:
            continue
        ink = central(group)
        light, dark = sorted((base_luma, luminance(ink)), reverse=True)
        ratio = (light + .05) / (dark + .05)
        if ratio >= 3:
            return {"ink": "#%02X%02X%02X" % ink, "background": "#%02X%02X%02X" % bg,
                    "contrastRatio": round(ratio, 2), "backgroundAgreement": round(agreement, 3),
                    "inkCoverage": round(share, 3), "method": "word-box-pixel-clusters"}
    return None


def recognize(file, language, threshold):
    raw, _ = command(["tesseract", str(file), "stdout", "-l", language, "--oem", "1", "--psm", "11", "tsv"], timeout=25)
    frame = ppm(file)
    width, height, _ = frame
    groups = defaultdict(list)
    for row in csv.DictReader(io.StringIO(raw), delimiter="\t", quoting=csv.QUOTE_NONE):
        term = (row.get("text") or "").strip()[:180]
        if row.get("level") != "5" or not term or not any(c.isalnum() for c in term):
            continue
        conf = float(row["conf"]) / 100
        x, y, w, h = [int(row[k]) for k in ("left", "top", "width", "height")]
        if conf < threshold or not (0 <= x < x + w <= width and 0 <= y < y + h <= height):
            continue
        groups[(row["block_num"], row["par_num"], row["line_num"])].append((term, conf, (x, y, w, h)))
    lines = []
    for words in groups.values():
        boxes = [bounds for _, _, bounds in words]
        left = min(x for x, _, _, _ in boxes)
        top = min(y for _, y, _, _ in boxes)
        right = max(x + w for x, _, w, _ in boxes)
        bottom = max(y + h for _, y, _, h in boxes)
        lines.append({"text": " ".join(term for term, _, _ in words),
                      "confidence": round(statistics.mean(c for _, c, _ in words), 4),
                      "box": box(left, top, right - left, bottom - top, width, height),
                      "words": [{"text": t, "confidence": round(c, 4), "box": box(*b, width, height)} for t, c, b in words],
                      "colors": caption_color(frame, boxes)})
    return width, height, lines


def nearby(a, b):
    center = lambda rect, axis, size: rect[axis] + rect[size] / 2
    return (abs(center(a, "x", "width") - center(b, "x", "width")) <= .12 and
            abs(center(a, "y", "height") - center(b, "y", "height")) <= .065)


def collect_cues(samples):
    cues, active = [], []
    for i, sample in enumerate(samples):
        current = []
        for line in sample["lines"]:
            index = next((j for j, cue in enumerate(active) if cue["text"].casefold() == line["text"].casefold()
                         and nearby(cue["box"], line["box"])), None)
            if index is None:
                cue = {"text": line["text"], "firstSeen": sample["seconds"], "lastSeen": sample["seconds"],
                       "previousSample": samples[i - 1]["seconds"] if i else None,
                       "nextSample": None, "observations": 0, "confidence": 0, "box": line["box"]}
                cues.append(cue)
            else:
                cue = active.pop(index)
            cue["observations"] += 1
            cue["confidence"] += (line["confidence"] - cue["confidence"]) / cue["observations"]
            cue["lastSeen"] = sample["seconds"]
            current.append(cue)
        for cue in active:
            cue["nextSample"] = sample["seconds"]
        active = current
    return cues


def possible_style(samples):
    candidates = []
    for sample in samples:
        for line in sample["lines"]:
            b = line["box"]
            cx, cy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
            if abs(cx - .5) <= .16 and .52 <= cy <= .91 and .014 <= b["height"] <= .15:
                candidates.append((sample["pts"], cx, cy, line))
    for _, _, y, _ in candidates:
        group = [row for row in candidates if abs(row[2] - y) <= .035]
        texts = {row[3]["text"].casefold() for row in group}
        if len(texts) < 2 or len({r[0] for r in group}) < 2:
            continue
        inks = [r[3]["colors"]["ink"] for r in group if r[3]["colors"]]
        ink_count = Counter(inks).most_common(1)
        return {"status": "inferred", "basis": "Repeated lower-screen placement with changing recognized text",
                "distinctLines": len(texts), "centerX": statistics.median(r[1] for r in group),
                "centerY": statistics.median(r[2] for r in group),
                "relativeTextHeight": statistics.median(r[3]["box"]["height"] for r in group),
                "medianWordsPerLine": statistics.median(len(s.split()) for s in texts),
                "estimatedInk": ink_count[0][0] if ink_count and ink_count[0][1] >= len(group) / 2 else None,
                "fontFamily": None, "animation": None}
    return None


def local_semantics(labels):
    """Load only operator-installed model data. No network calls occur in this worker."""
    info = {"status": "disabled", "model": MODEL, "revision": REVISION, "labels": labels, "reason": None}
    if not labels:
        return info, None
    model_root = os.environ.get("REELS_CLIP_MODEL_DIR")
    if not model_root:
        info.update(status="unavailable", reason="Configure a pinned CLIP model directory to enable local visual matching.")
        return info, None
    try:
        import numpy as np
        import onnxruntime as ort
        from PIL import Image, ImageOps
        from tokenizers import Tokenizer
        root = Path(model_root)
        graph = root / "onnx" / "model_quantized.onnx"
        digest = hashlib.sha256()
        with graph.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != MODEL_SHA:
            raise ValueError("Model digest does not match the supported revision.")
        cfg = json.loads((root / "preprocessor_config.json").read_text())
        tokenizer = Tokenizer.from_file(str(root / "tokenizer.json"))
        tokenizer.enable_truncation(max_length=77)
        tokenizer.enable_padding(pad_id=49407, pad_token="<|endoftext|>")
        encoded = tokenizer.encode_batch(["a photo of " + label for label in labels])
        ids = np.array([s.ids for s in encoded], dtype=np.int64)
        mask = np.array([s.attention_mask for s in encoded], dtype=np.int64)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        session = ort.InferenceSession(str(graph), sess_options=options, providers=["CPUExecutionProvider"])
        accepted = {entry.name for entry in session.get_inputs()}
        if "logits_per_image" not in {entry.name for entry in session.get_outputs()}:
            raise ValueError("CLIP image-text logits are missing.")
        mean = np.array(cfg["image_mean"], dtype=np.float32)
        std = np.array(cfg["image_std"], dtype=np.float32)
        crop_size = cfg["crop_size"]
        size = (crop_size["width"], crop_size["height"]) if isinstance(crop_size, dict) else (crop_size, crop_size)

        def rank(file):
            with Image.open(file) as image:
                cropped = ImageOps.fit(image.convert("RGB"), size, method=Image.Resampling.BICUBIC)
                pixel = ((np.asarray(cropped, dtype=np.float32) / 255 - mean) / std).transpose(2, 0, 1)[None, ...]
            inputs = {"input_ids": ids, "attention_mask": mask, "pixel_values": pixel}
            logits = session.run(["logits_per_image"], {k: v for k, v in inputs.items() if k in accepted})[0][0]
            scores = np.exp(logits - logits.max())
            scores /= scores.sum()
            ordered = np.argsort(-scores)
            return [{"label": labels[i], "relativeScore": float(scores[i]), "logit": float(logits[i])} for i in ordered]

        info["status"] = "ready"
        return info, rank
    except (ImportError, OSError, ValueError, RuntimeError) as error:
        info.update(status="unavailable", reason=str(error)[:240])
        return info, None


def inspect(file, options):
    started = time.monotonic()
    if not file.is_file():
        raise ValueError("Choose a local video file.")
    source = source_info(file)
    targets = sample_targets(source["duration"], options)
    language = options.get("language", "eng")
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,12}(?:\+[a-z][a-z0-9_]{1,12}){0,3}", language):
        raise ValueError("Invalid Tesseract language list.")
    languages, _ = command(["tesseract", "--list-langs"], timeout=8)
    missing = set(language.split("+")) - set(languages.splitlines())
    if missing:
        raise ValueError("Install the requested Tesseract language data: " + ", ".join(sorted(missing)))
    threshold = float(options.get("minConfidence", .65))
    if not 0 <= threshold <= 1:
        raise ValueError("OCR confidence threshold must be between zero and one.")
    labels = options.get("semanticLabels", [])
    if not isinstance(labels, list) or (labels and not 2 <= len(labels) <= 12) or len(set(labels)) != len(labels):
        raise ValueError("Use between two and twelve unique visual labels.")
    if any(not isinstance(s, str) or not s.strip() or len(s) > 80 for s in labels):
        raise ValueError("Use concise visual labels.")
    semantic, rank = local_semantics(labels)
    samples = []
    with tempfile.TemporaryDirectory(prefix="cutroom-text-") as tmp:
        time_base, frames = extract(file, Path(tmp), source, targets)
        source["timeBase"] = time_base
        for image, pts, seconds in frames:
            w, h, lines = recognize(image, language, threshold)
            scores = []
            if rank:
                try:
                    scores = rank(image)
                except Exception as error:
                    semantic.update(status="unavailable", reason="Visual inference failed: " + str(error)[:200])
                    rank = None
            samples.append({"pts": pts, "seconds": seconds, "width": w, "height": h, "lines": lines, "semanticRanks": scores})
    tesseract, _ = command(["tesseract", "--version"], timeout=8)
    ffmpeg, _ = command(["ffmpeg", "-version"], timeout=8)
    return {"schemaVersion": 1, "source": source, "requestedSeconds": targets, "samples": samples,
            "cues": collect_cues(samples), "captionStyle": possible_style(samples), "semantics": semantic,
            "unresolved": ["Exact font family and animation", "Text visibility between sampled frames",
                           "Whether on-screen text is speech, signage or a title", "Author intent"],
            "runtime": {"ocr": tesseract.splitlines()[0], "ffmpeg": ffmpeg.splitlines()[0],
                        "seconds": time.monotonic() - started, "language": language, "minConfidence": threshold}}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Pass one local video file and an options JSON object on stdin.")
        print(json.dumps(inspect(Path(sys.argv[1]).resolve(strict=True), json.load(sys.stdin)), allow_nan=False))
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
