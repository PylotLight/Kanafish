export const PREFERENCES_KEY = 'kanafish-preferences-v1'

export const THEME_OPTIONS = Object.freeze(['light', 'dark', 'amoled'])
export const TEXT_SCALE_OPTIONS = Object.freeze([1, 1.18, 1.32])

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  textScale: 1.18,
  sidebarCollapsed: false
})

export function normalizePreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    theme: THEME_OPTIONS.includes(source.theme) ? source.theme : DEFAULT_PREFERENCES.theme,
    textScale: TEXT_SCALE_OPTIONS.includes(source.textScale) ? source.textScale : DEFAULT_PREFERENCES.textScale,
    sidebarCollapsed: typeof source.sidebarCollapsed === 'boolean'
      ? source.sidebarCollapsed
      : DEFAULT_PREFERENCES.sidebarCollapsed
  }
}

export function loadPreferences(storage) {
  try {
    return normalizePreferences(JSON.parse(storage?.getItem(PREFERENCES_KEY) || 'null'))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function savePreferences(storage, value) {
  const preferences = normalizePreferences(value)
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // Preferences still apply for this session when local storage is unavailable.
  }
  return preferences
}
