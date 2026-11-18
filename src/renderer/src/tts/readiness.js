import { TTS_MODEL_CATALOG } from './modelCatalog.js'

const MODEL_NAMES = new Map(TTS_MODEL_CATALOG.map((model) => [model.id, model.name]))

const ENGINE_REQUIREMENTS = Object.freeze({
  'supertonic-3': { model: 'modelStatus', modelKey: 'installed', runtimeReady: () => true },
  'magpie-v2607': { model: 'magpieStatus', modelKey: 'modelInstalled', runtimeKey: 'runtimeReady' },
  'qwen3-tts-0.6b-customvoice': { model: 'qwenStatus', modelKey: 'modelInstalled', runtimeKey: 'runtimeReady' },
  'irodori-v4.1-small': { model: 'irodoriStatus', modelKey: 'modelInstalled', runtimeKey: 'runtimeReady' },
  // MF runs in-process on ONNX Runtime WASM, so there is no separate runtime to set up.
  'irodori-v4.1-small-mf': { model: 'irodoriMfOnnxStatus', modelKey: 'installed', runtimeReady: () => true },
  'miotts-0.6b': { model: 'mioStatus', modelKey: 'modelInstalled', runtimeKey: 'runtimeReady' }
})

export function getTtsEngineReadiness(modelId, statuses = {}) {
  const requirement = ENGINE_REQUIREMENTS[modelId]
  const modelName = MODEL_NAMES.get(modelId) || modelId || 'Local voice'
  if (!requirement) {
    return {
      modelId,
      modelName,
      modelInstalled: false,
      runtimeReady: false,
      ready: false,
      missing: 'engine',
      message: 'This local speech engine is not available in this build.'
    }
  }

  const engineStatus = statuses[requirement.model] || {}
  const modelInstalled = Boolean(engineStatus[requirement.modelKey])
  const runtimeReady = requirement.runtimeReady ? Boolean(requirement.runtimeReady(engineStatus)) : Boolean(engineStatus[requirement.runtimeKey])
  const missing = !runtimeReady ? 'runtime' : !modelInstalled ? 'model' : null
  const message = missing === 'runtime'
    ? `${modelName} needs its local runtime set up in Voice Lab.`
    : missing === 'model'
      ? `${modelName} needs its model files downloaded in Voice Lab.`
      : `${modelName} is ready for on-device Japanese speech.`

  return { modelId, modelName, modelInstalled, runtimeReady, ready: !missing, missing, message }
}

export function isJapanesePracticeText(value) {
  return typeof value === 'string' && /[\u3040-\u30ff\u3400-\u9fff]/u.test(value)
}

export function getLessonSpeechTargets(week, lesson) {
  return {
    dialogue: (Array.isArray(lesson?.dialogue) ? lesson.dialogue : [])
      .filter((line) => isJapanesePracticeText(line?.ja)),
    phrases: (Array.isArray(week?.phraseBank) ? week.phraseBank : [])
      .filter((phrase) => isJapanesePracticeText(phrase?.ja)),
    responseChoices: (Array.isArray(lesson?.responsePractice?.choices) ? lesson.responsePractice.choices : [])
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => isJapanesePracticeText(text)),
    kanaFocus: (Array.isArray(week?.kanaFocus) ? week.kanaFocus : [])
      .filter(isJapanesePracticeText),
    kanjiReadings: (Array.isArray(week?.kanjiCards) ? week.kanjiCards : [])
      .filter((card) => isJapanesePracticeText(card?.reading))
  }
}
