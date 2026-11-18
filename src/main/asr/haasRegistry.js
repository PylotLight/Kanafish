// Pinned speech.cpp runtime release and Haas-ja-v1.0 GGUF model for on-device Japanese speech recognition.
// Every value here was read from the upstream release's SHA256SUMS and the Hugging Face tree API; nothing floats.

export const SPEECH_CPP_RELEASE = Object.freeze({
  id: 'speech.cpp',
  name: 'speech.cpp',
  repo: 'nyosegawa/speech.cpp',
  version: '0.11.0',
  tag: 'v0.11.0',
  license: 'MIT',
  // `speech worker` JSON Lines protocol major version this adapter speaks (docs/worker.md).
  workerProtocol: 4,
  assets: Object.freeze({
    'darwin-arm64': Object.freeze({
      platform: 'macos-arm64-metal',
      name: 'speech-0.11.0-macos-arm64-metal.zip',
      size: 6_281_470,
      sha256: '3ffe12c4398fa9265abdbf673e2e1ee32b04f52cde151d5388833ac3296c69c0',
      executable: 'speech',
      backend: 'Metal'
    }),
    'linux-x64': Object.freeze({
      platform: 'linux-x64-cpu',
      name: 'speech-0.11.0-linux-x64-cpu.zip',
      size: 6_487_592,
      sha256: '9acb8becee605c7bb190d7f56d4d9212232ec311df63735b1938cc86bc4257a1',
      executable: 'speech',
      backend: 'CPU'
    }),
    'win32-x64': Object.freeze({
      platform: 'windows-x64-vulkan',
      name: 'speech-0.11.0-windows-x64-vulkan.zip',
      size: 29_718_214,
      sha256: 'b64f498179fc46d08149317eaea9fe6f24e6fa0cd194557b374c97e76ccc9c67',
      executable: 'speech.exe',
      backend: 'Vulkan (needs the GPU driver’s vulkan-1.dll)'
    })
  })
})

export const HAAS_ASR_MODEL = Object.freeze({
  id: 'haas-ja-v1.0',
  name: 'Haas-ja-v1.0',
  upstreamRepo: 'third-intelligence/Haas-ja-v1.0',
  upstreamRevision: '660728d39019e5e065046154beca44ac9a66a540',
  repo: 'sakasegawa/Haas-ja-v1.0-GGUF',
  revision: '6b965d5007ba780585de51549d57a8c1c0d67c7e',
  license: 'Apache-2.0',
  language: 'ja',
  sampleRate: 16_000,
  file: Object.freeze({
    path: 'Haas-616M-ja-v1.0-Q8_0.gguf',
    size: 656_381_472,
    sha256: 'cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb'
  })
})

export function getSpeechCppAsset(platform = process.platform, arch = process.arch, release = SPEECH_CPP_RELEASE) {
  return release.assets[`${platform}-${arch}`] || null
}

export function getSpeechCppAssetUrl(asset, release = SPEECH_CPP_RELEASE) {
  if (!asset || !/^[a-z0-9][a-z0-9._-]*\.zip$/i.test(asset.name)) throw new Error('Unknown speech.cpp release asset.')
  return `https://github.com/${release.repo}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(asset.name)}`
}

export function getHaasModelUrl(model = HAAS_ASR_MODEL) {
  if (!/^[0-9a-f]{40}$/.test(model.revision)) throw new Error('The Haas model must be pinned to a commit revision.')
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${encodeURIComponent(model.file.path)}`
}
