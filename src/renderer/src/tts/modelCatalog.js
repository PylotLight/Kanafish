export const TTS_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: 'supertonic-3',
    name: 'Supertonic 3',
    status: 'runnable',
    statusLabel: 'Runnable in Kanafish',
    languages: 'Japanese + 30 languages',
    parameters: 'About 99M',
    weightsLicense: 'OpenRAIL-M',
    codeLicense: 'MIT',
    runtime: 'ONNX Runtime WebGPU; WebAssembly CPU fallback',
    evidence: 'CPU-tested here: 0.21–0.46× real-time factor across four Japanese samples; 1.23 s session load. Human listening and Mac GPU tests have not been done.',
    sourceUrl: 'https://huggingface.co/supertone-oss-archive/supertonic-3',
    codeUrl: 'https://github.com/supertone-oss-archive/supertonic',
    availableInApp: true
  }),
  Object.freeze({
    id: 'magpie-v2607',
    name: 'NVIDIA Magpie Multilingual v2607',
    status: 'runnable',
    statusLabel: 'Runnable with native runtime',
    languages: '12 languages, including Japanese',
    parameters: '364M · v2607',
    weightsLicense: 'NVIDIA Open Model License',
    codeLicense: 'Apache-2.0 runtime',
    runtime: 'NeMo-Speech.cpp 0.3.0+ with HTTP, TTS, Japanese frontend and local CPU or Metal backend',
    evidence: 'Japanese synthesis verified on the sandbox CPU; Kanafish downloads and caches the pinned local model stack. Optional native runtime is not bundled; Metal/MPS and human listening tests are pending.',
    sourceUrl: 'https://huggingface.co/nvidia/magpie_tts_multilingual_357m',
    codeUrl: 'https://github.com/NVIDIA/NeMo-Speech.cpp',
    availableInApp: true
  }),
  Object.freeze({
    id: 'irodori-v4.1-small',
    name: 'Irodori-TTS v4.1-Small',
    status: 'candidate',
    statusLabel: 'Worthwhile, Python-only route',
    languages: 'Japanese only',
    parameters: 'About 0.8B · FP32 checkpoint',
    weightsLicense: 'MIT',
    runtime: 'Official Python runtime supports CPU and MPS; no Kanafish backend yet',
    evidence: 'CPU-tested here, but slow: 3.11–6.02× real-time factor and 12.93 s model/codec load. Official MPS path is documented but has not been tested on the owner’s Mac.',
    sourceUrl: 'https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small',
    codeUrl: 'https://github.com/Aratako/Irodori-TTS',
    availableInApp: false
  }),
  Object.freeze({
    id: 'miotts-0.6b',
    name: 'MioTTS-0.6B',
    status: 'advanced',
    statusLabel: 'Advanced / end-to-end unverified',
    languages: 'Japanese + English',
    parameters: '0.6B LLM; separate codec required',
    weightsLicense: 'Apache-2.0 for 0.6B model',
    runtime: 'GGUF LLM server plus MioCodec and Python API service',
    evidence: 'Has a published GGUF route. The complete pipeline is not verified on CPU or Apple Metal; the vendor’s fast RTF claims are from an RTX 5090.',
    sourceUrl: 'https://huggingface.co/Aratako/MioTTS-0.6B',
    codeUrl: 'https://github.com/Aratako/MioTTS-Inference',
    availableInApp: false
  }),
  Object.freeze({
    id: 'qwen3-tts-0.6b-base',
    name: 'Qwen3-TTS 0.6B Base',
    status: 'benchmark-only',
    statusLabel: 'Benchmark-only for now',
    languages: '10 languages, including Japanese',
    parameters: 'About 915M parameters reported by the model host',
    weightsLicense: 'Apache-2.0',
    runtime: 'Python / Transformers; separate speech-tokenizer assets',
    evidence: 'Official examples are CUDA-focused; no supported CPU or Mac MPS path has been established. No backend in Kanafish.',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    codeUrl: 'https://github.com/QwenLM/Qwen3-TTS',
    availableInApp: false
  }),
  Object.freeze({
    id: 'chatterbox-multilingual-v3',
    name: 'Chatterbox Multilingual v3',
    status: 'archival',
    statusLabel: 'Archived / not shortlisted',
    languages: '23 languages, including Japanese',
    parameters: 'About 500M',
    weightsLicense: 'MIT',
    runtime: 'Downstream llama.cpp route; no Kanafish backend',
    evidence: 'The upstream project states it is retired and no longer maintained (August 2026). Kept here for context, not offered for testing.',
    sourceUrl: 'https://huggingface.co/ResembleAI/chatterbox',
    codeUrl: 'https://github.com/resemble-ai/chatterbox',
    availableInApp: false
  })
])

export const RUNNABLE_TTS_MODEL_IDS = Object.freeze(
  TTS_MODEL_CATALOG.filter((model) => model.availableInApp).map((model) => model.id)
)
