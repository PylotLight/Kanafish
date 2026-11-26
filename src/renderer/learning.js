import { kanaToRomaji } from './romaji.js'
import { getKanaCards } from './kana-curriculum.js'
import { DefaultScheduler, Rating } from 'ts-fsrs'

const VERSION = 5
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const validId = (v) => typeof v === 'string' && v.trim().length > 0
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const validTimestamp = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v
const isKanaCharacter = (value) => /^[\u3040-\u30ff\u31f0-\u31ffー]$/u.test(value)
const FSRS_RATING = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }
const REVIEW_RATING = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }
const FSRS_STATUSES = new Set(['new', 'learning', 'review', 'relearning'])
const fsrsScheduler = await DefaultScheduler({
  version: 'FSRS-7',
  desiredRetention: 0.9,
  enableFuzz: false,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  maximumInterval: 36500,
})

function localDateISO(date) {
  const local = new Date(date)
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset())
  return local.toISOString().slice(0, 10)
}

function localNoon(dateISO) {
  return new Date(`${dateISO}T12:00:00`)
}

function normalizeFsrsCard(value, cardId) {
  if (!isRecord(value) || value.cardId !== cardId || !validTimestamp(value.dueAt)) return null
  if (value.lastReviewAt !== null && !validTimestamp(value.lastReviewAt)) return null
  if (!FSRS_STATUSES.has(value.scheduleStatus) || ![0, 1, 2, 3].includes(value.state)) return null
  if (![value.stability, value.stabilityFast, value.difficulty, value.scheduledDays].every((n) => Number.isFinite(n) && n >= 0)) return null
  if (![value.reps, value.lapses, value.learningStep].every((n) => Number.isInteger(n) && n >= 0)) return null
  return {
    stability: value.stability, stabilityFast: value.stabilityFast, difficulty: value.difficulty,
    state: value.state, scheduleStatus: value.scheduleStatus, dueAt: value.dueAt,
    lastReviewAt: value.lastReviewAt, cardId, reps: value.reps, lapses: value.lapses,
    scheduledDays: value.scheduledDays, learningStep: value.learningStep,
  }
}

function normalizeReviewHistory(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!isRecord(item) || !validId(item.cardId) || !validTimestamp(item.reviewTime) || !validTimestamp(item.dueAt)) return []
    if (item.lastReviewAt !== null && !validTimestamp(item.lastReviewAt)) return []
    if (!FSRS_STATUSES.has(item.scheduleStatus) || ![0, 1, 2, 3].includes(item.state) || !REVIEW_RATING[item.rating]) return []
    if (![item.stability, item.stabilityFast, item.difficulty, item.scheduledDays].every((n) => Number.isFinite(n) && n >= 0)) return []
    if (!Number.isInteger(item.learningStep) || item.learningStep < 0) return []
    return [{
      eventId: validId(item.eventId) ? item.eventId : `review-${index}`,
      cardId: item.cardId, dueAt: item.dueAt, lastReviewAt: item.lastReviewAt,
      reviewTime: item.reviewTime, scheduleStatus: item.scheduleStatus, rating: item.rating,
      state: item.state, stability: item.stability, stabilityFast: item.stabilityFast,
      difficulty: item.difficulty, scheduledDays: item.scheduledDays, learningStep: item.learningStep,
    }]
  })
}

function toSchedulerCard(schedule, cardId, now) {
  if (schedule?.fsrsCard) {
    return { ...schedule.fsrsCard, dueAt: new Date(schedule.fsrsCard.dueAt),
      lastReviewAt: schedule.fsrsCard.lastReviewAt ? new Date(schedule.fsrsCard.lastReviewAt) : null }
  }
  const baseDate = validDate(schedule?.dueDate) ? localNoon(schedule.dueDate)
    : validDate(schedule?.introducedAt) ? localNoon(schedule.introducedAt) : now
  const card = fsrsScheduler.newCard({ now: baseDate, cardId })
  card.reps = schedule?.repetitions ?? 0
  card.lapses = schedule?.lapses ?? 0
  return card
}

function serializeFsrsCard(card) {
  return { ...card, dueAt: card.dueAt.toISOString(), lastReviewAt: card.lastReviewAt?.toISOString() ?? null }
}

export function createInitialProgress() {
  return { version: VERSION, completedLessonIds: [], lessonSessions: {}, milestones: {}, flashcards: {}, kanaMastery: {}, kanaRecall: {}, reviewHistory: [], lastStudyDate: null }
}

export function normalizeProgress(value) {
  const initial = createInitialProgress()
  if (!isRecord(value)) return initial
  const completedLessonIds = Array.isArray(value.completedLessonIds)
    ? [...new Set(value.completedLessonIds.filter(validId))] : []
  const lessonSessions = {}
  if (isRecord(value.lessonSessions)) for (const [id, session] of Object.entries(value.lessonSessions)) if (validId(id) && isRecord(session)) {
    const normalizedSession = { ...session }
    if (session.weakCardIds !== undefined) normalizedSession.weakCardIds = Array.isArray(session.weakCardIds) ? [...new Set(session.weakCardIds.filter(validId))] : []
    lessonSessions[id] = normalizedSession
  }
  const milestones = {}
  if (isRecord(value.milestones)) for (const [id, state] of Object.entries(value.milestones)) if (validId(id) && isRecord(state)) milestones[id] = { ...state }
  const flashcards = {}
  if (isRecord(value.flashcards)) for (const [id, item] of Object.entries(value.flashcards)) {
    if (!validId(id) || !isRecord(item)) continue
    const intervalDays = Number.isFinite(item.intervalDays) && item.intervalDays >= 0 ? item.intervalDays : 0
    const repetitions = Number.isInteger(item.repetitions) && item.repetitions >= 0 ? item.repetitions : 0
    const easeFactor = Number.isFinite(item.easeFactor) ? Math.max(1.3, Math.min(3.2, item.easeFactor)) : 2.5
    const lapses = Number.isInteger(item.lapses) && item.lapses >= 0 ? item.lapses : 0
    const fsrsCard = normalizeFsrsCard(item.fsrsCard, id)
    const dueAt = validTimestamp(item.dueAt) ? item.dueAt : fsrsCard?.dueAt ?? null
    const dueDate = validDate(item.dueDate) ? item.dueDate : dueAt ? localDateISO(new Date(dueAt)) : null
    const lastReviewed = validDate(item.lastReviewed) ? item.lastReviewed : null
    const introducedAt = validDate(item.introducedAt) ? item.introducedAt : null
    const lastRating = ['again', 'hard', 'good', 'easy'].includes(item.lastRating) ? item.lastRating : null
    const legacySchedule = isRecord(item.legacySchedule) ? item.legacySchedule : fsrsCard ? null
      : (intervalDays || dueDate || lastReviewed || introducedAt || repetitions || lapses || lastRating) ? {
        intervalDays, dueDate, repetitions, lastReviewed, introducedAt, lastRating,
        easeFactor, lapses,
      } : null
    flashcards[id] = { intervalDays, dueDate, dueAt, repetitions,
      lastReviewed, introducedAt, lastRating,
      easeFactor, lapses, fsrsCard, legacySchedule,
      schedulerSource: fsrsCard ? 'fsrs-7' : legacySchedule ? 'legacy-no-history' : null }
  }
  const kanaMastery = {}
  if (isRecord(value.kanaMastery)) for (const [character, state] of Object.entries(value.kanaMastery)) {
    if (!isKanaCharacter(character) || !isRecord(state)) continue
    const successfulDays = Array.isArray(state.successfulDays)
      ? [...new Set(state.successfulDays.filter(validDate))].sort().slice(-2) : []
    kanaMastery[character] = { successfulDays }
  }
  const kanaRecall = {}
  if (isRecord(value.kanaRecall)) for (const [cardId, record] of Object.entries(value.kanaRecall)) {
    if (!/^kana-(?:hira|kata)-[a-z0-9-]+$/i.test(cardId) || !isRecord(record)) continue
    const attempts = Number.isInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0
    const correct = Number.isInteger(record.correct) && record.correct >= 0 ? Math.min(record.correct, attempts) : 0
    const successfulDays = Array.isArray(record.successfulDays)
      ? [...new Set(record.successfulDays.filter(validDate))].sort().slice(-2) : []
    kanaRecall[cardId] = { attempts, correct, successfulDays, lastPracticed: validDate(record.lastPracticed) ? record.lastPracticed : null }
  }
  return { version: VERSION, completedLessonIds, lessonSessions, milestones, flashcards, kanaMastery, kanaRecall,
    reviewHistory: normalizeReviewHistory(value.reviewHistory),
    lastStudyDate: validDate(value.lastStudyDate) ? value.lastStudyDate : null }
}

export function getLessons(course) {
  return (Array.isArray(course?.weeks) ? course.weeks : []).flatMap((week) =>
    (Array.isArray(week?.lessons) ? week.lessons : []).map((lesson) => ({ week: week.week, lesson })))
}

function normalizeJapaneseText(value) {
  return String(value ?? '').replace(/[\s。、，「」？！,.!?]/gu, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lessonText(lesson) {
  return [
    ...(lesson?.dialogue ?? []).map((line) => line.ja),
    lesson?.responsePractice?.prompt,
    ...(lesson?.responsePractice?.choices ?? []),
    lesson?.sayTask,
    lesson?.adaptation,
    ...(lesson?.successChecks ?? []),
  ].filter(Boolean).join(' ')
}

function phraseAppearsInLesson(phrase, lesson) {
  const text = normalizeJapaneseText(lessonText(lesson))
  const parts = String(phrase?.ja ?? '').split(/(\[[^\]]+\])/g).filter(Boolean)
  if (!text || !parts.length) return false
  const source = parts.map((part) => /^\[[^\]]+\]$/.test(part)
    ? '.+?'
    : escapeRegExp(normalizeJapaneseText(part))).join('')
  return Boolean(source) && new RegExp(source, 'u').test(text)
}

function completedLessonsInWeek(course, progress, weekNumber) {
  const completed = new Set(progress.completedLessonIds)
  const week = course.weeks?.find((item) => item.week === weekNumber)
  return (week?.lessons ?? []).filter((lesson) => completed.has(lesson.id))
}

function studiedPhrases(course, progress, weekNumber) {
  const week = course.weeks?.find((item) => item.week === weekNumber)
  const completedLessons = completedLessonsInWeek(course, progress, weekNumber)
  if (!week || !completedLessons.length) return []
  return (week.phraseBank ?? []).map((phrase, index) => ({ phrase, week: weekNumber, id: `w${weekNumber}-phrase-${index + 1}`, index }))
    .filter(({ phrase }) => completedLessons.some((lesson) => phraseAppearsInLesson(phrase, lesson)))
}

export function getRetrievalPrompt(course, progress, lessonId) {
  const state = normalizeProgress(progress)
  const entries = getLessons(course)
  const currentIndex = entries.findIndex(({ lesson }) => lesson.id === lessonId)
  if (currentIndex < 0) return null
  const current = entries[currentIndex]
  const lessonNumber = Number(/-L([1-3])$/.exec(lessonId)?.[1] ?? 0)
  const weeks = Array.isArray(course?.weeks) ? course.weeks : []
  const pickPhrase = (candidates, preferredIndex = 0, weakIds = []) => {
    if (!candidates.length) return null
    const weak = new Set(weakIds)
    const rank = ({ id }) => {
      const lastRating = state.flashcards[id]?.lastRating
      if (weak.has(id) && !['good', 'easy'].includes(lastRating)) return -1
      return ({ again: 0, hard: 1 }[lastRating] ?? 4)
    }
    candidates.sort((a, b) => rank(a) - rank(b) || Math.abs(a.index - preferredIndex) - Math.abs(b.index - preferredIndex))
    return candidates[0]
  }

  if (lessonNumber === 1 && current.week > 1) {
    const previousWeekNumber = current.week - 1
    const previousWeek = weeks.find((week) => week.week === previousWeekNumber)
    const candidate = previousWeek && pickPhrase(studiedPhrases(course, state, previousWeekNumber))
    if (candidate) return {
      type: 'weekly', week: candidate.week, phrase: candidate.phrase,
      label: `Weekly revisit · Week ${String(candidate.week).padStart(2, '0')}`,
      prompt: candidate.phrase.use,
      context: `This phrase appeared in a lesson you completed. Try it in today’s new scene: ${current.lesson.scene}`,
    }
  }

  if (lessonNumber === 3 && current.week >= 4) {
    const oldest = current.week - 4
    const newest = current.week - 2
    const candidates = weeks.filter((week) => week.week >= oldest && week.week <= newest)
      .flatMap((week) => studiedPhrases(course, state, week.week))
    const rank = ({ id }) => {
      const lastRating = state.flashcards[id]?.lastRating
      const markedWeak = Object.values(state.lessonSessions || {}).some((session) => session.weakCardIds?.includes(id))
      if (markedWeak && !['good', 'easy'].includes(lastRating)) return -1
      return ({ again: 0, hard: 1 }[lastRating] ?? 4)
    }
    candidates.sort((a, b) => rank(a) - rank(b) || b.week - a.week || a.index - b.index)
    const candidate = candidates[0]
    if (candidate) return {
      type: 'spaced', week: candidate.week, phrase: candidate.phrase,
      label: `Longer-spaced revisit · Week ${String(candidate.week).padStart(2, '0')}`,
      prompt: candidate.phrase.use,
      context: `You practised this item earlier. Try it in today’s changed scene: ${current.lesson.scene}`,
    }
  }

  const previousCompleted = entries.slice(0, currentIndex).reverse().find(({ lesson }) => state.completedLessonIds.includes(lesson.id))
  if (previousCompleted) {
    const previousSession = state.lessonSessions[previousCompleted.lesson.id]
    const preferredIndex = previousSession?.warmup === 'remembered' ? 1 : 0
    const candidate = pickPhrase(studiedPhrases(course, state, previousCompleted.week), preferredIndex, previousSession?.weakCardIds)
    if (candidate) return {
      type: 'lesson', week: candidate.week, phrase: candidate.phrase,
      label: `From a completed lesson · Week ${String(candidate.week).padStart(2, '0')}`,
      prompt: candidate.phrase.use,
      context: previousSession?.warmup === 'remembered' ? 'A different useful phrase from material you have practised.' : 'Try once from memory or use a cue. This is a revisit, not a test.',
    }
  }

  return null
}

export function getCourseStats(course, progress) {
  const state = normalizeProgress(progress)
  const lessons = getLessons(course)
  const completed = new Set(state.completedLessonIds)
  const milestones = (Array.isArray(course?.weeks) ? course.weeks : []).filter((w) => isRecord(w.milestone)).map((w) => ({
    ...w.milestone, completed: Boolean(state.milestones[w.milestone.id]?.completed ?? state.milestones[w.milestone.id]?.complete),
  }))
  const weeks = Array.isArray(course?.weeks) ? course.weeks : []
  return { totalLessons: lessons.length, completedLessons: lessons.filter(({ lesson }) => completed.has(lesson.id)).length,
    percent: lessons.length ? Math.round(lessons.filter(({ lesson }) => completed.has(lesson.id)).length / lessons.length * 100) : 0,
    completedWeeks: weeks.filter((w) => Array.isArray(w.lessons) && w.lessons.length > 0 && w.lessons.every((l) => completed.has(l.id))).length,
    totalWeeks: weeks.length, milestones, nextLesson: lessons.find(({ lesson }) => !completed.has(lesson.id)) ?? null }
}

export function getFlashcards(course) {
  const cards = []
  for (const week of Array.isArray(course?.weeks) ? course.weeks : []) {
    const w = week.week
    const weekLessonIds = (week.lessons ?? []).map((lesson) => lesson.id)
    ;(week.phraseBank ?? []).forEach((p, i) => cards.push({ id: `w${w}-phrase-${i + 1}`, type: 'phrase', week: w, front: p.ja, back: p.en, detail: p.use ?? '', romaji: kanaToRomaji(p.ja), lessonIds: (week.lessons ?? []).filter((lesson) => phraseAppearsInLesson(p, lesson)).map((lesson) => lesson.id) }))
    ;(week.kanaFocus ?? []).forEach((kana, i) => cards.push({ id: `w${w}-kana-${i + 1}`, type: 'kana', week: w, front: kana, back: `Read aloud: ${kana}`, detail: 'Recognize and pronounce this kana group.', romaji: kanaToRomaji(kana) }))
    ;(week.kanjiCards ?? []).forEach((k, i) => {
      cards.push({ id: `w${w}-kanji-${i + 1}`, type: 'kanji', week: w, front: k.kanji, reading: k.reading, back: `${k.reading} — ${k.meaning}`, detail: k.whyHere ?? '', romaji: kanaToRomaji(k.reading), lessonIds: weekLessonIds })
      cards.push({ id: `w${w}-kanji-${i + 1}-meaning`, type: 'kanji', week: w, front: k.meaning, back: k.kanji, reading: k.reading, detail: k.whyHere ?? '', romaji: kanaToRomaji(k.reading), lessonIds: weekLessonIds, recallDirection: 'produce', srsOnly: true })
    })
    ;(week.lessons ?? []).forEach((lesson) => (lesson.dialogue ?? []).forEach((line, i) => cards.push({
      id: `${lesson.id}-line-${i + 1}`, type: 'dialogue', week: w, front: line.ja, back: line.en,
      detail: `${lesson.title} · ${line.speaker}`, romaji: kanaToRomaji(line.ja), lessonId: lesson.id,
    })))
  }
  cards.push(...getKanaCards())
  return cards
}

export function getDueCards(cards, progress, dateISO, limit = 20, now = null) {
  const state = normalizeProgress(progress)
  const completedLessons = new Set(state.completedLessonIds)
  const currentTime = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime()
    : validTimestamp(now) ? Date.parse(now) : null
  const due = (Array.isArray(cards) ? cards : []).filter((card) => {
    const schedule = state.flashcards[card.id]
    const tiedToCompletedLesson = completedLessons.has(card.lessonId)
      || (Array.isArray(card.lessonIds) && card.lessonIds.some((lessonId) => completedLessons.has(lessonId)))
    const hasStudyHistory = Boolean(schedule?.introducedAt || schedule?.lastReviewed || tiedToCompletedLesson)
    const due = schedule?.dueAt
      ? currentTime !== null && Date.parse(schedule.dueAt) <= currentTime
      : !schedule?.dueDate || schedule.dueDate <= dateISO
    return hasStudyHistory && due
  })
  const urgency = (card) => {
    const schedule = state.flashcards[card.id]
    if (!schedule) return 4
    if (schedule.lastRating === 'again') return 0
    if (schedule.lastRating === 'hard') return 1
    return 4
  }
  return due.map((card, index) => ({ card, index })).sort((a, b) => {
    const priority = urgency(a.card) - urgency(b.card)
    if (priority) return priority
    const aDate = state.flashcards[a.card.id]?.dueDate || dateISO
    const bDate = state.flashcards[b.card.id]?.dueDate || dateISO
    return aDate.localeCompare(bDate) || a.index - b.index
  }).slice(0, Math.max(0, limit)).map(({ card }) => card)
}

function addDays(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function ratingIntervalLabel(dueAt, now) {
  const minutes = Math.max(1, Math.ceil((dueAt.getTime() - now.getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.max(1, Math.ceil(minutes / 60))
  if (hours < 24) return `${hours}h`
  const days = Math.max(1, Math.round(minutes / 1440))
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

function getReviewTime(dateISO, now) {
  if (now === null || now === undefined) return localNoon(dateISO)
  if (now instanceof Date && Number.isFinite(now.getTime())) return new Date(now)
  if (validTimestamp(now)) return new Date(now)
  throw new TypeError('now must be a valid Date or ISO timestamp')
}

export function rateCard(progress, cardId, rating, dateISO, card = null, now = null) {
  if (!validId(cardId)) throw new TypeError('cardId must be a non-empty string')
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new RangeError(`Unknown rating: ${rating}`)
  if (!validDate(dateISO)) throw new TypeError('dateISO must be a valid YYYY-MM-DD date')
  const state = normalizeProgress(progress)
  const prior = state.flashcards[cardId]
  const reviewTime = getReviewTime(dateISO, now)
  const schedulerCard = toSchedulerCard(prior, cardId, reviewTime)
  const result = fsrsScheduler.review({ card: schedulerCard, grade: FSRS_RATING[rating], now: reviewTime })
  const fsrsCard = serializeFsrsCard(result.card)
  const legacySchedule = prior?.legacySchedule ?? (prior && !prior.fsrsCard ? {
    intervalDays: prior.intervalDays, dueDate: prior.dueDate, repetitions: prior.repetitions,
    lastReviewed: prior.lastReviewed, introducedAt: prior.introducedAt,
    lastRating: prior.lastRating, easeFactor: prior.easeFactor, lapses: prior.lapses,
  } : null)
  const revlog = result.revlog
  const reviewHistory = [...state.reviewHistory, {
    eventId: `${cardId}:${reviewTime.getTime()}:${state.reviewHistory.length}`,
    cardId, dueAt: revlog.dueAt.toISOString(), lastReviewAt: revlog.lastReviewAt?.toISOString() ?? null,
    reviewTime: revlog.reviewTime.toISOString(), scheduleStatus: revlog.scheduleStatus,
    rating: revlog.rating, state: revlog.state, stability: revlog.stability,
    stabilityFast: revlog.stabilityFast, difficulty: revlog.difficulty,
    scheduledDays: revlog.scheduledDays, learningStep: revlog.learningStep,
  }]
  const next = { ...state, flashcards: { ...state.flashcards,
      [cardId]: { intervalDays: result.card.scheduledDays, dueDate: localDateISO(result.card.dueAt),
        dueAt: result.card.dueAt.toISOString(), repetitions: result.card.reps,
        lastReviewed: dateISO, introducedAt: prior?.introducedAt ?? null, lastRating: rating,
        easeFactor: prior?.easeFactor ?? 2.5, lapses: result.card.lapses,
        fsrsCard, legacySchedule, schedulerSource: 'fsrs-7' } },
    reviewHistory, lastStudyDate: dateISO }
  if (card?.type !== 'kana') return next
  const kanaState = recordKanaPractice(next, card.front, rating, dateISO)
  return card.kanaItem ? recordKanaRecall(kanaState, cardId, rating, dateISO) : kanaState
}

function recordKanaRecall(progress, cardId, rating, dateISO) {
  const state = normalizeProgress(progress)
  const previous = state.kanaRecall[cardId] ?? { attempts: 0, correct: 0, successfulDays: [], lastPracticed: null }
  const successfulDays = rating === 'good' || rating === 'easy'
    ? [...new Set([...previous.successfulDays, dateISO])].sort().slice(-2)
    : []
  return {
    ...state,
    kanaRecall: {
      ...state.kanaRecall,
      [cardId]: {
        attempts: previous.attempts + 1,
        correct: previous.correct + (rating === 'again' ? 0 : 1),
        successfulDays,
        lastPracticed: dateISO,
      },
    },
  }
}

export function recordKanaPractice(progress, kanaText, rating, dateISO) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new RangeError(`Unknown rating: ${rating}`)
  if (!validDate(dateISO)) throw new TypeError('dateISO must be a valid YYYY-MM-DD date')
  const state = normalizeProgress(progress)
  const kanaMastery = { ...state.kanaMastery }
  const characters = [...new Set(Array.from(String(kanaText ?? '')).filter(isKanaCharacter))]
  for (const character of characters) {
    const previous = kanaMastery[character]?.successfulDays ?? []
    const successfulDays = rating === 'good' || rating === 'easy'
      ? [...new Set([...previous, dateISO])].sort().slice(-2)
      : []
    kanaMastery[character] = { successfulDays }
  }
  return { ...state, kanaMastery, lastStudyDate: dateISO }
}

export function isKanaMastered(progress, text) {
  const state = normalizeProgress(progress)
  const characters = [...new Set(Array.from(String(text ?? '')).filter(isKanaCharacter))]
  return characters.length > 0 && characters.every((character) => (state.kanaMastery[character]?.successfulDays?.length ?? 0) >= 2)
}

export function shouldShowRomaji(text, progress, mode = 'adaptive') {
  if (mode === 'always') return true
  if (mode === 'hidden') return false
  return !isKanaMastered(progress, text)
}

export function getRatingIntervals(progress, cardId, dateISO, now = null) {
  if (!validId(cardId)) throw new TypeError('cardId must be a non-empty string')
  if (!validDate(dateISO)) throw new TypeError('dateISO must be a valid YYYY-MM-DD date')
  const reviewTime = getReviewTime(dateISO, now)
  const state = normalizeProgress(progress)
  const schedulerCard = toSchedulerCard(state.flashcards[cardId], cardId, reviewTime)
  return Object.fromEntries([...fsrsScheduler.preview({ card: schedulerCard, now: reviewTime })]
    .map(({ grade, card: previewCard }) => [REVIEW_RATING[grade], ratingIntervalLabel(previewCard.dueAt, reviewTime)]))
}

export function markLessonComplete(progress, lessonId, dateISO, cards = []) {
  if (!validId(lessonId)) throw new TypeError('lessonId must be a non-empty string')
  if (!validDate(dateISO)) throw new TypeError('dateISO must be a valid YYYY-MM-DD date')
  const state = normalizeProgress(progress)
  const flashcards = { ...state.flashcards }
  for (const card of Array.isArray(cards) ? cards : []) {
    if (card.lessonId !== lessonId && !card.lessonIds?.includes(lessonId)) continue
    const previous = flashcards[card.id]
    if (previous?.introducedAt || previous?.lastReviewed) continue
    flashcards[card.id] = { intervalDays: 1, dueDate: addDays(dateISO, 1), dueAt: null, repetitions: 0, lastReviewed: null,
      introducedAt: dateISO, lastRating: null, easeFactor: 2.5, lapses: 0,
      fsrsCard: null, legacySchedule: { intervalDays: 1, dueDate: addDays(dateISO, 1), repetitions: 0,
        lastReviewed: null, introducedAt: dateISO, lastRating: null, easeFactor: 2.5, lapses: 0 },
      schedulerSource: 'legacy-no-history' }
  }
  return { ...state, flashcards, completedLessonIds: [...new Set([...state.completedLessonIds, lessonId])], lastStudyDate: dateISO }
}
export function saveLessonSession(progress, lessonId, patch) {
  if (!validId(lessonId) || !isRecord(patch)) throw new TypeError('lessonId and object patch are required')
  const state = normalizeProgress(progress)
  return { ...state, lessonSessions: { ...state.lessonSessions, [lessonId]: { ...state.lessonSessions[lessonId], ...patch } } }
}
export function saveMilestone(progress, milestoneId, patch) {
  if (!validId(milestoneId) || !isRecord(patch)) throw new TypeError('milestoneId and object patch are required')
  const state = normalizeProgress(progress)
  return { ...state, milestones: { ...state.milestones, [milestoneId]: { ...state.milestones[milestoneId], ...patch } } }
}
