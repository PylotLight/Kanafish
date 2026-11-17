#!/usr/bin/env python3
"""Optional Irodori-TTS v4.1-Small worker for Kanafish.

This process uses only the app-managed local model, tokenizer, and codec files.
It speaks one bounded JSON object per input/output line and never starts a server.
"""
from __future__ import annotations

import argparse
import base64
import gc
import io
import json
import os
import platform
import sys
import time
from pathlib import Path

_PROTOCOL_STDOUT = sys.stdout
sys.stdout = sys.stderr
MAX_INPUT_BYTES = 16 * 1024
MAX_OUTPUT_BYTES = 14 * 1024 * 1024
MAX_TEXT_CHARS = 1200


def emit(message: dict) -> None:
    encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_OUTPUT_BYTES:
        encoded = json.dumps({"type": "fatal", "error": "Sidecar response exceeded the size limit."})
    _PROTOCOL_STDOUT.write(encoded + "\n")
    _PROTOCOL_STDOUT.flush()


def choose_device(torch, requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    if requested == "mps":
        if platform.system() != "Darwin" or not torch.backends.mps.is_available():
            raise RuntimeError("PyTorch MPS was requested but is unavailable on this Mac.")
        return "mps"
    if platform.system() == "Darwin" and getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_runtime(args, torch, requested_device: str):
    from irodori_tts.inference_runtime import InferenceRuntime, RuntimeKey

    runtime = InferenceRuntime.from_key(RuntimeKey(
        checkpoint=args.model,
        model_device=requested_device,
        codec_repo=args.codec,
        model_precision="fp32",
        codec_device="cpu",
        codec_precision="fp32",
        codec_deterministic_encode=True,
        codec_deterministic_decode=True,
        compile_model=False,
        split_rare_tokens=True,
    ))
    return runtime


def release_runtime(runtime, torch) -> None:
    if runtime is not None:
        try:
            runtime.unload()
        except Exception:
            pass
    gc.collect()
    mps = getattr(torch, "mps", None)
    if mps is not None and hasattr(mps, "empty_cache"):
        try:
            mps.empty_cache()
        except Exception:
            pass


def parse_line(line: bytes) -> dict:
    if len(line) > MAX_INPUT_BYTES:
        raise ValueError("Sidecar request exceeded the size limit.")
    try:
        request = json.loads(line)
    except Exception as exc:
        raise ValueError("Sidecar request was not valid JSON.") from exc
    if not isinstance(request, dict):
        raise ValueError("Sidecar request must be a JSON object.")
    return request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--codec", required=True)
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()

    try:
        import soundfile as sf
        import torch
        from irodori_tts.inference_runtime import SamplingRequest
    except Exception as exc:
        emit({"type": "fatal", "error": f"Irodori Python dependencies could not be imported: {exc}"})
        return 2

    torch.set_num_threads(max(1, min(8, int(args.threads))))
    try:
        device = choose_device(torch, args.device)
    except Exception as exc:
        emit({"type": "fatal", "error": str(exc)})
        return 2

    emit({"type": "progress", "state": "loading", "message": f"Loading Irodori v4.1 on PyTorch {device.upper()}…"})
    started = time.perf_counter()
    try:
        runtime = load_runtime(args, torch, device)
    except Exception as exc:
        if device != "mps" or args.device == "mps":
            emit({"type": "fatal", "error": f"Could not load Irodori v4.1 on {device}: {exc}"})
            return 2
        emit({"type": "progress", "state": "fallback", "message": f"MPS initialization failed; retrying on CPU ({exc})."})
        device = "cpu"
        try:
            runtime = load_runtime(args, torch, device)
        except Exception as cpu_exc:
            emit({"type": "fatal", "error": f"Could not load Irodori on MPS or CPU: {cpu_exc}"})
            return 2

    load_seconds = time.perf_counter() - started
    backend = f"Irodori v4.1 · PyTorch {device.upper()}"
    emit({"type": "ready", "device": device, "backend": backend, "loadSeconds": load_seconds})

    try:
        while True:
            raw = sys.stdin.buffer.readline(MAX_INPUT_BYTES + 1)
            if not raw:
                break
            if len(raw) > MAX_INPUT_BYTES:
                while raw and not raw.endswith(b"\n"):
                    raw = sys.stdin.buffer.readline(MAX_INPUT_BYTES + 1)
                emit({"type": "error", "id": None, "error": "Sidecar request exceeded the size limit."})
                continue
            request = {}
            try:
                request = parse_line(raw)
                request_id = request.get("id")
                if request.get("type") == "shutdown":
                    emit({"type": "bye"})
                    break
                if request.get("type") != "synthesize":
                    raise ValueError("Unsupported Irodori sidecar request.")
                text = request.get("text")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("Enter Japanese text to synthesize.")
                if len(text) > MAX_TEXT_CHARS:
                    raise ValueError(f"Irodori text is limited to {MAX_TEXT_CHARS} characters per synthesis.")

                sampling = SamplingRequest(
                    text=text.strip(),
                    no_ref=True,
                    ref_normalize_db=None,
                    num_candidates=1,
                    decode_mode="sequential",
                    num_steps=40,
                    cfg_scale_text=3.0,
                    cfg_scale_caption=0.0,
                    cfg_scale_speaker=0.0,
                    seed=1234,
                    min_seconds=0.5,
                    max_seconds=30.0,
                    max_text_len=256,
                )
                emit({"type": "progress", "id": request_id, "state": "synthesizing", "message": f"Generating with Irodori on {device.upper()}…"})
                synthesis_started = time.perf_counter()
                try:
                    result = runtime.synthesize(sampling)
                except Exception as exc:
                    if device != "mps" or args.device == "mps":
                        raise
                    emit({"type": "progress", "id": request_id, "state": "fallback", "message": f"MPS synthesis failed; retrying this line on CPU ({exc})."})
                    release_runtime(runtime, torch)
                    runtime = load_runtime(args, torch, "cpu")
                    device = "cpu"
                    backend = "Irodori v4.1 · PyTorch CPU fallback"
                    synthesis_started = time.perf_counter()
                    result = runtime.synthesize(sampling)

                generation_seconds = time.perf_counter() - synthesis_started
                audio = result.audio.detach().to(device="cpu", dtype=torch.float32).squeeze().numpy()
                wav_io = io.BytesIO()
                sf.write(wav_io, audio, int(result.sample_rate), format="WAV", subtype="PCM_16")
                wav = wav_io.getvalue()
                if len(wav) < 44 or len(wav) > 10 * 1024 * 1024:
                    raise ValueError("Generated WAV was empty or exceeded the 10 MiB safety limit.")
                duration = len(audio) / float(result.sample_rate)
                if duration <= 0:
                    raise ValueError("Generated WAV has no audio frames.")
                emit({
                    "type": "result",
                    "id": request_id,
                    "wavBase64": base64.b64encode(wav).decode("ascii"),
                    "sampleRate": int(result.sample_rate),
                    "audioSeconds": duration,
                    "generationSeconds": generation_seconds,
                    "realTimeFactor": generation_seconds / duration,
                    "backend": backend,
                })
            except Exception as exc:
                emit({"type": "error", "id": request.get("id") if isinstance(request, dict) else None, "error": str(exc)[:2000]})
    finally:
        release_runtime(runtime, torch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
