import { describe, expect, test } from 'bun:test'
import { TTS_MODEL_CATALOG, RUNNABLE_TTS_MODEL_IDS } from '../src/renderer/src/tts/modelCatalog.js'

describe('TTS model catalog', () => {
  test('marks only the integrated Supertonic and native Magpie adapters runnable', () => {
    expect(RUNNABLE_TTS_MODEL_IDS).toEqual(['supertonic-3', 'magpie-v2607'])
    expect(TTS_MODEL_CATALOG.filter((model) => model.availableInApp).map((model) => model.id)).toEqual(RUNNABLE_TTS_MODEL_IDS)
  })

  test('lists every requested candidate without marking research-only placeholders runnable', () => {
    for (const id of ['supertonic-3', 'irodori-v4.1-small', 'miotts-0.6b', 'qwen3-tts-0.6b-base', 'magpie-v2607']) {
      expect(TTS_MODEL_CATALOG.some((model) => model.id === id)).toBe(true)
    }
    for (const candidate of TTS_MODEL_CATALOG.filter((model) => !['supertonic-3', 'magpie-v2607'].includes(model.id))) {
      expect(candidate.availableInApp).toBe(false)
      expect(candidate.sourceUrl.startsWith('https://')).toBe(true)
      expect(candidate.weightsLicense).toBeTruthy()
    }
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
