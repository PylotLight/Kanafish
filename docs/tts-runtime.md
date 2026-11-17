# Optional Magpie runtime for Kanafish

Kanafish can use NVIDIA Magpie Multilingual v2607 as a fully local Japanese TTS option when the separate NeMo-Speech.cpp native runtime is installed. Kanafish does not bundle that runtime or the model weights. The Japanese text frontend is optional in NeMo-Speech.cpp builds, so a normal prebuilt runtime may be present but still be unusable for Japanese.

## Build a Japanese-capable runtime

Use NeMo-Speech.cpp v0.3.0 or newer, with HTTP and Japanese TTS enabled. Kanafish also verifies that the runtime's model index resolves Magpie and NanoCodec to the revisions pinned below; an index that selects different revisions is rejected. Install the platform build prerequisites (Git, CMake, Ninja, and a C++ compiler), then clone the official source and enable both the HTTP server and Japanese frontend:

```sh
git clone --branch v0.3.0 --recurse-submodules https://github.com/NVIDIA/NeMo-Speech.cpp.git
cd NeMo-Speech.cpp
git submodule update --init llama.cpp third_party/open_jtalk third_party/cpp-httplib
```

For a CPU build:

```sh
scripts/configure.sh cpu-tts -DNEMO_SPEECH_BUILD_HTTP=ON -DNEMO_SPEECH_TTS_WITH_JA=ON
cmake --build --preset cpu-tts --parallel
```

For a Mac with Apple Metal, use the `metal-tts` preset and the same feature flags:

```sh
scripts/configure.sh metal-tts -DNEMO_SPEECH_BUILD_HTTP=ON -DNEMO_SPEECH_TTS_WITH_JA=ON
cmake --build --preset metal-tts --parallel
```

The exact CMake flags and dependencies are documented in the [official build guide](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md). Confirm that `nemo-speech doctor` reports `http`, `tts`, and `tts_japanese` in its Features list. If the Japanese feature is absent, Kanafish deliberately disables the Magpie download and synthesis controls rather than pretending Japanese is supported.

Kanafish looks for `nemo-speech` on `PATH` and in common user installation paths. If it is installed elsewhere, set `KANAFISH_NEMO_SPEECH_PATH` to the executable path in the environment used to launch Kanafish.

## Download and use

Choose **NVIDIA Magpie Multilingual v2607** in Voice Lab and request its download. Kanafish asks NeMo-Speech.cpp to pull the TTS model and its required tokenizer and NanoCodec into an app-specific local cache. The pinned model revision is `19806879b16d3f2ccf28fb112b1bcd16a3c7923e`; the codec revision is `fc00890b604aa2de298d2641ffc6c5f6caf8c4d7`. The measured model stack is 668,084,511 bytes (about 637 MiB). Model files are not stored in Git.

On first use, Kanafish starts a loopback-only HTTP service bound to `127.0.0.1`, with a temporary random access token. The service loads once and serves repeated synthesis requests; Kanafish stops it when the app exits. Available preset voices are Aria, Jason, John, Leo, and Sofia. No user reference audio is needed or recorded. Lesson playback uses the currently selected local backend.

## Sandbox results and limitations

The Japanese-enabled NeMo-Speech.cpp v0.3.0 build successfully synthesized the same four Japanese lines used for the other CPU tests on an x86_64 CPU. The local model service took about 2.12 seconds to become ready. Across the four lines, Magpie’s real-time factor was 1.42–1.56 (higher than 1.0 means generation took longer than the resulting audio). The model was downloaded and synthesized without reference audio. These measurements describe this sandbox CPU only; they do not prove how a Mac Metal build will perform.

The owner’s Mac was unavailable. NeMo’s Metal backend is a native C++ backend and is distinct from PyTorch MPS. Neither Metal nor MPS was tested. No human listening assessment has been performed; synthesis timing does not establish pronunciation accuracy, clarity, or naturalness.

## Licenses

The NeMo-Speech.cpp runtime source is Apache-2.0. Magpie v2607 model weights are licensed separately under the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) and are not included with Kanafish. Review that model license and the [Magpie model card](https://huggingface.co/nvidia/magpie_tts_multilingual_357m) for the intended deployment before distributing the model or generated outputs. The app’s runtime license does not replace or extend the weights license.
