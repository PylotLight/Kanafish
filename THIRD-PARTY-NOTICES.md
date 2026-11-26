# Third-party notices

Kanafish adapts the Supertonic browser helper in `src/renderer/src/tts/supertonic-web-helper.js` from [Supertone's archived Supertonic repository](https://github.com/supertone-oss-archive/supertonic), Copyright (c) 2025 Supertone Inc. The helper code is used under the MIT License below. Supertonic 3 model weights are not included; they are downloaded only when requested from the pinned public Hugging Face revision documented in the app. The weights are licensed separately under OpenRAIL-M; review the [model card and license](https://huggingface.co/supertone-oss-archive/supertonic-3) before use. The Supertonic project is archived.

The optional Magpie adapter invokes [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp). Kanafish does not bundle its source or a prebuilt runtime: after explicit user consent, the app fetches pinned source and builds a runtime under Kanafish app data. The runtime source is Apache-2.0. Magpie v2607 model weights are not included in Kanafish; they are downloaded only at the learner's request and are governed separately by the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) and the [model card](https://huggingface.co/nvidia/magpie_tts_multilingual_357m). Review the model license for intended use before distributing weights or generated outputs.

The optional Qwen adapter invokes [codec.cpp](https://github.com/mybigday/codec.cpp). Kanafish does not bundle its source or a prebuilt runtime: after explicit user consent, the app fetches the pinned source/submodules and builds the runtime under Kanafish app data. codec.cpp is MIT-licensed. Qwen model weights are downloaded separately only on request; the GGUF weights use Apache-2.0. Their licenses apply to separate components.

Kanafish includes the optional Irodori inference Python source from [Aratako/Irodori-TTS](https://github.com/Aratako/Irodori-TTS/tree/382205679ebc32295b7d1bfb329327d04c8f4eed) at commit `382205679ebc32295b7d1bfb329327d04c8f4eed`, under MIT; its license notice is preserved in `src/main/tts/vendor/irodori-LICENSE.txt`. The Irodori v4.1-Small checkpoint and Japanese DACVAE codec weights are not included in the repository or app bundle. They are downloaded only on request from pinned Hugging Face revisions and are licensed separately under MIT by their respective [model cards](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small) and [codec card](https://huggingface.co/Aratako/Semantic-DACVAE-Japanese-32dim).

The non-Python Irodori v4.1-Small-MF ONNX pipeline adapts the MIT-licensed [Muse Irodori voice reference runner](https://github.com/kgmkm/muse-irodori-voice), Copyright (c) 2026 kgmkm. Its full license is preserved in `src/main/tts/vendor/muse-irodori-voice-LICENSE.txt`. The JavaScript tokenizer dependency [`@huggingface/tokenizers`](https://www.npmjs.com/package/@huggingface/tokenizers) is licensed under Apache-2.0; its full license text is preserved in `src/main/tts/vendor/huggingface-tokenizers-LICENSE.txt`. The tokenizer also implements behavior based on the MIT-licensed Aratako Irodori source noted above. Irodori MF model components are downloaded from the pinned model pack only on request; its card labels the overall pack `other` while describing MIT-licensed components, so review the individual component terms before redistribution.

The optional MioTTS-0.6B route downloads the prebuilt [CrispASR v0.8.54](https://github.com/CrispStrobe/CrispASR) native runtime only when the learner requests setup. CrispASR is MIT-licensed; its archive and bundled third-party notices are retained in the app-managed runtime directory. Kanafish does not commit the runtime binaries or MioTTS model weights. The pinned MioTTS-0.6B GGUF model weights are Apache-2.0 and the MioCodec-v2 weights are MIT, as described in the [model card](https://huggingface.co/cstr/miotts-0.6b-GGUF). Kanafish also downloads the upstream Japanese female and male presets; [MioTTS preset notes](https://github.com/Aratako/MioTTS-Inference) state that audio made with these default Japanese presets cannot be used commercially. This output restriction is specific to use of those presets and is separate from the model and codec licenses.

Optional on-device speech recognition downloads the prebuilt [speech.cpp v0.11.0](https://github.com/nyosegawa/speech.cpp/releases/tag/v0.11.0) `speech` executable only when the learner requests setup. speech.cpp is MIT-licensed, Copyright (c) 2026 Sakasegawa (see its [LICENSE](https://github.com/nyosegawa/speech.cpp/blob/v0.11.0/LICENSE)), and links the MIT-licensed ggml. Kanafish verifies the release archive's SHA-256, extracts only the executable into Kanafish app data, and does not commit or bundle it. The [Haas-ja-v1.0](https://huggingface.co/third-intelligence/Haas-ja-v1.0) speech recognition model by Third Intelligence is licensed under Apache-2.0; Kanafish downloads the pinned Q8_0 GGUF conversion from [sakasegawa/Haas-ja-v1.0-GGUF](https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF) (also Apache-2.0) only on request and does not redistribute it.

## Irodori MIT License

Copyright (c) 2026 Aratako

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## MIT License

Copyright (c) 2025 Supertone Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## FSRS scheduler dependencies

Kanafish uses [`ts-fsrs` 6.0.1](https://github.com/open-spaced-repetition/ts-fsrs), Copyright (c) 2026 Open Spaced Repetition, under MIT. It depends on [`@open-spaced-repetition/srs-kit` 1.0.1](https://github.com/open-spaced-repetition/ts-fsrs/tree/main/packages/srs-kit), Copyright (c) 2026 Open Spaced Repetition contributors, under BSD 3-Clause.

### ts-fsrs MIT License

Copyright (c) 2026 Open Spaced Repetition

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### @open-spaced-repetition/srs-kit BSD 3-Clause License

Copyright (c) 2026, Open Spaced Repetition contributors

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
