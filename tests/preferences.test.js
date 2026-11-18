import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PREFERENCES, PREFERENCES_KEY, loadPreferences, normalizePreferences, savePreferences
} from '../src/renderer/preferences.js'

describe('appearance, sidebar, and voice preferences', () => {
  test('new installs use comfortable text, expanded navigation, and rotating course voices', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      theme: 'light',
      textScale: 1.18,
      sidebarCollapsed: false,
      supertonicVoice: { preset: 'M1', mode: 'lesson' }
    })
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
  })

  test('only known themes, text scales, voices, and rotation modes are accepted', () => {
    expect(normalizePreferences({
      theme: 'amoled',
      textScale: 1.32,
      sidebarCollapsed: true,
      supertonicVoice: { preset: 'F4', mode: 'week' }
    })).toEqual({
      theme: 'amoled',
      textScale: 1.32,
      sidebarCollapsed: true,
      supertonicVoice: { preset: 'F4', mode: 'week' }
    })
    expect(normalizePreferences({
      theme: 'ultraviolet',
      textScale: 4,
      sidebarCollapsed: 'yes',
      supertonicVoice: { preset: 'X9', mode: 'surprise' }
    })).toEqual(DEFAULT_PREFERENCES)
  })

  test('legacy saved preferences gain the default voice configuration without losing other settings', () => {
    expect(normalizePreferences({ theme: 'dark', textScale: 1, sidebarCollapsed: true })).toEqual({
      theme: 'dark',
      textScale: 1,
      sidebarCollapsed: true,
      supertonicVoice: { preset: 'M1', mode: 'lesson' }
    })
  })

  test('preferences persist to the dedicated local storage key', () => {
    const saved = new Map()
    const storage = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value)
    }
    const next = savePreferences(storage, {
      theme: 'dark',
      textScale: 1,
      sidebarCollapsed: true,
      supertonicVoice: { preset: 'F2', mode: 'shuffle' }
    })
    expect(next.supertonicVoice).toEqual({ preset: 'F2', mode: 'shuffle' })
    expect(saved.has(PREFERENCES_KEY)).toBe(true)
    expect(loadPreferences(storage)).toEqual(next)
  })

  test('malformed saved preferences fall back safely', () => {
    const storage = { getItem: () => '{broken json' }
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES)
    expect(loadPreferences({ getItem: () => 'null' })).toEqual(DEFAULT_PREFERENCES)
  })

  test('storage write failures do not prevent preferences applying in memory', () => {
    const storage = { setItem: () => { throw new Error('storage blocked') } }
    expect(savePreferences(storage, { theme: 'amoled' })).toEqual({
      theme: 'amoled',
      textScale: 1.18,
      sidebarCollapsed: false,
      supertonicVoice: { preset: 'M1', mode: 'lesson' }
    })
  })
})
