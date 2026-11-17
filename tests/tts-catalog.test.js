import { describe, expect, test } from 'bun:test'
import { TTS_MODEL_CATALOG, RUNNABLE_TTS_MODEL_IDS } from '../src/renderer/src/tts/modelCatalog.js'

describe('TTS model catalog', () => {
  test('marks only integrated Supertonic, Magpie, Qwen and Irodori adapters runnable', () => {
    expect(RUNNABLE_TTS_MODEL_IDS).toEqual(['supertonic-3', 'magpie-v2607', 'qwen3-tts-0.6b-customvoice', 'irodori-v4.1-small', 'irodori-v4.1-small-mf'])
    expect(TTS_MODEL_CATALOG.filter((model) => model.availableInApp).map((model) => model.id)).toEqual(RUNNABLE_TTS_MODEL_IDS)
  })

  test('lists every requested candidate without marking research-only placeholders runnable', () => {
    for (const id of ['supertonic-3', 'irodori-v4.1-small', 'irodori-v4.1-small-mf', 'miotts-0.6b', 'qwen3-tts-0.6b-base', 'qwen3-tts-0.6b-customvoice', 'magpie-v2607']) {
      expect(TTS_MODEL_CATALOG.some((model) => model.id === id)).toBe(true)
    }
    for (const candidate of TTS_MODEL_CATALOG.filter((model) => !['supertonic-3', 'magpie-v2607', 'qwen3-tts-0.6b-customvoice', 'irodori-v4.1-small', 'irodori-v4.1-small-mf'].includes(model.id))) {
      expect(candidate.availableInApp).toBe(false)
      expect(candidate.sourceUrl.startsWith('https://')).toBe(true)
      expect(candidate.weightsLicense).toBeTruthy()
    }
  })

  test('lists Irodori as runnable only with its validated optional sidecar path', () => {
    const irodori = TTS_MODEL_CATALOG.find((model) => model.id === 'irodori-v4.1-small')
    expect(irodori.statusLabel).toContain('optional Python sidecar')
    expect(irodori.runtime).toContain('PyTorch MPS')
    expect(irodori.evidence).toContain('48 kHz RIFF/WAVE')
    expect(irodori.evidence).toContain('RTF 5.47')
    expect(irodori.evidence).toContain('Mac/MPS')
    expect(irodori.availableInApp).toBe(true)
  })

  test('keeps the plain Irodori checkpoint separate from the distilled MF ONNX variant', () => {
    const plain = TTS_MODEL_CATALOG.find((model) => model.id === 'irodori-v4.1-small')
    const mf = TTS_MODEL_CATALOG.find((model) => model.id === 'irodori-v4.1-small-mf')
    expect(plain.name).toBe('Irodori-TTS v4.1-Small')
    expect(plain.runtime).toContain('Python')
    expect(mf.name).toContain('Small-MF')
    expect(mf.runtime).toContain('no Python')
    expect(mf.sourceUrl).toContain('ONNX-int8')
    expect(mf.availableInApp).toBe(true)
    expect(mf.evidence).toContain('RTF 10.65')
  })

  test('keeps Magpie model weights separate from the Apache-2.0 runtime license', () => {
    const magpie = TTS_MODEL_CATALOG.find((model) => model.id === 'magpie-v2607')
    expect(magpie.availableInApp).toBe(true)
    expect(magpie.weightsLicense).toBe('NVIDIA Open Model License')
    expect(magpie.codeLicense).toBe('Apache-2.0 runtime')
    expect(magpie.runtime).toContain('Japanese frontend')
  })

  test('keeps retired Chatterbox out of the runnable shortlist', () => {
    const chatterbox = TTS_MODEL_CATALOG.find((model) => model.id === 'chatterbox-multilingual-v3')
    expect(chatterbox.status).toBe('archival')
    expect(chatterbox.availableInApp).toBe(false)
  })
})
