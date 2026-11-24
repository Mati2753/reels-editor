#!/usr/bin/env python3
"""Word-level transcription of one mono 16 kHz WAV with faster-whisper.

Called by src/pipeline/transcribe.ts; prints one JSON object on stdout:

  {"engine": "faster-whisper", "engineVersion": "...", "model": "...", "language": "fr",
   "words": [{"text": " Bonjour", "start": 0.42, "end": 0.81, "probability": 0.97}, ...]}

Word texts are returned exactly as Whisper produced them (leading space included); the
TypeScript side merges pieces and assigns ids. No decision is taken here.

The audio is read with the standard `wave` module and handed over as samples, so the
PyAV version faster-whisper would otherwise use to decode files does not matter.
"""

from __future__ import annotations

import argparse
import json
import sys
import wave


def read_wav(path: str):
    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16000:
            sys.exit(f"{path}: expected mono 16-bit 16 kHz PCM (run reels ingest)")
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--model", required=True, help="faster-whisper model name or path (e.g. large-v3-turbo, small)")
    ap.add_argument("--language", default="fr")
    ap.add_argument("--prompt", default=None, help="initial prompt (style hint and glossary)")
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--device", default="auto", help="cpu, cuda or auto")
    ap.add_argument("--compute-type", default="default", help="e.g. int8 (CPU), float16 (GPU)")
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--vad", action="store_true", help="skip non-speech regions")
    args = ap.parse_args()

    try:
        import faster_whisper
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("faster-whisper is not installed in this Python. See docs/ARCHITECTURE.md (Transcribe).")

    audio = read_wav(args.wav)
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type, cpu_threads=args.threads)
    segments, info = model.transcribe(
        audio,
        language=None if args.language == "auto" else args.language,
        task="transcribe",
        beam_size=args.beam_size,
        # Temperature 0 only: the same audio gives the same words on every run.
        temperature=0.0,
        initial_prompt=args.prompt or None,
        condition_on_previous_text=False,
        word_timestamps=True,
        vad_filter=args.vad,
    )
    words = []
    for segment in segments:
        for w in segment.words or []:
            words.append(
                {"text": w.word, "start": round(w.start, 3), "end": round(w.end, 3), "probability": round(w.probability, 4)}
            )
    json.dump(
        {
            "engine": "faster-whisper",
            "engineVersion": faster_whisper.__version__,
            "model": args.model,
            "language": info.language,
            "words": words,
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
