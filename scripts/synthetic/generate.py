#!/usr/bin/env python3
"""Generate synthetic French face-camera footage with a known ground truth.

Regression fixture for phase 1 (ingest / transcribe / analyze). It writes:

  projects/<slug>/raw/a-main.mp4    variable frame rate, 1080x1920, AAC 44.1 kHz mono
  projects/<slug>/raw/b-outro.mov   25 fps, stored 1920x1080 with a 90 degree display
                                    rotation (displays as 1080x1920), AAC 44.1 kHz stereo
  projects/<slug>/truth.json        what is really in the footage, per clip

The speech is synthesised with Piper (neural TTS) from known sentences placed at
known instants. Word boundaries come from Piper's phoneme alignments (the durations
the model actually used to generate the audio), refined on the waveform where a word
touches a pause. The footage contains long silences of known length, "euh" fillers,
an immediate repetition, a restarted sentence, a shot change, and clap marks
(white flash + beep on the same instant) used to check audio/video sync.

Usage (from the repository root):
  python3 -m venv .venv-synthetic
  .venv-synthetic/bin/pip install -r scripts/synthetic/requirements.txt
  # French Piper voice (both files), e.g. into ~/piper-voices/:
  #   https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx
  #   https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json
  .venv-synthetic/bin/python scripts/synthetic/generate.py --slug demo --voice ~/piper-voices/fr_FR-siwis-medium.onnx
  npx reels ingest demo && npx reels transcribe demo && npx reels analyze demo
  npx tsx scripts/synthetic/check.ts demo

Piper's synthesis is not seeded, so each run gives slightly different timings; truth.json
always describes the footage written with it. ffmpeg must be on PATH.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
SR = 22050  # Piper medium voices
PUNCT = {",", ".", "!", "?", ";", ":", "…"}
SEED = 1234

# --------------------------------------------------------------------------------------
# Script of the footage. Times are seconds in the clip. "say" places an utterance right
# after the previous event; "pause" inserts silence of an exact length (measured from the
# end of the last word's audible energy to the start of the next one).
# --------------------------------------------------------------------------------------

CLIPS = [
    {
        "file": "a-main.mp4",
        "events": [
            ("pause", 0.30),
            ("clap",),
            ("pause", 0.60),
            ("say", "Bonjour à tous, aujourd'hui je vais vous montrer trois astuces pour filmer avec votre téléphone."),
            ("pause", 1.20),
            ("say", "Euh, la première astuce, c'est la lumière."),
            ("pause", 0.50),
            ("say", "Mettez-vous toujours face à", {"abandoned": True}),
            ("pause", 0.70),
            ("say", "Mettez-vous toujours face à une fenêtre, jamais dos à elle."),
            ("pause", 1.00),
            ("cut",),
            ("pause", 1.00),
            ("say", "La deuxième astuce, euh, c'est le son."),
            ("pause", 0.60),
            ("say", "Du coup, prenez un petit micro, ça change ça change tout."),
            ("pause", 1.00),
            ("clap",),
            ("pause", 0.60),
        ],
    },
    {
        "file": "b-outro.mov",
        "events": [
            ("pause", 0.30),
            ("clap",),
            ("pause", 0.50),
            ("say", "Et la troisième astuce, c'est de filmer en vertical."),
            ("pause", 1.50),
            ("say", "Voilà, abonnez-vous pour la suite."),
            ("pause", 0.50),
            ("clap",),
            ("pause", 0.50),
        ],
    },
]

# Words the footage really contains that a montage would consider fillers.
FILLER_WORDS = {"euh", "voilà"}
FILLER_PHRASES = [("du", "coup")]

CLAP_SECONDS = 0.10
CLAP_HZ = 1000.0
NOISE_DBFS = -60.0


@dataclass
class Word:
    text: str
    start: float
    end: float
    utterance: int


@dataclass
class ClipTruth:
    file: str
    words: list[Word] = field(default_factory=list)
    utterances: list[dict] = field(default_factory=list)
    claps: list[float] = field(default_factory=list)
    cuts: list[float] = field(default_factory=list)
    duration: float = 0.0


def norm(token: str) -> str:
    return token.strip(".,!?;:…\"«»").lower()


def text_words(text: str) -> list[str]:
    return [t for t in text.split() if norm(t)]


def synthesize(voice, text: str) -> tuple[np.ndarray, list[tuple[float, float]]]:
    """Returns (audio float32 at SR, [(start, end)] per text word), trimmed so the audio
    starts at the first word's onset and ends at the last word's offset."""
    from piper import SynthesisConfig

    cfg = SynthesisConfig(normalize_audio=True, volume=0.5)
    audio_parts: list[np.ndarray] = []
    spans: list[tuple[float, float, bool, bool]] = []  # start, end, after_pause, before_pause
    offset = 0
    for chunk in voice.synthesize(text, syn_config=cfg, include_alignments=True):
        if chunk.phoneme_alignments is None:
            sys.exit("Piper returned no alignments; install piper-tts[alignment] (needs onnx).")
        pos = offset
        current: list[float] | None = None
        prev_pause = True  # BOS counts as a pause
        for al in chunk.phoneme_alignments:
            ph = al.phoneme
            n = int(al.num_samples)
            is_sep = ph == " " or ph in PUNCT or ph in ("^", "$")
            if is_sep:
                if current is not None:
                    current[1] = pos
                    spans.append((current[0], current[1], bool(current[2]), ph != " "))
                    current = None
                if ph in PUNCT or ph in ("^", "$"):
                    prev_pause = True
                elif ph == " ":
                    pass
            else:
                if current is None:
                    current = [pos, pos, prev_pause]
                    prev_pause = False
            pos += n
        if current is not None:
            spans.append((current[0], pos, bool(current[2]), True))
        audio_parts.append(chunk.audio_float_array.astype(np.float32))
        offset += len(chunk.audio_float_array)

    audio = np.concatenate(audio_parts)
    words = text_words(text)
    if len(words) != len(spans):
        sys.exit(f"Word/phoneme group mismatch for {text!r}: {len(words)} words, {len(spans)} groups")

    # Refine boundaries that touch a pause on the waveform: alignment durations include
    # the closure silence of stops and trailing breath, a listener hears the word start
    # at the first audible energy.
    frame = int(0.005 * SR)
    env = np.sqrt(np.convolve(audio.astype(np.float64) ** 2, np.ones(frame) / frame, mode="same"))
    thr = env.max() * 10 ** (-30 / 20)
    refined: list[tuple[int, int]] = []
    for s, e, after_pause, before_pause in spans:
        s0, e0 = int(s), int(min(e, len(audio)))
        idx = np.nonzero(env[s0:e0] > thr)[0]
        rs, re_ = s0, e0
        if len(idx):
            if after_pause:
                rs = s0 + int(idx[0])
            if before_pause:
                re_ = s0 + int(idx[-1]) + 1
        refined.append((rs, re_))

    first, last = refined[0][0], refined[-1][1]
    audio = audio[first:last]
    return audio, [((s - first) / SR, (e - first) / SR) for s, e in refined]


def build_clip(voice, spec: dict) -> tuple[np.ndarray, ClipTruth]:
    truth = ClipTruth(file=spec["file"])
    pieces: list[np.ndarray] = []
    t = 0.0
    utt = 0

    def put(samples: np.ndarray) -> None:
        nonlocal t
        pieces.append(samples)
        t += len(samples) / SR

    for ev in spec["events"]:
        kind = ev[0]
        if kind == "pause":
            put(np.zeros(int(round(ev[1] * SR)), dtype=np.float32))
        elif kind == "clap":
            n = int(CLAP_SECONDS * SR)
            tone = 0.5 * np.sin(2 * np.pi * CLAP_HZ * np.arange(n) / SR).astype(np.float32)
            truth.claps.append(round(t, 4))
            put(tone)
        elif kind == "cut":
            truth.cuts.append(round(t, 4))
        elif kind == "say":
            text = ev[1]
            opts = ev[2] if len(ev) > 2 else {}
            audio, spans = synthesize(voice, text)
            start = t
            words = text_words(text)
            for w, (s, e) in zip(words, spans):
                truth.words.append(Word(text=w, start=round(start + s, 4), end=round(start + e, 4), utterance=utt))
            put(audio)
            truth.utterances.append(
                {
                    "index": utt,
                    "text": text,
                    "start": round(start, 4),
                    "end": round(t, 4),
                    "abandoned": bool(opts.get("abandoned", False)),
                }
            )
            utt += 1
        else:
            raise ValueError(kind)

    audio = np.concatenate(pieces)
    rng = np.random.default_rng(SEED)
    audio = audio + rng.normal(0, 10 ** (NOISE_DBFS / 20), len(audio)).astype(np.float32)
    truth.duration = round(len(audio) / SR, 4)
    return audio, truth


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def ff(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def drawtext(text: str, font: str, size: int, x: str, y: str, color: str = "white", extra: str = "") -> str:
    font_opt = f"fontfile={font}" if Path(font).exists() else f"font={font}"
    text = text.replace(":", r"\:")
    return f"drawtext={font_opt}:text='{text}':fontsize={size}:fontcolor={color}:x={x}:y={y}{extra}"


def video_filter(truth: ClipTruth, font: str, label: str) -> str:
    """Portrait 1080x1920 picture: one background per shot, a moving disc (so
    consecutive frames differ), a running clock, 'HAUT' at the top to check rotation,
    and a full white frame during each clap."""
    cut = truth.cuts[0] if truth.cuts else None
    parts = []
    if cut is not None:
        parts.append(f"drawbox=x=0:y=0:w=iw:h=ih:color=0x2b6f3a:t=fill:enable='gte(t,{cut})'")
    # Moving element (drawbox does not animate its position, drawtext does): motion
    # inside a shot that scene detection must not mistake for a cut.
    parts.append(drawtext("O", font, 220, "440+300*sin(t)", "900+200*cos(t*0.7)", color="0xf2c14e"))
    parts.append(drawtext("HAUT", font, 120, "(w-text_w)/2", "80"))
    parts.append(drawtext(f"{label} PLAN A", font, 90, "(w-text_w)/2", "400", extra=(f":enable='lt(t,{cut})'" if cut else "")))
    if cut is not None:
        parts.append(drawtext(f"{label} PLAN B", font, 90, "(w-text_w)/2", "400", extra=f":enable='gte(t,{cut})'"))
    parts.append(drawtext("%{pts:hms}", font, 70, "(w-text_w)/2", "1700"))
    for c in truth.claps:
        parts.append(f"drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,{c},{c + CLAP_SECONDS - 0.001})'")
    return ",".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", default="demo")
    ap.add_argument("--voice", required=True, help="Piper voice .onnx (French), with its .onnx.json next to it")
    ap.add_argument("--font", default="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    help="font file, or a fontconfig family name")
    ap.add_argument("--force", action="store_true", help="overwrite an existing raw/ folder")
    args = ap.parse_args()

    from piper import PiperVoice

    project = REPO_ROOT / "projects" / args.slug
    raw = project / "raw"
    if raw.exists() and any(raw.iterdir()) and not args.force:
        sys.exit(f"{raw} is not empty; pass --force to overwrite")
    raw.mkdir(parents=True, exist_ok=True)
    (project / "work").mkdir(exist_ok=True)
    (project / "out").mkdir(exist_ok=True)

    voice = PiperVoice.load(args.voice, include_alignments=True)
    truths = []
    with tempfile.TemporaryDirectory() as tmp_s:
        tmp = Path(tmp_s)
        for i, spec in enumerate(CLIPS):
            audio, truth = build_clip(voice, spec)
            wav = tmp / f"{i}.wav"
            write_wav(wav, audio)
            dur = f"{truth.duration:.4f}"
            label = f"C{i + 1}"
            vf = video_filter(truth, args.font, label)
            out = raw / spec["file"]
            if spec["file"].endswith(".mp4"):
                # Variable frame rate: render at 60 fps, drop frames irregularly, keep pts.
                ff([
                    "-f", "lavfi", "-i", f"color=c=0x1d3557:s=1080x1920:r=60:d={dur}",
                    "-i", str(wav),
                    "-vf", vf + ",select='not(eq(mod(n\\,7)\\,3))*not(eq(mod(n\\,5)\\,1))*not(between(mod(n\\,97)\\,40\\,52))'",
                    "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-ac", "1", "-b:a", "128k",
                    "-shortest", str(out),
                ])
                truth_extra = {"encoded": "vfr (60 fps grid, irregular frame drops)", "rotation": 0}
            else:
                # 25 fps, frame stored landscape (rotated 90 deg clockwise) and a display
                # matrix asking players to rotate it back: what a phone held upright writes.
                landscape = tmp / f"{i}-land.mp4"
                ff([
                    "-f", "lavfi", "-i", f"color=c=0x6a1b4d:s=1080x1920:r=25:d={dur}",
                    "-i", str(wav),
                    "-vf", vf + ",transpose=1",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", str(landscape),
                ])
                ff(["-display_rotation", "90", "-i", str(landscape), "-c", "copy", str(out)])
                truth_extra = {"encoded": "25 fps cfr, stored 1920x1080, display rotation 90", "rotation": 90}
            d = {
                "file": truth.file,
                "duration": truth.duration,
                "claps": truth.claps,
                "cuts": truth.cuts,
                "utterances": truth.utterances,
                "words": [w.__dict__ for w in truth.words],
                **truth_extra,
            }
            truths.append(d)
            print(f"wrote {out.relative_to(REPO_ROOT)} ({truth.duration:.2f} s, {len(truth.words)} words)")

    meta = {
        "generator": "scripts/synthetic/generate.py",
        "voice": Path(args.voice).name,
        "noiseDbfs": NOISE_DBFS,
        "clapSeconds": CLAP_SECONDS,
        "fillerWords": sorted(FILLER_WORDS),
        "fillerPhrases": [" ".join(p) for p in FILLER_PHRASES],
        "clips": truths,
    }
    (project / "truth.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {(project / 'truth.json').relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH")
    main()
