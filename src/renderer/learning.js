const VERSION = 1;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validId = (v) => typeof v === 'string' && v.trim().length > 0;
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const cloneRecord = (v) => isRecord(v) ? { ...v } : {};

export function createInitialProgress() {
  return { version: VERSION, completedLessonIds: [], lessonSessions: {}, milestones: {}, flashcards: {}, lastStudyDate: null };
}

export function normalizeProgress(value) {
  const initial = createInitialProgress();
  if (!isRecord(value)) return initial;
  const completedLessonIds = Array.isArray(value.completedLessonIds)
    ? [...new Set(value.completedLessonIds.filter(validId))] : [];
  const lessonSessions = {};
  if (isRecord(value.lessonSessions)) for (const [id, session] of Object.entries(value.lessonSessions)) if (validId(id) && isRecord(session)) lessonSessions[id] = { ...session };
  const milestones = {};
  if (isRecord(value.milestones)) for (const [id, state] of Object.entries(value.milestones)) if (validId(id) && isRecord(state)) milestones[id] = { ...state };
  const flashcards = {};
  if (isRecord(value.flashcards)) for (const [id, item] of Object.entries(value.flashcards)) {
    if (!validId(id) || !isRecord(item)) continue;
    const intervalDays = Number.isFinite(item.intervalDays) && item.intervalDays >= 0 ? item.intervalDays : 0;
    const repetitions = Number.isInteger(item.repetitions) && item.repetitions >= 0 ? item.repetitions : 0;
    flashcards[id] = { intervalDays, dueDate: validDate(item.dueDate) ? item.dueDate : null, repetitions,
      lastReviewed: validDate(item.lastReviewed) ? item.lastReviewed : null,
      lastRating: ['again', 'hard', 'good', 'easy'].includes(item.lastRating) ? item.lastRating : null };
  }
  return { version: VERSION, completedLessonIds, lessonSessions, milestones, flashcards,
    lastStudyDate: validDate(value.lastStudyDate) ? value.lastStudyDate : null };
}

export function getLessons(course) {
  return (Array.isArray(course?.weeks) ? course.weeks : []).flatMap((week) =>
    (Array.isArray(week?.lessons) ? week.lessons : []).map((lesson) => ({ week: week.week, lesson })));
}

export function getRetrievalPrompt(course, progress, lessonId) {
  const state = normalizeProgress(progress);
  const entries = getLessons(course);
  const currentIndex = entries.findIndex(({ lesson }) => lesson.id === lessonId);
  if (currentIndex < 0) return null;
  const current = entries[currentIndex];
  const lessonNumber = Number(/-L([1-3])$/.exec(lessonId)?.[1] ?? 0);
  const weeks = Array.isArray(course?.weeks) ? course.weeks : [];
  const pickPhrase = (sourceWeek, phrases, preferredIndex = 0) => {
    if (!Array.isArray(phrases) || phrases.length === 0) return null;
    const candidates = phrases.map((phrase, index) => ({
      phrase,
      week: sourceWeek,
      id: `w${sourceWeek}-phrase-${index + 1}`,
      index,
    }));
    const rank = ({ id }) => ({ again: 0, hard: 1, good: 2, easy: 3 }[state.flashcards[id]?.lastRating] ?? 4);
    candidates.sort((a, b) => rank(a) - rank(b) || Math.abs(a.index - preferredIndex) - Math.abs(b.index - preferredIndex));
    return candidates[0];
  };

  if (lessonNumber === 1 && current.week > 1) {
    const previousWeek = weeks.find((week) => week.week === current.week - 1);
    const candidate = previousWeek && pickPhrase(previousWeek.week, previousWeek.phraseBank);
    if (candidate) return {
      type: 'weekly', week: candidate.week, phrase: candidate.phrase,
      label: `Weekly revisit · Week ${String(candidate.week).padStart(2, '0')}`,
      prompt: candidate.phrase.use,
      context: `Try to bring it into this new scene: ${current.lesson.scene}`,
    };
  }

  if (lessonNumber === 3 && current.week >= 4) {
    const oldest = current.week - 4;
    const newest = current.week - 2;
    const candidates = weeks
      .filter((week) => week.week >= oldest && week.week <= newest)
      .flatMap((week) => (week.phraseBank ?? []).map((phrase, index) => ({ phrase, week: week.week, id: `w${week.week}-phrase-${index + 1}`, index })));
    const rank = ({ id }) => ({ again: 0, hard: 1, good: 2, easy: 3 }[state.flashcards[id]?.lastRating] ?? 4);
    candidates.sort((a, b) => rank(a) - rank(b) || b.week - a.week || a.index - b.index);
    const candidate = candidates[0];
    if (candidate) return {
      type: 'spaced', week: candidate.week, phrase: candidate.phrase,
      label: `Longer-spaced revisit · Week ${String(candidate.week).padStart(2, '0')}`,
      prompt: candidate.phrase.use,
      context: `Try the phrase in today’s changed scene: ${current.lesson.scene}`,
    };
  }

  const previousCompleted = entries.slice(0, currentIndex).reverse().find(({ lesson }) => state.completedLessonIds.includes(lesson.id));
  if (previousCompleted) {
    const previousSession = state.lessonSessions[previousCompleted.lesson.id];
    const preferredIndex = previousSession?.warmup === 'remembered' ? 1 : 0;
    const previousWeek = weeks.find((week) => week.week === previousCompleted.week);
    const candidate = previousWeek && pickPhrase(previousCompleted.week, previousWeek.phraseBank, preferredIndex);
    if (candidate) return {
      type: 'lesson', week: candidate.week, phrase: candidate.phrase,
      label: `From your last completed lesson · Week ${String(candidate.week).padStart(2, '0')}`,
      prompt: candidate.phrase.use,
      context: previousSession?.warmup === 'remembered' ? 'A different useful phrase this time.' : 'Try once before opening a cue; missed items return for another practice.',
    };
  }

  return { type: 'starter', week: current.week, phrase: null, label: 'Your first conversation', prompt: 'Can you think of a Japanese greeting or polite opening?', context: '' };
}

export function getCourseStats(course, progress) {
  const state = normalizeProgress(progress);
  const lessons = getLessons(course);
  const completed = new Set(state.completedLessonIds);
  const milestones = (Array.isArray(course?.weeks) ? course.weeks : []).filter((w) => isRecord(w.milestone)).map((w) => ({
    ...w.milestone, completed: Boolean(state.milestones[w.milestone.id]?.completed ?? state.milestones[w.milestone.id]?.complete),
  }));
  const weeks = Array.isArray(course?.weeks) ? course.weeks : [];
  return { totalLessons: lessons.length, completedLessons: lessons.filter(({ lesson }) => completed.has(lesson.id)).length,
    percent: lessons.length ? Math.round(lessons.filter(({ lesson }) => completed.has(lesson.id)).length / lessons.length * 100) : 0,
    completedWeeks: weeks.filter((w) => Array.isArray(w.lessons) && w.lessons.length > 0 && w.lessons.every((l) => completed.has(l.id))).length,
    totalWeeks: weeks.length, milestones, nextLesson: lessons.find(({ lesson }) => !completed.has(lesson.id)) ?? null };
}

export function getFlashcards(course) {
  const cards = [];
  for (const week of Array.isArray(course?.weeks) ? course.weeks : []) {
    const w = week.week;
    (week.phraseBank ?? []).forEach((p, i) => cards.push({ id: `w${w}-phrase-${i + 1}`, type: 'phrase', week: w, front: p.ja, back: p.en, detail: p.use ?? '' }));
    (week.kanaFocus ?? []).forEach((kana, i) => cards.push({ id: `w${w}-kana-${i + 1}`, type: 'kana', week: w, front: kana, back: `Read aloud: ${kana}`, detail: 'Recognize and pronounce this kana group.' }));
    (week.kanjiCards ?? []).forEach((k, i) => cards.push({ id: `w${w}-kanji-${i + 1}`, type: 'kanji', week: w, front: k.kanji, back: `${k.reading} — ${k.meaning}`, detail: k.whyHere ?? '' }));
  }
  return cards;
}

export function getDueCards(cards, progress, dateISO, limit = 20) {
  const state = normalizeProgress(progress);
  const due = (Array.isArray(cards) ? cards : []).filter((card) => {
    const schedule = state.flashcards[card.id];
    return !schedule || !schedule.dueDate || schedule.dueDate <= dateISO;
  });
  return due.slice(0, Math.max(0, limit));
}

function addDays(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function rateCard(progress, cardId, rating, dateISO) {
  if (!validId(cardId)) throw new TypeError('cardId must be a non-empty string');
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new RangeError(`Unknown rating: ${rating}`);
  if (!validDate(dateISO)) throw new TypeError('dateISO must be a valid YYYY-MM-DD date');
  const state = normalizeProgress(progress);
  const prior = state.flashcards[cardId];
  const repetitions = prior?.repetitions ?? 0;
  const oldInterval = prior?.intervalDays ?? 0;
  const intervalDays = rating === 'again' ? 1 : rating === 'hard' ? Math.max(2, Math.ceil(oldInterval ? oldInterval * 1.2 : 2)) : rating === 'good' ? (repetitions === 0 ? 3 : Math.max(4, Math.ceil(oldInterval * 2.5))) : (repetitions === 0 ? 5 : Math.max(7, Math.ceil(oldInterval * 3.5)));
  return { ...state, flashcards: { ...state.flashcards, [cardId]: { intervalDays, dueDate: addDays(dateISO, intervalDays), repetitions: rating === 'again' ? 0 : repetitions + 1, lastReviewed: dateISO, lastRating: rating } }, lastStudyDate: dateISO };
}

export function markLessonComplete(progress, lessonId, dateISO) {
  if (!validId(lessonId)) throw new TypeError('lessonId must be a non-empty string');
  if (!validDate(dateISO)) throw new TypeError('dateISO must be a valid YYYY-MM-DD date');
  const state = normalizeProgress(progress);
  return { ...state, completedLessonIds: [...new Set([...state.completedLessonIds, lessonId])], lastStudyDate: dateISO };
}
export function saveLessonSession(progress, lessonId, patch) {
  if (!validId(lessonId) || !isRecord(patch)) throw new TypeError('lessonId and object patch are required');
  const state = normalizeProgress(progress);
  return { ...state, lessonSessions: { ...state.lessonSessions, [lessonId]: { ...state.lessonSessions[lessonId], ...patch } } };
}
export function saveMilestone(progress, milestoneId, patch) {
  if (!validId(milestoneId) || !isRecord(patch)) throw new TypeError('milestoneId and object patch are required');
  const state = normalizeProgress(progress);
  return { ...state, milestones: { ...state.milestones, [milestoneId]: { ...state.milestones[milestoneId], ...patch } } };
}
