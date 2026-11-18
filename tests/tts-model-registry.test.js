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

  test('pins the separate Irodori-Small-MF ONNX pack without the app-only encrypted decoder', () => {
    const model = getTtsModel('irodori-v4.1-small-mf')
    expect(model.revision).toBe('0701bc6758cbb364a9577d5799a90a45baa8ffa2')
    expect(model.files.reduce((sum, file) => sum + file.size, 0)).toBe(1_693_722_741)
    expect(model.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
    expect(model.files.map((file) => file.path)).toContain('dit_step_int8.onnx')
    expect(model.files.map((file) => file.path)).toContain('tokenizer/tokenizer.json')
    expect(model.files.map((file) => file.path)).not.toContain('voice_decoder_a.bin')
    expect(getModelSnapshotDirectory(model.id, '/tmp/hf-cache')).toContain('models--Ryoppi--Irodori-TTS-v4.1-Small-MF-ONNX-int8')
    expect(isAllowedTtsAsset(model.id, 'duration.onnx')).toBe(true)
    expect(isAllowedTtsAsset(model.id, '../config.json')).toBe(false)
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

import { getTtsEngineReadiness } from '../src/renderer/src/tts/readiness.js'
import { test as readinessTest, expect as readinessExpect } from 'bun:test'
readinessTest('Supertonic is the only enabled engine and becomes ready when its model is installed', () => {
  const ready = getTtsEngineReadiness('supertonic-3', { modelStatus: { installed: true } })
  readinessExpect(ready.ready).toBe(true)
})
readinessTest('a paused engine stays unavailable even when its former ONNX pack is installed', () => {
  const ready = getTtsEngineReadiness('irodori-v4.1-small-mf', { irodoriMfOnnxStatus: { installed: true } })
  readinessExpect(ready.ready).toBe(false)
  readinessExpect(ready.missing).toBe('engine')
  readinessExpect(ready.message).toContain('temporarily disabled')
})
