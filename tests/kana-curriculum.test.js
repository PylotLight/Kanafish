import { describe, expect, test } from 'bun:test'
import {
  KANA_ITEMS, KANA_UNITS, buildKanaQuiz, getKanaCards, getKanaScriptStats, getKanaUnitStats,
} from '../src/renderer/kana-curriculum.js'

const HIRAGANA_CORE = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ'
const KATAKANA_CORE = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ'

function coreFor(script) {
  return KANA_UNITS.filter((unit) => unit.script === script && unit.kind === 'core').flatMap((unit) => unit.items)
}

describe('kana curriculum', () => {
  test('covers all 46 modern basic kana plus 25 voiced and semi-voiced kana per script', () => {
    for (const [script, expected] of [['hiragana', HIRAGANA_CORE], ['katakana', KATAKANA_CORE]]) {
      const items = coreFor(script)
      const symbols = new Set(items.map((item) => item.kana))
      expect(Array.from(expected)).toHaveLength(71)
      expect(items).toHaveLength(71)
      expect(symbols.size).toBe(71)
      expect(Array.from(expected).every((kana) => symbols.has(kana))).toBe(true)
      expect(items.every((item) => item.script === script && item.lessonIds.length === 1)).toBe(true)
    }
  })

  test('uses eight sessions per script and stable, unique card IDs', () => {
    expect(KANA_UNITS.filter((unit) => unit.script === 'hiragana').map((unit) => unit.session)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(KANA_UNITS.filter((unit) => unit.script === 'katakana').map((unit) => unit.session)).toEqual([9, 10, 11, 12, 13, 14, 15, 16])
    expect(new Set(KANA_ITEMS.map((item) => item.id)).size).toBe(KANA_ITEMS.length)
    expect(KANA_ITEMS.find((item) => item.kana === 'あ' && item.script === 'hiragana').id).toBe('kana-hira-vowels-k-3042')
    expect(KANA_ITEMS.find((item) => item.kana === 'ア' && item.script === 'katakana').id).toBe('kana-kata-vowels-k-30a2')
    expect(getKanaCards().map((card) => card.id)).toEqual(KANA_ITEMS.map((item) => item.id))
  })

  test('ties core rows to the intended conversation lessons while keeping pattern extensions optional', () => {
    const lookup = (kana, script) => KANA_ITEMS.find((item) => item.kana === kana && item.script === script)
    expect(lookup('あ', 'hiragana').lessonIds).toEqual(['W01-L1'])
    expect(lookup('な', 'hiragana').lessonIds).toEqual(['W01-L2'])
    expect(lookup('が', 'hiragana').lessonIds).toEqual(['W01-L3'])
    expect(lookup('ア', 'katakana').lessonIds).toEqual(['W02-L1'])
    expect(lookup('ナ', 'katakana').lessonIds).toEqual(['W02-L2'])
    expect(lookup('ガ', 'katakana').lessonIds).toEqual(['W02-L3'])
    expect(KANA_UNITS.find((unit) => unit.id === 'hira-patterns').items.every((item) => item.lessonIds.length === 0)).toBe(true)
  })

  test('includes yōon, small kana, sokuon, long-vowel mark and useful katakana loanword patterns', () => {
    const hira = new Set(KANA_UNITS.find((unit) => unit.id === 'hira-patterns').items.map((item) => item.kana))
    const kata = new Set(KANA_UNITS.find((unit) => unit.id === 'kata-patterns').items.map((item) => item.kana))
    for (const kana of ['きゃ', 'じゅ', 'っ', 'ぁ', 'ゔ']) expect(hira.has(kana)).toBe(true)
    for (const kana of ['キャ', 'ジュ', 'ッ', 'ー', 'ァ', 'ヴ', 'ティ', 'ファ', 'ウェ', 'ヴォ', 'チェ', 'ツォ']) expect(kata.has(kana)).toBe(true)
  })

  test('creates four-option retrieval questions in both directions, including multi-character sounds', () => {
    const unit = KANA_UNITS.find((candidate) => candidate.id === 'hira-vowels-k')
    const forward = buildKanaQuiz(unit.items, unit.items, {}, '2026-11-26', 10, () => 0.25)
    expect(forward).toHaveLength(10)
    expect(forward.every((question) => question.direction === 'symbol-to-sound' && question.options.length === 4 && question.options.includes(question.answer))).toBe(true)

    const reverse = buildKanaQuiz(unit.items, unit.items, {}, '2026-11-26', 10, () => 0.75)
    expect(reverse.every((question) => question.direction === 'sound-to-symbol' && question.options.length === 4 && question.options.includes(question.answer))).toBe(true)

    const patternUnit = KANA_UNITS.find((candidate) => candidate.id === 'hira-patterns')
    const yoon = patternUnit.items.find((item) => item.kana === 'きゃ')
    const yoonQuestion = buildKanaQuiz([yoon], patternUnit.items, {}, '2026-11-26', 1, () => 0.75)[0]
    expect(yoonQuestion).toMatchObject({ direction: 'sound-to-symbol', prompt: 'kya', answer: 'きゃ' })
    expect(yoonQuestion.options).toHaveLength(4)
  })

  test('tracks item-level attempts and requires two successful study days for mastery', () => {
    const item = KANA_ITEMS.find((entry) => entry.id === 'kana-hira-vowels-k-3042')
    const firstDay = { kanaRecall: { [item.id]: { attempts: 1, correct: 1, successfulDays: ['2026-11-17'], lastPracticed: '2026-11-17' } } }
    expect(getKanaUnitStats(firstDay, KANA_UNITS[0])).toMatchObject({ total: 10, attempted: 1, mastered: 0, status: 'practising' })
    expect(getKanaScriptStats(firstDay, 'hiragana')).toMatchObject({ coreTotal: 71, coreSeen: 1, coreMastered: 0 })
    const twoDays = { kanaRecall: { [item.id]: { attempts: 2, correct: 2, successfulDays: ['2026-11-17', '2026-11-18'], lastPracticed: '2026-11-18' } } }
    expect(getKanaUnitStats(twoDays, KANA_UNITS[0]).mastered).toBe(1)
  })

  test('prioritizes an item just missed in the shared SRS', () => {
    const unit = KANA_UNITS.find((candidate) => candidate.id === 'hira-vowels-k')
    const missed = unit.items[3]
    const progress = { flashcards: { [missed.id]: { lastRating: 'again' } } }
    const quiz = buildKanaQuiz(unit.items, unit.items, progress, '2026-11-26', 1, () => 0.5)
    expect(quiz[0].id).toBe(missed.id)
  })

  test('shows untouched pattern items before non-due attempts while retaining due-card priority', () => {
    const unit = KANA_UNITS.find((candidate) => candidate.id === 'hira-patterns')
    const practiced = unit.items[0]
    const history = { attempts: 1, correct: 1, successfulDays: ['2026-11-25'], lastPracticed: '2026-11-25' }
    const notDue = { kanaRecall: { [practiced.id]: history }, flashcards: { [practiced.id]: { lastRating: 'good', dueDate: '2026-11-29' } } }
    expect(buildKanaQuiz(unit.items, unit.items, notDue, '2026-11-26', 1, () => 0.5)[0].id).not.toBe(practiced.id)

    const due = { kanaRecall: { [practiced.id]: history }, flashcards: { [practiced.id]: { lastRating: 'good', dueDate: '2026-11-25' } } }
    expect(buildKanaQuiz(unit.items, unit.items, due, '2026-11-26', 1, () => 0.5)[0].id).toBe(practiced.id)
  })
})
