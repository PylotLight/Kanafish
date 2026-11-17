# Optional native TTS runtimes

Kanafish can use NVIDIA Magpie Multilingual v2607 or Qwen3-TTS 0.6B CustomVoice through optional native runtimes. The app does not bundle the native executables or model weights. It downloads model assets only when requested and keeps them in the app-specific cache, outside Git.

## Qwen3-TTS 0.6B CustomVoice with codec.cpp

Qwen uses the built-in Japanese Ono Anna voice (`ono_anna`); it does not need a reference recording. The app requires a compatible `codec.cpp` `tts-server` before it offers the model download. It checks the server’s advertised HTTP/WAV options, then verifies the Japanese voice list when starting the model service.

### Build the optional server

The tested source is `mybigday/codec.cpp` commit `d5e385229ea5a0f48fff696fed4699a852aa43b7`, with its pinned llama.cpp submodule. Build tools (CMake, Git, and a C++ compiler) are required; Python is not required by Kanafish at runtime.

For a CPU build:

```sh
git clone --recursive https://github.com/mybigday/codec.cpp.git
cd codec.cpp
git checkout d5e385229ea5a0f48fff696fed4699a852aa43b7
git submodule update --init --recursive
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target tts-server --parallel
```

For Apple Silicon/macOS, add Metal at configure time:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON
cmake --build build --target tts-server --parallel
```

Point Kanafish at the resulting executable if it is not found in a standard location:

```sh
KANAFISH_CODEC_CPP_TTS_SERVER_PATH=/absolute/path/to/codec.cpp/build/tts-server
```

The app tries the GPU backend on macOS and falls back to CPU if startup fails. This CPU sandbox cannot verify Apple Metal; the UI labels that route as requested, not as Mac-tested. For slower CPUs, `KANAFISH_CODEC_CPP_THREADS` can set the thread count; the default is up to eight threads.

### Model download and local service

The source model is [`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice). Kanafish uses the preconverted Q8_0 pair from [`BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF`](https://huggingface.co/BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF), pinned to revision `22f3c6369919f6374f790a65c6fe3aed0ec5f86b`:

| File | Size | SHA-256 |
|---|---:|---|
| `qwen3-tts-0.6b-customvoice-q8_0.gguf` | 639,442,656 bytes | `a2a621131e578cce546be74efa741eb5fc68d73be90a24ebef8c9f3f1c4cb4a8` |
| `codec-q8_0.gguf` | 1,310,488,032 bytes | `959a179d9254c3da23ba4118129ac1f5c556fad8b2764841dd2cedba61ac8c72` |

The first download is about 1.95 GB. Kanafish streams the files to its user-data cache, checks their exact sizes and SHA-256 digests, and does not add weights to the repository. It starts a local-only service bound to `127.0.0.1` with a temporary access token; text and generated audio do not go to a remote service.

The GGUF model weights are Apache-2.0; codec.cpp is MIT. Those licenses apply to separate components. Check the source model card and the third-party GGUF repository’s provenance before redistributing model files or generated output.

### CPU test results and limits

The pinned codec.cpp `tts-server` and actual Qwen pair were tested on the sandbox CPU. The four Voice Lab lines previously benchmarked on eight threads had generation/audio times of 6.61/1.92 seconds (RTF 3.44), 23.59/4.96 seconds (4.76), 59.11/9.76 seconds (6.06), and 47.26/8.32 seconds (5.68). A later Kanafish-adapter smoke test discovered the server, verified the cached model pair and Japanese preset, then generated a valid 24 kHz mono WAV for `こんにちは。`: 6.93 seconds to generate 2.24 seconds of audio (RTF 3.09). The separate smoke-test timing is not a human quality score.

The local service took about 11 seconds to become ready in the initial CPU measurement. These results mean Qwen is slow on this sandbox CPU. There has been no human listening review and no Mac/Metal test.

## NVIDIA Magpie Multilingual v2607 with NeMo-Speech.cpp

Kanafish can run Japanese Magpie only with an optional NeMo-Speech.cpp v0.3.0+ build that reports `http`, `tts`, and `tts_japanese` in `nemo-speech doctor`. A stock prebuilt runtime may lack the Japanese frontend. The NeMo-Speech.cpp runtime is not bundled.

For a CPU build, clone the official source and enable HTTP and Japanese support:

```sh
git clone --branch v0.3.0 --recurse-submodules https://github.com/NVIDIA/NeMo-Speech.cpp.git
cd NeMo-Speech.cpp
git submodule update --init llama.cpp third_party/open_jtalk third_party/cpp-httplib
scripts/configure.sh cpu-tts -DNEMO_SPEECH_BUILD_HTTP=ON -DNEMO_SPEECH_TTS_WITH_JA=ON
cmake --build --preset cpu-tts --parallel
```

For a Mac build, replace `cpu-tts` with `metal-tts` in the last two commands. Metal is a native C++ backend and is distinct from PyTorch MPS; neither has been tested on the owner’s Mac. If the executable is outside a standard path, set `KANAFISH_NEMO_SPEECH_PATH` in the environment used to launch Kanafish.

The v2607 model, tokenizer and NanoCodec stack are pinned to separate revisions and total 668,084,511 bytes (about 637 MiB). Kanafish checks the model index against those pins and downloads files only after the user requests it. The model provides five preset voices: Aria, Jason, John, Leo, and Sofia. The NeMo-Speech.cpp runtime source is Apache-2.0; the Magpie weights use the separate NVIDIA Open Model License.

On the sandbox CPU, the Japanese-enabled runtime synthesized the same four lines at 1.42–1.56× real time, with about 2.12 seconds for service startup. No human listening review or Mac Metal/MPS test has been performed. See the [NeMo-Speech.cpp build guide](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md), [Magpie model card](https://huggingface.co/nvidia/magpie_tts_multilingual_357m), and [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).

## Irodori-TTS v4.1: JavaScript/ONNX investigation

Irodori remains out of the runnable catalog because a complete app path has not generated audio. The available [JavaScript/WebGPU project](https://github.com/ngc-shj/irodori-tts-webgpu) targets Irodori v3 and its graph/tokenizer contract; it is not interchangeable with v4.1.

A bounded test used the MF ONNX export [`Ryoppi/Irodori-TTS-v4.1-Small-MF-ONNX-int8`](https://huggingface.co/Ryoppi/Irodori-TTS-v4.1-Small-MF-ONNX-int8), pinned to revision `0701bc6758cbb364a9577d5799a90a45baa8ffa2`. This is the v4.1-Small-MF MeanFlow variant, not the plain v4.1-Small checkpoint. With the app’s existing `onnxruntime-web` package in Node’s WASM backend, the test loaded the 87 MB `duration.onnx` graph and executed it with synthetic zero conditioning; it returned `log_frames`. This proves that the package can execute that component, not that it can synthesize Japanese speech. No browser or WebGPU device was available.

The full MF pack is about 1.90 GB. It includes the ModernBERT tokenizer, text and speaker encoders, duration predictor, context-KV graph, MeanFlow `dit_step` graph, and the general-purpose `dacvae_decode.onnx` audio decoder. The separate, much faster `voice_decoder_a.bin` is an optional distilled replacement for that ONNX decoder and is encrypted for the UltraAlarm app; it is not required when using `dacvae_decode.onnx`. The pack README documents Android measurements but does not publish a JavaScript runner for the tokenizer, shared conditioning, context-KV handling and MeanFlow sampling. Implementing and validating that full pipeline is the blocker. The plain v4.1-Small ONNX export is separate and its large graphs exceed the sandbox’s remaining disk space.

The upstream Python/PyTorch v4.1-Small route has already generated speech in a separate benchmark, at 3.11–6.02× real time with about 12.93 seconds for model/codec load. It is a possible optional sidecar, not integrated into Kanafish. The owner can decide whether to pursue that route; it needs a separate Python environment and a large model/codec cache. No Irodori model weights are bundled or downloaded by Kanafish.

Sources: [v4.1-Small model card](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [MF ONNX pack README and manifest](https://huggingface.co/Ryoppi/Irodori-TTS-v4.1-Small-MF-ONNX-int8), and [upstream Python inference instructions](https://github.com/Aratako/Irodori-TTS).
