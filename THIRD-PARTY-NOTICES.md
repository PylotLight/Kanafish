# Third-party notices

Kanafish adapts the Supertonic browser helper in `src/renderer/src/tts/supertonic-web-helper.js` from [Supertone's archived Supertonic repository](https://github.com/supertone-oss-archive/supertonic), Copyright (c) 2025 Supertone Inc. The helper code is used under the MIT License below.

Supertonic 3 model weights are not included in Kanafish. They are downloaded only when the learner requests them, from the pinned public Hugging Face revision documented in the app. The weights are licensed separately under OpenRAIL-M; review the [model card and license](https://huggingface.co/supertone-oss-archive/supertonic-3) before use. The Supertonic project is archived.

The optional Magpie adapter invokes a separately installed [NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) executable; Kanafish does not bundle or copy its source or binary. NeMo-Speech.cpp is licensed under Apache-2.0. Magpie v2607 model weights are not included in Kanafish; they are downloaded only at the learner's request and are governed separately by the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) and the [model card](https://huggingface.co/nvidia/magpie_tts_multilingual_357m). Review the model license for the intended use before distributing weights or generated outputs.

## MIT License

Copyright (c) 2025 Supertone Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
