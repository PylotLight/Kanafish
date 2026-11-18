# Optional local TTS runtimes

Only Supertonic 3 is currently exposed in Voice Lab. The other integrations documented below are retained in source but disabled and hidden after the live setup showed only Supertonic working; the earlier sandbox checks do not prove they work on the owner's device. The detailed setup notes below preserve that work for re-validation. Supertonic model weights stay outside Git and are downloaded only after a separate user action.

## In-app native runtime setup: Qwen and Magpie

When a compatible native runtime is missing, Voice Lab offers a build action. It explains the long build and 8 GiB free-space threshold and asks for confirmation before it downloads source or compiles anything. After consent, it shows progress, errors and a cancel action; a failed or cancelled build can be retried. It clones a pinned source commit and its submodules, builds in a temporary directory under Kanafish app data, runs a feature check, and only then installs the result under that app-data directory. It does not install system packages, download model weights, or replace system files.

Automatic setup is supported on x64/arm64 Linux and macOS when the prerequisites are detected. The app currently requires Git, CMake 3.26 or newer, Ninja, Bash, a C compiler, a C++17 compiler, and at least 8 GiB free on the Kanafish app-data volume. Apple Silicon Metal builds also require Xcode Command Line Tools. These are app preflight requirements and an 8 GiB safety threshold, not an upstream claim about exact build size. Windows and unsupported architectures/platforms receive manual guidance rather than an automatic source build.

The source-build logic and checks are covered by unit tests, but this sandbox had only about 2.3 GB free, so neither native build was attempted here. Passing the setup-manager tests does not prove a full C++ build on Linux or Mac.

## Qwen3-TTS 0.6B CustomVoice with codec.cpp

## Qwen3-TTS 0.6B CustomVoice with codec.cpp

Qwen uses the built-in Japanese Ono Anna voice (`ono_anna`) and does not need a reference recording. Kanafish requires a compatible `codec.cpp` `tts-server` before it offers the model download. It checks the server's advertised HTTP/WAV options and verifies the Japanese voice list when the model service starts.

Voice Lab can build `mybigday/codec.cpp` at pinned commit `d5e385229ea5a0f48fff696fed4699a852aa43b7`, including its source-pinned llama.cpp submodule. The app builds with Ninja and up to four jobs; on Apple Silicon it enables `GGML_METAL=ON`. This setup action is separate from the Qwen model download. For a manual build, or on Windows, follow the upstream [pinned codec.cpp source](https://github.com/mybigday/codec.cpp/tree/d5e385229ea5a0f48fff696fed4699a852aa43b7) and expose the resulting executable through `KANAFISH_CODEC_CPP_TTS_SERVER_PATH` or a standard executable directory:

```sh
git clone --recursive https://github.com/mybigday/codec.cpp.git
cd codec.cpp
git checkout d5e385229ea5a0f48fff696fed4699a852aa43b7
git submodule update --init --recursive
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --target tts-server --parallel 4
```

For Apple Silicon, add `-DGGML_METAL=ON` to the configure command. The app tries the native GPU backend on macOS and falls back to CPU if startup fails. That is intended behavior, not a Mac test result. `KANAFISH_CODEC_CPP_THREADS` can set the CPU thread count; the default is up to eight.

The source model is [`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice). Kanafish uses the preconverted Q8_0 pair from [`BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF`](https://huggingface.co/BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF), pinned to revision `22f3c6369919f6374f790a65c6fe3aed0ec5f86b`:

| File | Size | SHA-256 |
|---|---:|---|
| `qwen3-tts-0.6b-customvoice-q8_0.gguf` | 639,442,656 bytes | `a2a621131e578cce546be74efa741eb5fc68d73be90a24ebef8c9f3f1c4cb4a8` |
| `codec-q8_0.gguf` | 1,310,488,032 bytes | `959a179d9254c3da23ba4118129ac1f5c556fad8b2764841dd2cedba61ac8c72` |

The first model download is about 1.95 GB. Kanafish streams the files to its user-data cache, checks exact sizes and SHA-256 digests, and never adds weights to the repository. It starts a local-only service bound to `127.0.0.1` with a temporary access token; text and generated audio do not go to a remote service. The GGUF model weights are Apache-2.0; codec.cpp is MIT. Those licenses apply to separate components; review the source model card and GGUF repository provenance before redistributing weights or generated output.

The pinned codec.cpp `tts-server` and actual Qwen pair were tested on the sandbox CPU. The four Voice Lab lines previously benchmarked on eight threads had generation/audio times of 6.61/1.92 seconds (RTF 3.44), 23.59/4.96 seconds (4.76), 59.11/9.76 seconds (6.06), and 47.26/8.32 seconds (5.68). A Kanafish-adapter smoke test also verified the cached model pair and Japanese preset, then generated a valid 24 kHz mono WAV for `こんにちは。`: 6.93 seconds to generate 2.24 seconds of audio (RTF 3.09). The separate smoke-test timing is not a human quality score. The local service took about 11 seconds to become ready in the initial CPU measurement. There has been no human listening review or Mac/Metal test, and the new automatic source-build workflow has not completed a real build in this sandbox.

## NVIDIA Magpie Multilingual v2607 with NeMo-Speech.cpp

Kanafish can run Japanese Magpie only with NeMo-Speech.cpp v0.3.0+ reporting `http`, `tts`, and `tts_japanese` in `nemo-speech doctor`; the app also checks `model_pull` before enabling its separate model download. A stock prebuilt runtime may lack the Japanese frontend.

Voice Lab can build the pinned NeMo-Speech.cpp v0.3.0 source commit `20999cc921d2b14aa58708f61756a8b2e787ba20`, with HTTP and Japanese support, then health-check it before installation. On Apple Silicon it selects the native `metal-tts` preset; other supported builds use `cpu-tts`. This Metal C++ backend is distinct from PyTorch MPS. The source-build action never downloads Magpie weights. For a manual build, including Windows, use the upstream [NeMo-Speech.cpp v0.3.0 build guide](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md) and enable `NEMO_SPEECH_BUILD_HTTP=ON` and `NEMO_SPEECH_TTS_WITH_JA=ON`. If the executable is outside a standard search path, set `KANAFISH_NEMO_SPEECH_PATH`.

The v2607 model, tokenizer and NanoCodec stack are pinned to separate revisions and total 668,084,511 bytes (about 637 MiB). Kanafish downloads these files only when the learner asks and checks the model index against the pins. The five preset voices are Aria, Jason, John, Leo and Sofia. NeMo-Speech.cpp is Apache-2.0; Magpie weights use the separate NVIDIA Open Model License.

On the sandbox CPU, a Japanese-enabled NeMo-Speech.cpp runtime synthesized the same four lines at 1.42–1.56× real time, with about 2.12 seconds of service startup. No human listening review or Mac Metal/MPS test has been performed. The current automatic native build was not attempted here because available disk was below the app's 8 GiB threshold. See the [NeMo-Speech.cpp build guide](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md), [Magpie model card](https://huggingface.co/nvidia/magpie_tts_multilingual_357m), and [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).

## Irodori-TTS v4.1-Small: optional app-managed Python sidecar

Plain Irodori v4.1-Small remains an optional Japanese-only Python-sidecar route. In Voice Lab, **Set up Python runtime** creates a separate virtual environment under Kanafish user data; **Download Irodori** then caches the model, tokenizer and codec. Python 3.10–3.13 is used only as a bootstrap. This does not make Python a requirement for Kanafish, Supertonic, Magpie, Qwen, or the separate MF ONNX route. Voice Lab can clear its model cache or remove its isolated Python environment.

The checkpoint and tokenizer are pinned to Hugging Face revision `2b28324dc263ed5e6638b3cf3dd94c82ead07b4b`; the DACVAE Japanese codec is pinned to `47376ee24834d7a05a48ebabfe3cde29b3c5e214`. The four files total **3,500,634,824 bytes** (about 3.50 GB). Kanafish checks each file's exact size and SHA-256 before creating its cache manifest. The model, tokenizer and codec weights are downloaded only when requested and are not committed or bundled. The model checkpoint, inference code and DACVAE weights are MIT-licensed; vendored Python source is pinned to Aratako's commit `382205679ebc32295b7d1bfb329327d04c8f4eed`. See the [Irodori model card](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Japanese DACVAE card](https://huggingface.co/Aratako/Semantic-DACVAE-Japanese-32dim), and [pinned inference source](https://github.com/Aratako/Irodori-TTS/tree/382205679ebc32295b7d1bfb329327d04c8f4eed).

The sidecar requests PyTorch MPS on a Mac when available and falls back to CPU if MPS is unavailable or fails. The **integrated Kanafish Node-to-Python CPU test** generated `こんにちは。` and validated a RIFF/WAVE file at 48 kHz. Model load took 11.55 seconds; generation took 8.09 seconds for 1.48 seconds of audio (RTF 5.47). This reused the existing Python 3.12 CPU environment and hardlinked model files; it did not repeat a fresh dependency installation or the full 3.50 GB download. The separate four-line CPU benchmark measured 3.11–6.02× real time. This is slow on CPU; the Mac/MPS path and subjective listening quality have not been tested.

The upstream card advises against cloning or impersonating a person without consent and against misleading synthetic speech or deepfakes. This Voice Lab route uses no reference recording. Upstream SilentCipher watermarking is optional; Kanafish does not install that optional package, so generated audio is **not SilentCipher-watermarked** by this build.

## Non-Python alternative: Irodori v4.1-Small-MF ONNX

Voice Lab also offers **Irodori-TTS v4.1-Small-MF (int8 ONNX)** as a separate route from plain v4.1-Small above. MF is a four-step MeanFlow-distilled variant, not the same checkpoint or sampler as plain v4.1-Small. It uses JavaScript tokenization and ONNX Runtime Web's WebAssembly CPU backend, with no Python runtime or subprocess.

The model pack is pinned to Hugging Face revision `0701bc6758cbb364a9577d5799a90a45baa8ffa2`. Kanafish downloads and SHA-256 verifies nine assets totalling **1,693,722,741 bytes** (about 1.69 GB): the text encoder and MeanFlow step graph in int8, float32 duration/context-KV/speaker/decoder graphs, tokenizer JSON/config and model config. The encrypted `voice_decoder_a.bin` is not downloaded; it is app-specific and unnecessary because the general-purpose `dacvae_decode.onnx` is included. The model card describes MIT-licensed components but labels the overall pack `other`; check each component's terms separately. No weights are committed to Git.

The text path ports the Irodori normalizer and rare-token splitting behavior. It prepends BOS once, splits rare long tokens only for body text, and leaves the caption unsplit. Inference runs no-reference speaker conditioning, caption and duration conditioning, context-KV caching, four MeanFlow steps, the general decoder and latent-tail trimming. Kanafish converts output to mono 48 kHz PCM16 WAV.

**End-to-end JavaScript/ONNX test:** Kanafish's main-process runtime verified all nine pinned assets and generated a valid, non-silent RIFF/WAVE from `こんにちは。`: 115,244 bytes, mono 48 kHz PCM16, 1.20 seconds, peak 23,008. The first run took 12.78 seconds (RTF 10.65), including ONNX model loading, on this sandbox CPU. This proves the complete no-Python pipeline generated audio; it is not a human listening or naturalness assessment. This WASM CPU path is slow in the sandbox. Mac/WebGPU and human-listening tests have not been performed. The output is synthetic and is not SilentCipher-watermarked.

The earlier bounded ONNX probe only ran the duration graph; that result was superseded by the complete Node/WASM smoke test above. The JavaScript/WebGPU reference project [irodori-tts-webgpu](https://github.com/ngc-shj/irodori-tts-webgpu) targets v3 and is not compatible with v4.1. The full v4.1-MF pipeline was ported from the MIT-licensed [Muse Irodori voice reference runner](https://github.com/kgmkm/muse-irodori-voice); its license is preserved in `src/main/tts/vendor/muse-irodori-voice-LICENSE.txt`. Tokenizer logic is based on the pinned upstream Irodori source, and the tokenizer dependency's Apache-2.0 license is also preserved under `src/main/tts/vendor/`.

## MioTTS-0.6B with the app-managed CrispASR runtime

Voice Lab now offers the exact **MioTTS-0.6B** checkpoint through [CrispASR's native `miotts` C++ backend](https://github.com/CrispStrobe/CrispASR/blob/main/docs/tts.md). This uses the `cstr/miotts-0.6b-GGUF` pack at Hugging Face revision `fab3cdbef802fb5f1047708c27378c6e34ec230f`, with its Q4_K MioTTS-0.6B model, MioCodec-v2, tokenizer, and Japanese preset embeddings. It is not the separate 0.1B checkpoint used in the `mmnga/mio-tts-cpp` quickstart.

On Linux x86_64 and macOS Intel/Apple Silicon, Voice Lab downloads the pinned CrispASR v0.8.54 prebuilt archive into Kanafish app data, verifies its SHA-256 before extraction, then checks the exact version and that its backend advertises MioTTS TTS support. Windows has no pinned runtime. No Python, compiler, source build, or 8 GiB build preflight is required. The runtime archive pins are:

| Platform | Archive size | SHA-256 |
|---|---:|---|
| Linux x86_64 | 44,185,817 bytes | `a5612bca2dbb096b81972f573ec024a5944d3a63fc18ccd2d9a8489758ddb6f1` |
| macOS Apple Silicon | 18,679,584 bytes | `7b04a0ad344293f360636985e26a02efb8ef7f84fa2def991eaa3f4237f105dc` |
| macOS Intel | 19,275,032 bytes | `b1f263696566de64f1a8d36ae4014acf8dcb2c6376431d0cb30a011d7bd7c5c6` |

The four model files total **540,000,888 bytes** (about 540 MB):

| File | Size | SHA-256 |
|---|---:|---|
| `miotts-0.6b-q4_k.gguf` | 526,181,408 bytes | `65e3d4692d377e2483339f52da4ead8afdf6374749bc5cf5ba4b8a8b283d340d` |
| `tokenizer.json` | 13,817,944 bytes | `abcde038b87ccd029a4523b0c5cec1da6d84b4f3d68b351495df086d63033f1f` |
| `jp_female.emb.gguf` | 768 bytes | `1a99490f54aedefc98010ae53101f1cd49fd73a2cfc043e2009e3e2795a1ffdb` |
| `jp_male.emb.gguf` | 768 bytes | `6365e075530afba927e0158c7b834cef987e1a9757b2a5df5080f5022ca68ea6` |

Kanafish downloads weights only after the learner requests them and keeps both weights and runtime binaries outside Git, under app data; Voice Lab can clear the model cache or remove the runtime. The model weights are Apache-2.0, MioCodec-v2 weights are MIT, and CrispASR is MIT. These are separate terms; see the [MioTTS-0.6B model card](https://huggingface.co/cstr/miotts-0.6b-GGUF) and [CrispASR source](https://github.com/CrispStrobe/CrispASR). The upstream [MioTTS preset notes](https://github.com/Aratako/MioTTS-Inference) say its default Japanese presets were generated with T5Gemma-TTS and Gemini and that audio generated with those presets cannot be used commercially. Kanafish's included Japanese female and male presets are those defaults, so the output restriction applies to audio made with them, separately from the model and codec licenses. The app uses synthetic speaker identity; it does not add a watermark.

**Integrated no-Python smoke test:** the Kanafish adapter installed the runtime into a temporary app-data directory, downloaded and checksum-verified all four pinned files, then called `createMioRuntime.synthesize()` with `こんにちは。`. It returned a valid, non-silent 54,802-byte mono 44.1 kHz PCM16 WAV, 0.60 seconds long, with a peak sample of 18,859. The latest repeat took 2.81 seconds (RTF 4.68, including the new native process and model loading) on Linux CPU; an earlier run took 2.91 seconds (RTF 4.84). The temporary runtime and model cache were removed after each test. This proves the app-managed adapter works on Linux CPU, not that the Mac builds have been tested or that the voice sounds natural: no Mac testing or human listening review has been done.

## What the owner should verify on Mac

Mac/Metal checks are still outstanding. On the owner's Mac, first check Git, CMake 3.26+, Ninja, Bash, a C++17 toolchain and (on Apple Silicon) Xcode Command Line Tools, and ensure at least 8 GiB is free on the Kanafish app-data volume. Then use the Voice Lab build actions to confirm codec.cpp and NeMo-Speech.cpp builds complete and pass their feature checks. Test Japanese synthesis from both runtimes, confirm Qwen's Metal startup and CPU fallback behavior, and listen to the outputs for pronunciation, naturalness and glitches. Separately check plain Irodori's PyTorch MPS path, Irodori MF performance on Mac (the verified sandbox run used WASM CPU), and Supertonic WebGPU/fallback diagnostics. None of those Mac behaviors or subjective quality checks has been verified in this environment.

For model/runtime license distinctions, see [third-party notices](../THIRD-PARTY-NOTICES.md).
