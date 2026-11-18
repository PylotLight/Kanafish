import { describe, expect, test } from 'bun:test'
import course from '../course/course-v1.json'
import { getLessonSpeechTargets } from '../src/renderer/src/tts/readiness.js'
import { extractGreetings, extractJapanesePhrases, scoreSayTask } from '../src/renderer/src/asr/sayTask.js'

const week1 = course.weeks.find((week) => week.week === 1)
const lesson1 = week1.lessons.find((item) => item.id === 'W01-L1')
const sayTask = lesson1.sayTask
const speechTargets = getLessonSpeechTargets(week1, lesson1)
const greetingTargets = extractGreetings(speechTargets)
const instructionPhrases = extractJapanesePhrases(sayTask)

// W01-L1 names one phrase (みせん) and week 1 offers one greeting (こんにちは). Build realistic
// transcripts from the actual extracted phrases so the tests do not hard-code Japanese literals.
const firstGreeting = greetingTargets[0]?.ja || ''
const firstOpener = instructionPhrases[0] || ''
const both = firstGreeting + firstOpener
const onlyGreeting = firstGreeting
const onlyOpener = firstOpener

describe('say-task phrase extraction', () => {
  test('pulls the embedded Japanese instruction phrases from the (English) instruction', () => {
    expect(typeof sayTask).toBe('string')
    expect(instructionPhrases.length).toBeGreaterThanOrEqual(1)
    // The W01-L1 instruction names すみせん ("get the receptionist's attention").
    expect(instructionPhrases.some((phrase) => phrase.includes('せん'))).toBe(true)
  })

  test('leaves English wording untouched and de-duplicates repeats', () => {
    const phrases = extractJapanesePhrases('Say a greeting, then say ' + firstOpener + ' to get attention.')
    expect(phrases).toEqual(instructionPhrases)
    expect(extractJapanesePhrases('すみすみすみ。')).toEqual(['すみすみすみ'])
  })

  test('extracts a greeting candidate from week 1', () => {
    expect(greetingTargets.length).toBeGreaterThanOrEqual(1)
    expect(greetingTargets.some((greeting) => (greeting.meaning || '').toLowerCase().includes('afternoon'))).toBe(true)
  })
})

describe('say-task scoring', () => {
  test('passes when the transcript greets and opens politely', () => {
    const result = scoreSayTask(sayTask, greetingTargets, instructionPhrases, both)
    expect(result.passed).toBe(true)
    expect(result.checks.length).toBe(2)
    expect(result.checks.every((check) => check.ok)).toBe(true)
    expect(result.checks.some((check) => check.id === 'greeting')).toBe(true)
    expect(result.checks.some((check) => check.id.startsWith('phrase-'))).toBe(true)
  })

  test('passes on a natural utterance that contains both phrases', () => {
    const result = scoreSayTask(sayTask, greetingTargets, instructionPhrases, `${firstGreeting}${firstOpener} ne`)
    expect(result.passed).toBe(true)
  })

  test('fails when only the greeting is spoken (opener missing)', () => {
    const result = scoreSayTask(sayTask, greetingTargets, instructionPhrases, onlyGreeting)
    expect(result.passed).toBe(false)
    const phraseCheck = result.checks.find((check) => check.id.startsWith('phrase-'))
    expect(phraseCheck.ok).toBe(false)
  })

  test('fails when the opener is spoken but the greeting is missing', () => {
    const result = scoreSayTask(sayTask, greetingTargets, instructionPhrases, onlyOpener)
    expect(result.passed).toBe(false)
    const greetingCheck = result.checks.find((check) => check.id === 'greeting')
    expect(greetingCheck.ok).toBe(false)
  })

  test('reports no hearing and fails on an empty transcript', () => {
    const result = scoreSayTask(sayTask, greetingTargets, instructionPhrases, '')
    expect(result.passed).toBe(false)
    expect(result.hasHeard).toBe(false)
  })

  test('passes on mispronunciation when each phrase is still contained', () => {
    // Character-level similarity may be low, but containment of each phrase still counts as said.
    const result = scoreSayTask(sayTask, greetingTargets, instructionPhrases, `${firstGreeting}${firstOpener} ne yo`)
    expect(result.passed).toBe(true)
  })

  test('returns no checks (fails) when the task names no phrases and no greeting exists', () => {
    const result = scoreSayTask('Open the door, please.', [], [], 'door')
    expect(result.passed).toBe(false)
    expect(result.checks).toEqual([])
  })
})
