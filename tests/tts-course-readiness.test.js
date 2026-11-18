import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getLessonSpeechTargets, getTtsEngineReadiness, isJapanesePracticeText } from '../src/renderer/src/tts/readiness.js'

const course = JSON.parse(readFileSync(new URL('../course/course-v1.json', import.meta.url), 'utf8'))

const readyStatuses = {
  modelStatus: { installed: true },
  magpieStatus: { modelInstalled: true, runtimeReady: true },
  qwenStatus: { modelInstalled: true, runtimeReady: true },
  irodoriStatus: { modelInstalled: true, runtimeReady: true },
  irodoriMfOnnxStatus: { installed: true, runtimeReady: true },
  mioStatus: { modelInstalled: true, runtimeReady: true }
}

test('lesson audio availability follows the selected engine, not Supertonic-only status', () => {
  const ids = ['supertonic-3', 'magpie-v2607', 'qwen3-tts-0.6b-customvoice', 'irodori-v4.1-small', 'irodori-v4.1-small-mf', 'miotts-0.6b']
  for (const id of ids) expect(getTtsEngineReadiness(id, readyStatuses).ready).toBe(true)
  expect(getTtsEngineReadiness('magpie-v2607', { magpieStatus: { modelInstalled: true, runtimeReady: false } })).toMatchObject({ ready: false, missing: 'runtime' })
  expect(getTtsEngineReadiness('qwen3-tts-0.6b-customvoice', { qwenStatus: { modelInstalled: false, runtimeReady: true } })).toMatchObject({ ready: false, missing: 'model' })
  expect(getTtsEngineReadiness('unknown-engine', readyStatuses)).toMatchObject({ ready: false, missing: 'engine' })
})

test('all 36 lesson dialogues, phrase banks, Japanese reply options and script targets expose spoken text', () => {
  const lessons = course.weeks.flatMap((week) => week.lessons.map((lesson) => ({ week, lesson })))
  expect(lessons).toHaveLength(36)
  expect(lessons.map(({ lesson }) => lesson.id)).toEqual(Array.from({ length: 36 }, (_, index) => `W${String(Math.floor(index / 3) + 1).padStart(2, '0')}-L${(index % 3) + 1}`))

  for (const { week, lesson } of lessons) {
    const targets = getLessonSpeechTargets(week, lesson)
    expect(targets.dialogue.map((line) => line.ja)).toEqual(lesson.dialogue.map((line) => line.ja))
    expect(targets.phrases.map((phrase) => phrase.ja)).toEqual(week.phraseBank.map((phrase) => phrase.ja))
    expect(targets.responseChoices.map(({ text }) => text)).toEqual(lesson.responsePractice.choices.filter(isJapanesePracticeText))
    expect(targets.kanaFocus).toEqual(week.kanaFocus.filter(isJapanesePracticeText))
    expect(targets.kanjiReadings.map((card) => card.reading)).toEqual(week.kanjiCards.filter((card) => isJapanesePracticeText(card.reading)).map((card) => card.reading))
  }
})

test('spoken Japanese detection leaves English comprehension choices text-only', () => {
  expect(isJapanesePracticeText('こんにちは。')).toBe(true)
  expect(isJapanesePracticeText('What does the staff member ask for?')).toBe(false)
  expect(isJapanesePracticeText('駅 station')).toBe(true)
})
