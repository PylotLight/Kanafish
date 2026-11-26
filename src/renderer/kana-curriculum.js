import { kanaToRomaji } from './romaji.js'

const CORE_ROWS = [
  { id: 'vowels-k', label: 'Vowels + K row', hiragana: 'あいうえおかきくけこ', katakana: 'アイウエオカキクケコ', session: 1 },
  { id: 's-t', label: 'S + T rows', hiragana: 'さしすせそたちつてと', katakana: 'サシスセソタチツテト', session: 2 },
  { id: 'n-h', label: 'N + H rows', hiragana: 'なにぬねのはひふへほ', katakana: 'ナニヌネノハヒフヘホ', session: 3 },
  { id: 'm-y', label: 'M + Y rows', hiragana: 'まみむめもやゆよ', katakana: 'マミムメモヤユヨ', session: 4 },
  { id: 'r-w-n', label: 'R + W + N rows', hiragana: 'らりるれろわをん', katakana: 'ラリルレロワヲン', session: 5 },
]

const VOICED_ROWS = [
  { id: 'g-z-d', label: 'G + Z + D rows', hiragana: 'がぎぐげござじずぜぞだぢづでど', katakana: 'ガギグゲゴザジズゼゾダヂヅデド', session: 6 },
  { id: 'b-p', label: 'B + P rows', hiragana: 'ばびぶべぼぱぴぷぺぽ', katakana: 'バビブベボパピプペポ', session: 7 },
]

const HIRAGANA_YOON = [
  'きゃ', 'きゅ', 'きょ', 'ぎゃ', 'ぎゅ', 'ぎょ', 'しゃ', 'しゅ', 'しょ', 'じゃ', 'じゅ', 'じょ',
  'ちゃ', 'ちゅ', 'ちょ', 'にゃ', 'にゅ', 'にょ', 'ひゃ', 'ひゅ', 'ひょ', 'びゃ', 'びゅ', 'びょ',
  'ぴゃ', 'ぴゅ', 'ぴょ', 'みゃ', 'みゅ', 'みょ', 'りゃ', 'りゅ', 'りょ',
]

const KATAKANA_EXTRA_SOUNDS = [
  'ティ', 'ディ', 'トゥ', 'ドゥ', 'ファ', 'フィ', 'フェ', 'フォ', 'ウィ', 'ウェ', 'ウォ', 'ヴァ', 'ヴィ', 'ヴェ', 'ヴォ',
  'チェ', 'ジェ', 'シェ', 'ツァ', 'ツィ', 'ツェ', 'ツォ',
]

const SPECIAL_READINGS = Object.freeze({
  'ぁ': 'small a', 'ぃ': 'small i', 'ぅ': 'small u', 'ぇ': 'small e', 'ぉ': 'small o',
  'ゎ': 'small wa', 'ゕ': 'small ka', 'ゖ': 'small ke', 'っ': 'small tsu', 'ゔ': 'vu',
  'ァ': 'small a', 'ィ': 'small i', 'ゥ': 'small u', 'ェ': 'small e', 'ォ': 'small o',
  'ヮ': 'small wa', 'ヵ': 'small ka', 'ヶ': 'small ke', 'ッ': 'small tsu', 'ー': 'long vowel mark', 'ヴ': 'vu',
})

const SPECIAL_HIRAGANA = ['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゎ', 'ゕ', 'ゖ', 'っ', 'ゔ']
const SPECIAL_KATAKANA = ['ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ', 'ヵ', 'ヶ', 'ッ', 'ー', 'ヴ']

function toKatakana(text) {
  return Array.from(text, (character) => {
    const codePoint = character.codePointAt(0)
    return codePoint >= 0x3041 && codePoint <= 0x3096 ? String.fromCodePoint(codePoint + 0x60) : character
  }).join('')
}

function toKanaIdText(text) {
  return Array.from(text, (character) => character.codePointAt(0).toString(16)).join('-')
}

function lessonIdsFor(script, session) {
  const localSession = session - (script === 'hiragana' ? 0 : 8)
  if (localSession >= 8) return []
  const week = script === 'hiragana' ? 1 : 2
  const lesson = localSession <= 2 ? 1 : localSession <= 5 ? 2 : 3
  return [`W${String(week).padStart(2, '0')}-L${lesson}`]
}

function makeUnit(script, definition, week, kind = 'core') {
  const shortScript = script === 'hiragana' ? 'hira' : 'kata'
  const unitId = `${shortScript}-${definition.id}`
  const source = script === 'hiragana' ? definition.hiragana : definition.katakana
  const strings = Array.isArray(source) ? source : Array.from(source)
  const lessonIds = kind === 'core' ? lessonIdsFor(script, definition.session) : []
  const items = strings.map((kana) => {
    const reading = SPECIAL_READINGS[kana] || kanaToRomaji(kana)
    const id = `kana-${shortScript}-${definition.id}-${toKanaIdText(kana)}`
    return {
      id,
      type: 'kana',
      kanaItem: true,
      script,
      kana,
      reading,
      romaji: reading,
      week,
      unitId,
      unitLabel: definition.label,
      session: definition.session,
      kind,
      detail: `${definition.label} · ${script === 'hiragana' ? 'Hiragana' : 'Katakana'} sound retrieval.`,
      lessonIds,
    }
  })
  return {
    id: unitId,
    script,
    week,
    session: definition.session,
    label: definition.label,
    kind,
    description: definition.description || `Learn this small set, then retrieve it in both directions.`,
    items,
  }
}

function makeScriptUnits(script) {
  const week = script === 'hiragana' ? 1 : 2
  const offset = script === 'hiragana' ? 0 : 8
  const rowKey = script === 'hiragana' ? 'hiragana' : 'katakana'
  const basics = CORE_ROWS.map((row) => ({ ...row, session: row.session + offset }))
  const voiced = VOICED_ROWS.map((row) => ({ ...row, session: row.session + offset }))
  const units = [
    ...basics.map((row) => makeUnit(script, row, week, 'core')),
    ...voiced.map((row) => makeUnit(script, row, week, 'core')),
  ]
  const yoon = script === 'hiragana' ? HIRAGANA_YOON : HIRAGANA_YOON.map(toKatakana)
  const patternItems = [...yoon, ...(script === 'hiragana' ? SPECIAL_HIRAGANA : SPECIAL_KATAKANA)]
  if (script === 'katakana') patternItems.push(...KATAKANA_EXTRA_SOUNDS)
  units.push(makeUnit(script, {
    id: 'patterns',
    label: script === 'hiragana' ? 'Yōon + small kana' : 'Yōon + small kana + loanword sounds',
    [rowKey]: patternItems,
    session: 8 + offset,
    description: script === 'hiragana'
      ? 'Combine small ゃ/ゅ/ょ with earlier sounds, then revisit small kana and っ in words.'
      : 'Combine small ャ/ュ/ョ, practise ッ and ー, and read common loanword spellings.'
  }, week, 'pattern'))
  return units
}

export const KANA_UNITS = Object.freeze([
  ...makeScriptUnits('hiragana'),
  ...makeScriptUnits('katakana'),
])

export const KANA_ITEMS = Object.freeze(KANA_UNITS.flatMap((unit) => unit.items))

export function getKanaCards() {
  return KANA_ITEMS.map((item) => ({
    id: item.id,
    type: 'kana',
    kanaItem: true,
    srsOnly: true,
    week: item.week,
    front: item.kana,
    back: item.reading,
    reading: item.reading,
    detail: item.detail,
    lessonIds: item.lessonIds,
  }))
}

export function isKanaItemMastered(progress, item) {
  return (progress?.kanaRecall?.[item?.id]?.successfulDays?.length ?? 0) >= 2
}

export function getKanaUnitStats(progress, unit) {
  const items = unit?.items ?? []
  const mastered = items.filter((item) => isKanaItemMastered(progress, item)).length
  const attempted = items.filter((item) => (progress?.kanaRecall?.[item.id]?.attempts ?? 0) > 0).length
  return {
    total: items.length,
    mastered,
    attempted,
    status: mastered === items.length && items.length > 0 ? 'solid' : attempted > 0 ? 'practising' : 'new',
  }
}

export function getKanaScriptStats(progress, script) {
  const units = KANA_UNITS.filter((unit) => unit.script === script)
  const coreItems = units.filter((unit) => unit.kind === 'core').flatMap((unit) => unit.items)
  const patternItems = units.filter((unit) => unit.kind === 'pattern').flatMap((unit) => unit.items)
  const masteredCore = coreItems.filter((item) => isKanaItemMastered(progress, item)).length
  const masteredPatterns = patternItems.filter((item) => isKanaItemMastered(progress, item)).length
  return {
    coreTotal: coreItems.length,
    coreMastered: masteredCore,
    coreSeen: coreItems.filter((item) => (progress?.kanaRecall?.[item.id]?.attempts ?? 0) > 0).length,
    patternTotal: patternItems.length,
    patternMastered: masteredPatterns,
  }
}

function shuffle(items, random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function isScheduleDue(schedule, todayISO, now) {
  if (schedule?.dueAt) {
    const dueAt = Date.parse(schedule.dueAt)
    if (Number.isFinite(dueAt)) return dueAt <= now.getTime()
  }
  if (schedule?.dueDate) return schedule.dueDate <= todayISO
  return schedule?.lastRating === 'again'
}

function itemPriority(item, progress, todayISO, now) {
  const record = progress?.kanaRecall?.[item.id]
  const schedule = progress?.flashcards?.[item.id]
  if (schedule?.lastRating === 'again' && isScheduleDue(schedule, todayISO, now)) return 0
  if (isScheduleDue(schedule, todayISO, now)) return 1
  if (!record?.attempts) return 2
  return 3
}

function makeQuestion(item, candidates, random) {
  const alternatives = ['symbol-to-sound', 'sound-to-symbol']
  let direction = alternatives[Math.floor(random() * alternatives.length)] || alternatives[0]
  const sameSound = candidates.some((candidate) => candidate.id !== item.id && candidate.reading === item.reading)
  if (direction === 'sound-to-symbol' && sameSound) direction = 'symbol-to-sound'
  const answer = direction === 'symbol-to-sound' ? item.reading : item.kana
  const distractors = []
  const seen = new Set([answer])
  for (const candidate of shuffle(candidates.filter((entry) => entry.id !== item.id), random)) {
    const value = direction === 'symbol-to-sound' ? candidate.reading : candidate.kana
    if (seen.has(value)) continue
    seen.add(value)
    distractors.push(value)
    if (distractors.length === 3) break
  }
  const options = shuffle([answer, ...distractors], random)
  return {
    id: item.id,
    item,
    direction,
    prompt: direction === 'symbol-to-sound' ? item.kana : item.reading,
    answer,
    options,
  }
}

export function buildKanaQuiz(items, candidates, progress, todayISO, limit = 10, random = Math.random, now = new Date()) {
  const pool = Array.isArray(items) ? items.filter((item) => item?.id && item.kana && item.reading) : []
  if (!pool.length) return []
  const available = Array.isArray(candidates) ? candidates.filter((item) => item?.id && item.kana && item.reading) : pool
  const uniqueCandidates = [...new Map([...available, ...pool].map((item) => [item.id, item])).values()]
  const currentTime = now instanceof Date ? now : new Date(now)
  const ranked = shuffle(pool, random).sort((a, b) => itemPriority(a, progress, todayISO, currentTime) - itemPriority(b, progress, todayISO, currentTime))
  const selected = ranked.slice(0, Math.max(1, Math.min(limit, ranked.length)))
  return selected.map((item) => makeQuestion(item, uniqueCandidates, random))
}
