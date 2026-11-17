import { describe, expect, test } from 'bun:test'
import {
  getHfHubCacheRoot,
  getModelSnapshotDirectory,
  getTtsModel,
  getTtsModelFilePath,
  isAllowedTtsAsset
} from '../src/main/tts/modelRegistry.js'

describe('TTS model registry and cache', () => {
  test('resolves Hugging Face cache overrides and default location', () => {
    expect(getHfHubCacheRoot({ HF_HUB_CACHE: '/tmp/hf-cache' }, '/home/test')).toBe('/tmp/hf-cache')
    expect(getHfHubCacheRoot({ HF_HOME: '/tmp/hf-home' }, '/home/test')).toBe('/tmp/hf-home/hub')
    expect(getHfHubCacheRoot({}, '/home/test')).toBe('/home/test/.cache/huggingface/hub')
  })

  test('pins the snapshot path to the vetted Supertonic revision', () => {
    expect(getModelSnapshotDirectory('supertonic-3', '/tmp/hf-cache')).toBe(
      '/tmp/hf-cache/models--supertone-oss-archive--supertonic-3/snapshots/aafc6e32416a594460b32413efc49d7fe4ce6d46'
    )
    expect(getTtsModel('supertonic-3').revision).toBe('aafc6e32416a594460b32413efc49d7fe4ce6d46')
  })

  test('pins a SHA-256 digest for every model asset', () => {
    const files = getTtsModel('supertonic-3').files
    expect(files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
    expect(files.find((file) => file.path === 'onnx/duration_predictor.onnx').sha256)
      .toBe('c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db')
  })

  test('serves only exact allow-listed relative model assets', () => {
    expect(isAllowedTtsAsset('supertonic-3', 'onnx/tts.json')).toBe(true)
    expect(isAllowedTtsAsset('supertonic-3', 'voice_styles/M1.json')).toBe(true)
    expect(isAllowedTtsAsset('supertonic-3', 'onnx/../voice_styles/M1.json')).toBe(false)
    expect(isAllowedTtsAsset('supertonic-3', '..\\secrets')).toBe(false)
    expect(isAllowedTtsAsset('unknown-model', 'onnx/tts.json')).toBe(false)
    expect(() => getTtsModelFilePath('unknown-model', 'onnx/tts.json', '/tmp/hf-cache')).toThrow()
  })
})
