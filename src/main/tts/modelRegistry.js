import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const SUPERFILES = [
  { path: 'onnx/tts.json', size: 8_253, sha256: '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09' },
  { path: 'onnx/unicode_indexer.json', size: 277_676, sha256: '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f' },
  { path: 'onnx/duration_predictor.onnx', size: 3_700_147, sha256: 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db' },
  { path: 'onnx/text_encoder.onnx', size: 36_416_150, sha256: 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff' },
  { path: 'onnx/vector_estimator.onnx', size: 256_534_781, sha256: '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c' },
  { path: 'onnx/vocoder.onnx', size: 101_424_195, sha256: '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba' },
  { path: 'voice_styles/M1.json', size: 291_748, sha256: 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b' }
].map((file) => Object.freeze(file))

export const TTS_MODEL_REGISTRY = Object.freeze({
  'supertonic-3': Object.freeze({
    id: 'supertonic-3',
    name: 'Supertonic 3',
    locale: 'Japanese and 30 other languages',
    repoId: 'supertone-oss-archive/supertonic-3',
    revision: 'aafc6e32416a594460b32413efc49d7fe4ce6d46',
    modelCardUrl: 'https://huggingface.co/supertone-oss-archive/supertonic-3',
    codeUrl: 'https://github.com/supertone-oss-archive/supertonic',
    weightsLicense: 'OpenRAIL-M',
    codeLicense: 'MIT',
    runtime: 'ONNX Runtime WebGPU with WebAssembly CPU fallback',
    files: Object.freeze(SUPERFILES)
  })
})

export function getTtsModel(modelId) {
  return TTS_MODEL_REGISTRY[modelId] || null
}

export function getHfHubCacheRoot(env = process.env, home = homedir()) {
  if (env.HF_HUB_CACHE) return resolve(env.HF_HUB_CACHE)
  if (env.HF_HOME) return join(resolve(env.HF_HOME), 'hub')
  return join(home, '.cache', 'huggingface', 'hub')
}

export function getModelSnapshotDirectory(modelId, cacheRoot = getHfHubCacheRoot()) {
  const model = getTtsModel(modelId)
  if (!model) throw new Error(`Unknown TTS model: ${modelId}`)
  const repoCacheName = `models--${model.repoId.replaceAll('/', '--')}`
  return join(resolve(cacheRoot), repoCacheName, 'snapshots', model.revision)
}

export function isAllowedTtsAsset(modelId, assetPath) {
  const model = getTtsModel(modelId)
  if (!model || typeof assetPath !== 'string' || assetPath.includes('\\')) return false
  return model.files.some((file) => file.path === assetPath)
}

export function getTtsModelFilePath(modelId, assetPath, cacheRoot = getHfHubCacheRoot()) {
  if (!isAllowedTtsAsset(modelId, assetPath)) throw new Error('Unknown or disallowed TTS model asset')
  return join(getModelSnapshotDirectory(modelId, cacheRoot), ...assetPath.split('/'))
}
