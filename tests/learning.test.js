import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createInitialProgress, normalizeProgress, getLessons, getCourseStats, getFlashcards, getDueCards,
  getRetrievalPrompt, rateCard, getRatingIntervals, markLessonComplete, saveLessonSession, saveMilestone,
  isKanaMastered, shouldShowRomaji,
} from '../src/renderer/learning.js';
import { kanaToRomaji } from '../src/renderer/romaji.js';
import { isKanaItemMastered } from '../src/renderer/kana-curriculum.js';

const course = JSON.parse(readFileSync(new URL('../course/course-v1.json', import.meta.url), 'utf8'));
const lessons = getLessons(course);
const milestoneIds = course.weeks.flatMap((w) => w.milestone ? [w.milestone.id] : []);
function localDateISO(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}
describe('learning state', () => {
  test('initial state and normalized course preserve all 36 lesson IDs and six milestones', () => {
    const initial = createInitialProgress();
    expect(initial).toEqual({ version: 5, completedLessonIds: [], lessonSessions: {}, milestones: {}, flashcards: {}, kanaMastery: {}, kanaRecall: {}, reviewHistory: [], lastStudyDate: null });
    const normalized = normalizeProgress({ completedLessonIds: lessons.map(({ lesson }) => lesson.id), milestones: Object.fromEntries(milestoneIds.map((id) => [id, { completed: true }])) });
    expect(normalized.completedLessonIds).toHaveLength(36);
    expect(normalized.completedLessonIds).toEqual(lessons.map(({ lesson }) => lesson.id));
    expect(Object.keys(normalized.milestones)).toEqual(milestoneIds);
  });
  test('migrates legacy progress without losing lesson, checkpoint, or card history', () => {
    const migrated = normalizeProgress({ version: 1, completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { step: 4 } }, milestones: { checkpoint: { completed: true } }, flashcards: { 'w1-phrase-1': { intervalDays: 3, dueDate: '2026-11-20', repetitions: 1, lastReviewed: '2026-11-17', lastRating: 'good' } }, lastStudyDate: '2026-11-17' });
    expect(migrated).toMatchObject({ version: 5, completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { step: 4 } }, milestones: { checkpoint: { completed: true } }, kanaRecall: {}, reviewHistory: [], lastStudyDate: '2026-11-17' });
    expect(migrated.flashcards['w1-phrase-1']).toMatchObject({ intervalDays: 3, dueDate: '2026-11-20', repetitions: 1, lastRating: 'good', easeFactor: 2.5, lapses: 0 });
  });
  test('migrates version-two progress while preserving completed lessons and review schedules', () => {
    const migrated = normalizeProgress({ version: 2, completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { step: 3, warmup: 'remembered' } }, milestones: { 'M02-introductions': { completed: true, note: 'done' } }, flashcards: { 'w1-phrase-1': { intervalDays: 3, dueDate: '2026-11-20', repetitions: 1, lastReviewed: '2026-11-17', lastRating: 'good' } }, lastStudyDate: '2026-11-17' });
    expect(migrated).toMatchObject({ version: 5, completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { step: 3, warmup: 'remembered' } }, milestones: { 'M02-introductions': { completed: true, note: 'done' } }, kanaRecall: {}, reviewHistory: [], lastStudyDate: '2026-11-17' });
    expect(migrated.flashcards['w1-phrase-1']).toMatchObject({ intervalDays: 3, dueDate: '2026-11-20', repetitions: 1, lastReviewed: '2026-11-17', introducedAt: null, lastRating: 'good' });
  });
  test('migrates version-three group kana history without treating it as item-level mastery', () => {
    const migrated = normalizeProgress({ version: 3, completedLessonIds: ['W01-L1'], kanaMastery: { 'あ': { successfulDays: ['2026-11-17'] } }, flashcards: { 'w1-phrase-1': { intervalDays: 2, dueDate: '2026-11-19', repetitions: 1, lastReviewed: '2026-11-17', lastRating: 'good' } } });
    expect(migrated).toMatchObject({ version: 5, completedLessonIds: ['W01-L1'], kanaMastery: { 'あ': { successfulDays: ['2026-11-17'] } }, kanaRecall: {}, reviewHistory: [] });
    expect(migrated.flashcards['w1-phrase-1']).toMatchObject({ intervalDays: 2, dueDate: '2026-11-19', lastRating: 'good' });
  });
  test('FSRS migration preserves legacy card IDs and due dates without fabricating history', () => {
    const legacy = { version: 4, completedLessonIds: ['W01-L1'], flashcards: {
      'w1-phrase-1': { intervalDays: 3, dueDate: '2026-11-16', repetitions: 2, lastReviewed: '2026-11-13', introducedAt: '2026-11-12', lastRating: 'good', easeFactor: 2.3, lapses: 1 },
      'w1-phrase-2': { intervalDays: 8, dueDate: '2026-11-20', repetitions: 3, lastReviewed: '2026-11-12', lastRating: 'hard' },
    } };
    const migrated = normalizeProgress(legacy);
    expect(Object.keys(migrated.flashcards)).toEqual(['w1-phrase-1', 'w1-phrase-2']);
    expect(migrated.reviewHistory).toEqual([]);
    expect(migrated.flashcards['w1-phrase-1']).toMatchObject({ dueDate: '2026-11-16', dueAt: null, fsrsCard: null, schedulerSource: 'legacy-no-history', legacySchedule: { dueDate: '2026-11-16', intervalDays: 3, repetitions: 2, lastRating: 'good' } });
    expect(migrated.flashcards['w1-phrase-2']).toMatchObject({ dueDate: '2026-11-20', dueAt: null, fsrsCard: null, schedulerSource: 'legacy-no-history' });
    expect(normalizeProgress(migrated)).toEqual(migrated);
    const cards = [{ id: 'w1-phrase-1', lessonIds: ['W01-L1'] }, { id: 'w1-phrase-2', lessonIds: ['W01-L1'] }];
    expect(getDueCards(cards, migrated, '2026-11-17')).toEqual([cards[0]]);
  });
  test('a brand-new learner has no recall prompt and the opening lesson has a concrete goal', () => {
    expect(getRetrievalPrompt(course, createInitialProgress(), 'W01-L1')).toBeNull();
    expect(lessons[0].lesson.goal).toBe('Say hello back when someone greets you, then offer your name in a short first meeting.');
    expect(course.weeks[0].lessons[0].scene).toContain('You do not need to understand every word yet');
  });
  test('starting a lesson without completing it does not create a recall prompt', () => {
    const started = saveLessonSession(createInitialProgress(), 'W01-L1', { startedAt: '2026-11-17T00:00:00.000Z' });
    expect(getRetrievalPrompt(course, started, 'W02-L1')).toBeNull();
  });
  test('an uncompleted previous week is not used as review when older completed material exists', () => {
    let state = markLessonComplete(createInitialProgress(), 'W01-L1', '2026-11-17');
    state = saveLessonSession(state, 'W02-L1', { startedAt: '2026-11-18T00:00:00.000Z' });
    const prompt = getRetrievalPrompt(course, state, 'W03-L1');
    expect(prompt).toMatchObject({ week: 1, phrase: course.weeks[0].phraseBank[0] });
    expect(prompt.context).toContain('revisit');
  });
  test('stats report ordered next lesson, completion, weeks, and original milestones', () => {
    const state = markLessonComplete(createInitialProgress(), 'W01-L1', '2026-11-17');
    const stats = getCourseStats(course, state);
    expect(stats).toMatchObject({ totalLessons: 36, completedLessons: 1, percent: 3, completedWeeks: 0, totalWeeks: 12 });
    expect(stats.nextLesson).toEqual(lessons[1]);
    expect(stats.milestones.map((m) => m.id)).toEqual(milestoneIds);
    expect(stats.milestones[0].completed).toBe(false);
  });
  test('existing card IDs stay stable and dialogue lines add practice cards', () => {
    const cards = getFlashcards(course);
    expect(cards).toEqual(getFlashcards(course));
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    const phrase = cards.find((c) => c.type === 'phrase');
    expect(phrase).toMatchObject({ id: 'w1-phrase-1', front: course.weeks[0].phraseBank[0].ja, back: course.weeks[0].phraseBank[0].en });
    const kana = cards.find((c) => c.type === 'kana');
    expect(kana.front).toBe('あいうえお'); expect(kana.back).toContain('あいうえお');
    const kanji = cards.find((c) => c.type === 'kanji');
    expect(kanji.front).toBe('人'); expect(kanji.back).toContain('ひと'); expect(kanji.back).toContain('person'); expect(kanji.detail).toContain('signs');
    expect(cards.find((c) => c.id === 'W01-L1-line-1')).toMatchObject({ type: 'dialogue', front: course.weeks[0].lessons[0].dialogue[0].ja });
  });
  test('individual kana ratings use the shared SRS and require distinct-day recall without completing a conversation lesson', () => {
    const cards = getFlashcards(course);
    const card = cards.find((item) => item.id === 'kana-hira-vowels-k-3042');
    expect(card).toMatchObject({ type: 'kana', kanaItem: true, srsOnly: true, front: 'あ', back: 'a', lessonIds: ['W01-L1'] });
    expect(getCourseStats(course, createInitialProgress()).completedLessons).toBe(0);
    expect(getDueCards([card], createInitialProgress(), '2026-11-17')).toEqual([]);

    let state = rateCard(createInitialProgress(), card.id, 'good', '2026-11-17', card);
    expect(state.kanaRecall[card.id]).toMatchObject({ attempts: 1, correct: 1, successfulDays: ['2026-11-17'], lastPracticed: '2026-11-17' });
    expect(isKanaItemMastered(state, { id: card.id })).toBe(false);
    const dueAt = new Date(state.flashcards[card.id].dueAt);
    expect(getDueCards([card], state, localDateISO(dueAt))).toEqual([]);
    expect(getDueCards([card], state, localDateISO(dueAt), 20, new Date(dueAt.getTime() - 1))).toEqual([]);
    expect(getDueCards([card], state, localDateISO(dueAt), 20, dueAt)).toEqual([card]);

    state = rateCard(state, card.id, 'easy', '2026-11-17', card);
    expect(state.kanaRecall[card.id].successfulDays).toEqual(['2026-11-17']);
    state = rateCard(state, card.id, 'good', '2026-11-20', card);
    expect(isKanaItemMastered(state, { id: card.id })).toBe(true);
    expect(getCourseStats(course, state).completedLessons).toBe(0);
  });
  test('kanji review cards include reciprocal meaning prompts, contextual readings, and lesson-based SRS introduction', () => {
    const cards = getFlashcards(course);
    const recognition = cards.find((card) => card.type === 'kanji' && !card.srsOnly);
    const production = cards.find((card) => card.id === `${recognition.id}-meaning`);
    expect(recognition.lessonIds.length).toBeGreaterThan(0);
    expect(recognition).toMatchObject({ type: 'kanji', front: '人', reading: 'ひと', back: 'ひと — person' });
    expect(recognition.detail).not.toBe('');
    expect(production).toMatchObject({ type: 'kanji', front: recognition.back.split(' — ').at(-1), back: recognition.front, reading: recognition.reading, srsOnly: true, recallDirection: 'produce' });
    expect(production.lessonIds).toEqual(recognition.lessonIds);

    const lessonId = recognition.lessonIds[0];
    const introduced = markLessonComplete(createInitialProgress(), lessonId, '2026-11-17', cards);
    expect(introduced.flashcards[recognition.id].introducedAt).toBe('2026-11-17');
    expect(introduced.flashcards[production.id].introducedAt).toBe('2026-11-17');
    const due = getDueCards(cards, introduced, '2026-11-18');
    expect(due).toContain(recognition);
    expect(due).toContain(production);
  });
  test('untouched cards are not due and reviewed cards return on their scheduled day', () => {
    const cards = getFlashcards(course).slice(0, 4);
    const state = rateCard(createInitialProgress(), cards[0].id, 'good', '2026-11-17', cards[0]);
    const dueAt = new Date(state.flashcards[cards[0].id].dueAt);
    const beforeDue = new Date(dueAt.getTime() - 1);
    expect(getDueCards(cards, state, localDateISO(beforeDue), 20, beforeDue)).toEqual([]);
    expect(getDueCards(cards, state, localDateISO(dueAt), 20, dueAt)).toEqual([cards[0]]);
    expect(getDueCards(cards, state, localDateISO(dueAt), 2, dueAt)).toEqual([cards[0]]);
  });
  test('lesson cards are introduced at completion and first become due the following day', () => {
    const cards = getFlashcards(course);
    const state = markLessonComplete(createInitialProgress(), 'W01-L1', '2026-11-17', cards);
    const introduced = cards.filter((card) => state.flashcards[card.id]?.introducedAt === '2026-11-17');
    expect(introduced.length).toBeGreaterThan(0);
    expect(introduced.every((card) => card.lessonId === 'W01-L1' || card.lessonIds?.includes('W01-L1'))).toBe(true);
    expect(getDueCards(cards, state, '2026-11-17')).toEqual([]);
    expect(getDueCards(cards, state, '2026-11-18', 1000)).toEqual(introduced);
    expect(introduced.some((card) => card.id === 'W01-L2-line-1')).toBe(false);
  });
  test('version-two completed lessons remain review-eligible without exposing uncompleted lessons', () => {
    const cards = getFlashcards(course);
    const migrated = normalizeProgress({ version: 2, completedLessonIds: ['W01-L1'], lastStudyDate: '2026-11-17' });
    const due = getDueCards(cards, migrated, '2026-11-18');
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((card) => card.lessonId === 'W01-L1' || card.lessonIds?.includes('W01-L1'))).toBe(true);
    expect(due.some((card) => card.id === 'W01-L2-line-1')).toBe(false);
  });
  test('weak and failed items are prioritized before fresh cards in the due queue', () => {
    const cards = getFlashcards(course).slice(0, 4);
    const state = rateCard(createInitialProgress(), cards[2].id, 'again', '2026-11-17', cards[2]);
    expect(getDueCards(cards, state, '2026-11-17')).toEqual([]);
    expect(getDueCards(cards, state, '2026-11-18', 1, new Date(state.flashcards[cards[2].id].dueAt))).toEqual([cards[2]]);
  });
  test('successful review clears a phrase’s extra weak-retrieval priority', () => {
    const cards = getFlashcards(course).filter((card) => card.id === 'w1-phrase-1' || card.id === 'w1-phrase-2');
    let state = saveLessonSession(createInitialProgress(), 'W01-L1', { weakCardIds: ['w1-phrase-2'] });
    state = rateCard(state, 'w1-phrase-2', 'good', '2026-11-17');
    state = markLessonComplete(state, 'W01-L1', '2026-11-17', cards);
    expect(getRetrievalPrompt(course, state, 'W01-L2').phrase).toEqual(course.weeks[0].phraseBank[0]);
    expect(getDueCards(cards, state, '2026-11-18', 1)).toEqual([cards[0]]);
  });
  test('weekly interleave uses the previous week in the current changed scene', () => {
    const progress = markLessonComplete(createInitialProgress(), 'W01-L1', '2026-11-17');
    const prompt = getRetrievalPrompt(course, progress, 'W02-L1');
    expect(prompt).toMatchObject({ type: 'weekly', week: 1, phrase: course.weeks[0].phraseBank[0] });
    expect(prompt.context).toContain(course.weeks[1].lessons[0].scene);
  });
  test('long-spaced review chooses a weak phrase from two to four weeks earlier', () => {
    let state = markLessonComplete(createInitialProgress(), 'W02-L2', '2026-11-17');
    state = rateCard(state, 'w2-phrase-6', 'again', '2026-11-17');
    const prompt = getRetrievalPrompt(course, state, 'W05-L3');
    expect(prompt).toMatchObject({ type: 'spaced', week: 2, phrase: course.weeks[1].phraseBank[5] });
  });
  test('a phrase missed in response practice is prioritized at the next lesson recall', () => {
    let state = saveLessonSession(createInitialProgress(), 'W01-L1', { weakCardIds: ['w1-phrase-2'] });
    state = markLessonComplete(state, 'W01-L1', '2026-11-17');
    const prompt = getRetrievalPrompt(course, state, 'W01-L2');
    expect(prompt.phrase).toEqual(course.weeks[0].phraseBank[1]);
  });
  test('a remembered phrase is replaced by a different phrase next lesson', () => {
    let state = saveLessonSession(createInitialProgress(), 'W01-L1', { warmup: 'remembered' });
    state = markLessonComplete(state, 'W01-L1', '2026-11-17');
    const prompt = getRetrievalPrompt(course, state, 'W01-L2');
    expect(prompt.type).toBe('lesson');
    expect(prompt.phrase).toEqual(course.weeks[0].phraseBank[1]);
  });
  test('FSRS-7 previews four ratings and persists serializable memory states and review events', () => {
    const date = '2026-11-17';
    const now = new Date('2026-11-17T12:00:00.000Z');
    const intervals = getRatingIntervals(createInitialProgress(), 'w1-phrase-1', date, now);
    expect(Object.keys(intervals).sort()).toEqual(['again', 'easy', 'good', 'hard']);
    expect(intervals.again).toBe('1m');
    expect(new Set(Object.values(intervals)).size).toBe(4);

    const first = rateCard(createInitialProgress(), 'w1-phrase-1', 'good', date, null, now);
    const schedule = first.flashcards['w1-phrase-1'];
    expect(schedule).toMatchObject({ schedulerSource: 'fsrs-7', lastReviewed: date, lastRating: 'good', repetitions: 1 });
    expect(schedule.fsrsCard).toMatchObject({ cardId: 'w1-phrase-1', scheduleStatus: 'review', state: 2, reps: 1, lastReviewAt: now.toISOString() });
    expect(schedule.fsrsCard.stability).toBeGreaterThan(0);
    expect(schedule.dueAt).toBe(schedule.fsrsCard.dueAt);
    expect(first.reviewHistory).toHaveLength(1);
    expect(first.reviewHistory[0]).toMatchObject({ cardId: 'w1-phrase-1', rating: 3, reviewTime: now.toISOString() });

    const nextDueAt = new Date(schedule.dueAt);
    const second = rateCard(first, 'w1-phrase-1', 'good', localDateISO(nextDueAt), null, nextDueAt);
    expect(second.flashcards['w1-phrase-1'].fsrsCard.reps).toBe(2);
    expect(second.reviewHistory).toHaveLength(2);
    expect(second.reviewHistory[1].reviewTime).toBe(nextDueAt.toISOString());
    expect(normalizeProgress(JSON.parse(JSON.stringify(second)))).toEqual(second);
    expect(() => rateCard(createInitialProgress(), 'c', 'bad', date)).toThrow();
  });
  test('Again returns after its one-minute FSRS step and is not due before the exact timestamp', () => {
    const card = { id: 'w1-phrase-1' };
    const reviewedAt = new Date('2026-11-17T10:00:00.000Z');
    const first = rateCard(createInitialProgress(), card.id, 'again', '2026-11-17', card, reviewedAt);
    const dueAt = new Date(first.flashcards[card.id].dueAt);
    expect(dueAt.toISOString()).toBe('2026-11-17T10:01:00.000Z');
    expect(first.flashcards[card.id].fsrsCard.scheduleStatus).toBe('learning');
    expect(getDueCards([card], first, '2026-11-17')).toEqual([]);
    expect(getDueCards([card], first, '2026-11-17', 20, new Date(dueAt.getTime() - 1))).toEqual([]);
    expect(getDueCards([card], first, '2026-11-17', 20, dueAt)).toEqual([card]);

    const second = rateCard(first, card.id, 'again', '2026-11-17', card, dueAt);
    expect(second.reviewHistory).toHaveLength(2);
    expect(second.reviewHistory[1]).toMatchObject({ cardId: card.id, reviewTime: dueAt.toISOString(), rating: 1 });
    expect(second.flashcards[card.id].fsrsCard.cardId).toBe(card.id);
  });
  test('kana romaji support follows two successful reviews on separate days and returns after difficulty', () => {
    const card = getFlashcards(course).find((item) => item.type === 'kana');
    let state = rateCard(createInitialProgress(), card.id, 'good', '2026-11-17', card);
    expect(shouldShowRomaji(card.front, state, 'adaptive')).toBe(true);
    state = rateCard(state, card.id, 'easy', '2026-11-17', card);
    expect(shouldShowRomaji(card.front, state, 'adaptive')).toBe(true);
    state = rateCard(state, card.id, 'good', '2026-11-20', card);
    expect(isKanaMastered(state, card.front)).toBe(true);
    expect(shouldShowRomaji(card.front, state, 'adaptive')).toBe(false);
    expect(shouldShowRomaji(card.front, state, 'always')).toBe(true);
    expect(shouldShowRomaji(card.front, state, 'hidden')).toBe(false);
    state = rateCard(state, card.id, 'hard', '2026-11-23', card);
    expect(shouldShowRomaji(card.front, state, 'adaptive')).toBe(true);
  });
  test('kana-to-romaji handles basic kana, digraphs, small tsu, long marks and avoids kanji guesses', () => {
    expect(kanaToRomaji('こんにちは。')).toBe('konnichiha。');
    expect(kanaToRomaji('きょうはちょっと')).toBe('kyouh achotto'.replace(' ', ''));
    expect(kanaToRomaji('オーストラリア')).toBe('oosutoraria');
    expect(kanaToRomaji('ほん')).toBe('hon');
    expect(kanaToRomaji('っ')).toBe('っ');
    expect(kanaToRomaji('東京駅')).toBe('');
  });
  test('completion, session, and milestone updates are immutable merges', () => {
    const original = createInitialProgress();
    const completed = markLessonComplete(original, 'W01-L1', '2026-11-17');
    expect(original.completedLessonIds).toEqual([]); expect(completed.completedLessonIds).toEqual(['W01-L1']);
    expect(markLessonComplete(completed, 'W01-L1', '2026-11-17').completedLessonIds).toEqual(['W01-L1']);
    const session = saveLessonSession(completed, 'W01-L1', { step: 2 });
    const session2 = saveLessonSession(session, 'W01-L1', { answer: 'yes' });
    expect(session.lessonSessions['W01-L1']).toEqual({ step: 2 });
    expect(session2.lessonSessions['W01-L1']).toEqual({ step: 2, answer: 'yes' });
    const milestone = saveMilestone(createInitialProgress(), 'M02-introductions', { completed: true });
    const milestone2 = saveMilestone(milestone, 'M02-introductions', { note: 'done' });
    expect(milestone2.milestones['M02-introductions']).toEqual({ completed: true, note: 'done' });
    expect(getCourseStats(course, milestone2).milestones[0].completed).toBe(true);
  });
  test('malformed state falls back safely while retaining valid records', () => {
    const state = normalizeProgress({ completedLessonIds: ['W01-L1', '', 2, 'W01-L1'], lessonSessions: { x: { cursor: 2 }, bad: null }, milestones: [], flashcards: { ok: { intervalDays: -2, dueDate: 'not-date', repetitions: -1, lastRating: 'wat' }, nope: 3 }, lastStudyDate: '2025-02-30', version: 900 });
    expect(state).toEqual({ version: 5, completedLessonIds: ['W01-L1'], lessonSessions: { x: { cursor: 2 } }, milestones: {}, flashcards: { ok: { intervalDays: 0, dueDate: null, dueAt: null, repetitions: 0, lastReviewed: null, introducedAt: null, lastRating: null, easeFactor: 2.5, lapses: 0, fsrsCard: null, legacySchedule: null, schedulerSource: null } }, kanaMastery: {}, kanaRecall: {}, reviewHistory: [], lastStudyDate: null });
    expect(normalizeProgress(null)).toEqual(createInitialProgress());
  });
  test('malformed weak-item IDs are discarded without breaking lesson recall', () => {
    const state = normalizeProgress({ completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { weakCardIds: { unexpected: true } } } });
    expect(state.lessonSessions['W01-L1'].weakCardIds).toEqual([]);
    expect(getRetrievalPrompt(course, state, 'W01-L2').phrase).toEqual(course.weeks[0].phraseBank[0]);
  });
  test('one-minute learning due timestamps remain exact across a UTC year boundary', () => {
    const now = new Date('2025-12-31T23:59:30.000Z');
    const state = rateCard(createInitialProgress(), 'x', 'again', '2025-12-31', null, now);
    expect(state.flashcards.x.dueAt).toBe('2026-01-01T00:00:30.000Z');
    expect(state.flashcards.x.dueDate).toBe(localDateISO(state.flashcards.x.dueAt));
  });
});
