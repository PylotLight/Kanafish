export const SUPERTONIC_VOICES = Object.freeze([
  { id: 'M1', gender: 'Male', description: 'Lively and upbeat, with confident energy and a clear tone.' },
  { id: 'M2', gender: 'Male', description: 'Deep and robust; calm, composed, and serious.' },
  { id: 'M3', gender: 'Male', description: 'Polished and authoritative, with a confident, trustworthy delivery.' },
  { id: 'M4', gender: 'Male', description: 'Soft and neutral, with a gentle, youthful, friendly quality.' },
  { id: 'M5', gender: 'Male', description: 'Warm and soft-spoken, with a calm storytelling quality.' },
  { id: 'F1', gender: 'Female', description: 'Calm, slightly low-toned, steady, and composed.' },
  { id: 'F2', gender: 'Female', description: 'Bright and cheerful, lively, playful, and youthful.' },
  { id: 'F3', gender: 'Female', description: 'Clear professional announcer style, articulate and polished.' },
  { id: 'F4', gender: 'Female', description: 'Crisp and confident, with a distinct, expressive delivery.' },
  { id: 'F5', gender: 'Female', description: 'Kind and gentle, soft-spoken, calm, and soothing.' }
].map((voice) => Object.freeze(voice)))

export const SUPERTONIC_VOICE_IDS = Object.freeze(SUPERTONIC_VOICES.map(({ id }) => id))
export const SUPERTONIC_VOICE_MODES = Object.freeze(['fixed', 'week', 'lesson', 'shuffle'])
export const DEFAULT_SUPERTONIC_VOICE_SETTINGS = Object.freeze({ preset: 'M1', mode: 'lesson' })

export function isSupertonicVoice(value) {
  return SUPERTONIC_VOICE_IDS.includes(value)
}

export function getSupertonicVoice(id) {
  return SUPERTONIC_VOICES.find((voice) => voice.id === id) || null
}

export function normalizeSupertonicVoiceSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    preset: isSupertonicVoice(source.preset) ? source.preset : DEFAULT_SUPERTONIC_VOICE_SETTINGS.preset,
    mode: SUPERTONIC_VOICE_MODES.includes(source.mode) ? source.mode : DEFAULT_SUPERTONIC_VOICE_SETTINGS.mode
  }
}

export function resolveSupertonicVoice(settings, context = {}, random = Math.random) {
  const normalized = normalizeSupertonicVoiceSettings(settings)
  const startingIndex = SUPERTONIC_VOICE_IDS.indexOf(normalized.preset)
  if (normalized.mode === 'fixed') return normalized.preset
  if (normalized.mode === 'week') {
    const weekNumber = Number(context.weekNumber)
    if (!Number.isInteger(weekNumber) || weekNumber < 1) return normalized.preset
    return SUPERTONIC_VOICE_IDS[(startingIndex + weekNumber - 1) % SUPERTONIC_VOICE_IDS.length]
  }
  if (normalized.mode === 'lesson') {
    const lessonNumber = Number(context.lessonNumber)
    if (!Number.isInteger(lessonNumber) || lessonNumber < 1) return normalized.preset
    return SUPERTONIC_VOICE_IDS[(startingIndex + lessonNumber - 1) % SUPERTONIC_VOICE_IDS.length]
  }
  const sample = Number(random())
  const randomIndex = Number.isFinite(sample) ? Math.max(0, Math.min(SUPERTONIC_VOICE_IDS.length - 1, Math.floor(sample * SUPERTONIC_VOICE_IDS.length))) : 0
  return SUPERTONIC_VOICE_IDS[randomIndex]
}
