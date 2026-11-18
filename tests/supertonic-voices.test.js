import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SUPERTONIC_VOICE_SETTINGS,
  getSupertonicVoice,
  isSupertonicVoice,
  normalizeSupertonicVoiceSettings,
  resolveSupertonicVoice,
  SUPERTONIC_VOICE_IDS,
  SUPERTONIC_VOICES
} from '../src/renderer/src/tts/supertonicVoices.js'

describe('Supertonic voice catalog and rotation', () => {
  test('exposes the ten documented presets with male and female descriptions', () => {
    expect(SUPERTONIC_VOICE_IDS).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'])
    expect(SUPERTONIC_VOICES).toHaveLength(10)
    expect(SUPERTONIC_VOICES.filter(({ gender }) => gender === 'Male')).toHaveLength(5)
    expect(SUPERTONIC_VOICES.filter(({ gender }) => gender === 'Female')).toHaveLength(5)
    expect(getSupertonicVoice('F5').description).toContain('gentle')
    expect(isSupertonicVoice('M2')).toBe(true)
    expect(isSupertonicVoice('x1')).toBe(false)
  })

  test('uses the selected fixed preset and normalizes invalid saved settings', () => {
    expect(DEFAULT_SUPERTONIC_VOICE_SETTINGS).toEqual({ preset: 'M1', mode: 'lesson' })
    expect(resolveSupertonicVoice({ preset: 'F3', mode: 'fixed' }, { weekNumber: 4, lessonNumber: 9 })).toBe('F3')
    expect(normalizeSupertonicVoiceSettings({ preset: 'invalid', mode: 'random' })).toEqual(DEFAULT_SUPERTONIC_VOICE_SETTINGS)
  })

  test('rotates repeatably in stable lesson order and starts from the chosen preset', () => {
    const settings = { preset: 'M1', mode: 'lesson' }
    expect([1, 2, 3, 4, 10, 11].map((lessonNumber) => resolveSupertonicVoice(settings, { lessonNumber })))
      .toEqual(['M1', 'M2', 'M3', 'M4', 'F5', 'M1'])
    expect(resolveSupertonicVoice({ preset: 'F4', mode: 'lesson' }, { lessonNumber: 2 })).toBe('F5')
    expect(resolveSupertonicVoice(settings, { lessonNumber: 2 })).toBe(resolveSupertonicVoice(settings, { lessonNumber: 2 }))
  })

  test('keeps one voice for the week and falls back to the chosen voice without course context', () => {
    const settings = { preset: 'M1', mode: 'week' }
    expect(resolveSupertonicVoice(settings, { weekNumber: 1 })).toBe('M1')
    expect(resolveSupertonicVoice(settings, { weekNumber: 2 })).toBe('M2')
    expect(resolveSupertonicVoice(settings, { weekNumber: 2, lessonNumber: 3 })).toBe('M2')
    expect(resolveSupertonicVoice({ preset: 'F2', mode: 'week' })).toBe('F2')
  })

  test('shuffle mode can be tested deterministically and always returns a supported preset', () => {
    const settings = { preset: 'M3', mode: 'shuffle' }
    expect(resolveSupertonicVoice(settings, {}, () => 0)).toBe('M1')
    expect(resolveSupertonicVoice(settings, {}, () => 0.5)).toBe('F1')
    expect(resolveSupertonicVoice(settings, {}, () => 1)).toBe('F5')
    expect(resolveSupertonicVoice(settings, {}, () => Number.NaN)).toBe('M1')
  })
})
