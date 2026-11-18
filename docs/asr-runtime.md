# On-device speech recognition (Haas-ja-v1.0 with speech.cpp)

Voice Lab has a **Speech recognition** card. It records the microphone, converts the clip to 16 kHz mono 16-bit PCM WAV in the renderer, and recognizes it in a local [speech.cpp](https://github.com/nyosegawa/speech.cpp) worker running [Haas-ja-v1.0](https://huggingface.co/third-intelligence/Haas-ja-v1.0), a 616M-parameter Japanese FastConformer recognizer that writes punctuation. Audio and text stay on the device. No Python, compiler or system package is needed, and nothing is downloaded until the learner asks.

## Why speech.cpp

Haas-ja-v1.0 is published as a NeMo checkpoint. The official NeMo package needs Linux and CUDA, and `haas-mlx` needs Python and MLX. speech.cpp is a single prebuilt `speech` executable (MIT) with the library and ggml linked in, released for macOS Apple Silicon (Metal), Linux x64 and Windows x64, and it ships a GGUF port of Haas that matched NeMo's text on its upstream checks. Its `speech worker` mode keeps one model loaded and speaks JSON Lines over stdin/stdout ([docs/worker.md](https://github.com/nyosegawa/speech.cpp/blob/main/docs/worker.md)), which fits Kanafish's existing app-managed native runtime pattern.

## Runtime install

**Install speech.cpp runtime** downloads the pinned release archive for this platform, verifies its size and SHA-256 against the release's `SHA256SUMS`, reads only the `speech` (or `speech.exe`) entry out of the ZIP with a built-in reader (no `unzip`/`tar` needed), checks its ZIP CRC, writes it to a staging folder, runs `speech --version`, and only if that reports exactly `speech.cpp 0.11.0` moves it into place. It never runs the upstream `install.sh`/`install.ps1`, never touches `PATH` or shell startup files, and sets `SPEECH_NO_UPDATE_CHECK=1` for every command. The archive download resumes after an interruption and can be cancelled.

Runtime: `<userData>/native-runtimes/speech.cpp/v0.11.0/speech`

| Platform | Release archive | Size | SHA-256 |
|---|---|---:|---|
| macOS Apple Silicon (Metal) | `speech-0.11.0-macos-arm64-metal.zip` | 6,281,470 bytes | `3ffe12c4398fa9265abdbf673e2e1ee32b04f52cde151d5388833ac3296c69c0` |
| Linux x86-64 (CPU) | `speech-0.11.0-linux-x64-cpu.zip` | 6,487,592 bytes | `9acb8becee605c7bb190d7f56d4d9212232ec311df63735b1938cc86bc4257a1` |
| Windows x64 (Vulkan) | `speech-0.11.0-windows-x64-vulkan.zip` | 29,718,214 bytes | `b64f498179fc46d08149317eaea9fe6f24e6fa0cd194557b374c97e76ccc9c67` |

Release: [`v0.11.0`](https://github.com/nyosegawa/speech.cpp/releases/tag/v0.11.0). Linux uses the CPU build, which needs AVX2/FMA/F16C and glibc 2.34+; the Vulkan build is not offered. The Windows build needs the GPU driver's `vulkan-1.dll`. Intel Macs and Linux arm64 have no upstream binary, so the card says the platform is unsupported.

## Model download

**Download Haas-ja-v1.0** fetches one file with the same resumable, SHA-256-verified downloader the TTS models use (`downloadVerifiedFile` in `src/main/tts/modelStore.js`). A cancelled download keeps its `.part` file and the next download resumes with an HTTP Range request. The app checks free space first (file + 64 MiB).

| Repo | Revision | File | Size | SHA-256 |
|---|---|---|---:|---|
| [`sakasegawa/Haas-ja-v1.0-GGUF`](https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF) | `6b965d5007ba780585de51549d57a8c1c0d67c7e` | `Haas-616M-ja-v1.0-Q8_0.gguf` | 656,381,472 bytes | `cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb` |

The GGUF was converted from [`third-intelligence/Haas-ja-v1.0`](https://huggingface.co/third-intelligence/Haas-ja-v1.0) at revision `660728d39019e5e065046154beca44ac9a66a540`. Model: `<userData>/asr-models/haas-ja-v1.0/<revision>/Haas-616M-ja-v1.0-Q8_0.gguf`. speech.cpp is given this absolute `.gguf` path, so it never fetches a model on its own or writes to its own cache folder.

Upstream reports a CER of 4.39% for Haas Q8_0 on FLEURS' Japanese test split (2.86% accepting other spellings), against 5.00% for parakeet-tdt_ctc-0.6b-ja, and 205× real time on an Apple M5 ([fastconformer.md](https://github.com/nyosegawa/speech.cpp/blob/main/docs/models/fastconformer.md)). Those are upstream numbers, not Kanafish measurements.

## Recognition

The main process starts `speech worker <model.gguf>` on the first recording, waits for its `ready` line (checking protocol 4 and version 0.11.0), and keeps it loaded. Each recording is sent as `chunk` lines (base64 PCM16) followed by one `transcribe` line with `sample_rate` and `timestamps: true`; the `end` line gives the text, segments and token times. Requests run one at a time, time out after 120 s, and a worker that exits or writes a non-JSON line fails the request with the tail of its stderr. The worker stops after five idle minutes, when its runtime or model is removed, and when Kanafish quits (closing stdin first, then SIGTERM/SIGKILL).

The main process re-validates every clip: RIFF/WAVE, mono 16-bit PCM, 8–48 kHz, 0.2–60 s, not silent. FastConformer recognizes a request whole and can drop sentences from long multi-sentence stretches, so clips are capped at 60 s and meant to be one utterance or a few sentences.

## Voice Lab card

- Setup state for the runtime and model, with progress, cancel, resume, **Clear Haas model cache** and **Remove speech.cpp runtime**.
- **Free speech**: click to start, click to stop (or 60 s). Discard drops a recording; **Cancel recognition** stops an in-flight worker request. Shows the transcript, audio length, recognition time and either the first-run model load time or the speed in multiples of real time.
- **Speak this line**: pick one of the four Voice Lab sample lines, say it, and see a character-level similarity score. The score folds katakana to hiragana, normalizes width and drops punctuation and whitespace. It is not a pronunciation grade, and a kanji vs kana spelling of the same word counts as different.

Recording uses `getUserMedia` + `MediaRecorder`, then `decodeAudioData` and an `OfflineAudioContext` at 16 kHz (with a pure-JS fallback resampler). The main process allows audio-only `media` requests from the exact packaged renderer page or the configured Electron dev-server origin, only in the main frame; every other permission type and page is denied. On macOS the renderer first asks the main process to call `systemPreferences.askForMediaAccess('microphone')`.

## Packaging note

This repo has no electron-builder or Forge config yet. When one is added, the macOS build needs `NSMicrophoneUsageDescription` in its Info.plist (electron-builder: `mac.extendInfo`), and a hardened-runtime build needs the `com.apple.security.device.audio-input` entitlement; without them macOS refuses or silently mutes the microphone. In `bun run dev` the microphone prompt comes from the Electron.app bundle.

## What has been tested

- Unit tests (`tests/asr-pure.test.js`, `tests/asr-runtime.test.js`) cover the pins, the ZIP reader, version checks, the install, the resumable model download and cancel, readiness gating, WAV encoding/parsing, the worker protocol with a fake worker, and similarity scoring.
- No Mac, Windows, Electron or microphone test has been done. See the PR for whether a real speech.cpp transcription ran in the development sandbox.

## Later: speech.cpp for TTS

speech.cpp also runs Irodori-TTS MF (`irodori-tts-mf`) on Metal and Qwen3-TTS from the same `speech` binary and worker protocol (`synthesize` requests stream PCM chunks). Once this runtime is installed, it could replace the slow ONNX Runtime WASM Irodori MF route and the codec.cpp source build for Qwen, reusing the runtime install from this card. That is not implemented here.
