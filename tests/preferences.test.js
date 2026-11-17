import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PREFERENCES, PREFERENCES_KEY, loadPreferences, normalizePreferences, savePreferences
} from '../src/renderer/preferences.js'

describe('appearance and sidebar preferences', () => {
  test('new installs use a larger comfortable text size and expanded sidebar', () => {
    expect(DEFAULT_PREFERENCES).toEqual({ theme: 'light', textScale: 1.18, sidebarCollapsed: false })
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
  })

  test('only known themes and text scales are accepted', () => {
    expect(normalizePreferences({ theme: 'amoled', textScale: 1.32, sidebarCollapsed: true }))
      .toEqual({ theme: 'amoled', textScale: 1.32, sidebarCollapsed: true })
    expect(normalizePreferences({ theme: 'ultraviolet', textScale: 4, sidebarCollapsed: 'yes' }))
      .toEqual(DEFAULT_PREFERENCES)
  })

  test('preferences persist to the dedicated local storage key', () => {
    const saved = new Map()
    const storage = {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value)
    }
    const next = savePreferences(storage, { theme: 'dark', textScale: 1, sidebarCollapsed: true })
    expect(next).toEqual({ theme: 'dark', textScale: 1, sidebarCollapsed: true })
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
    expect(savePreferences(storage, { theme: 'amoled' }))
      .toEqual({ theme: 'amoled', textScale: 1.18, sidebarCollapsed: false })
  })
})
