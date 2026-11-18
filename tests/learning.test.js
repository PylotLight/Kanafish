import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createInitialProgress, normalizeProgress, getLessons, getCourseStats, getFlashcards, getDueCards,
  getRetrievalPrompt, rateCard, getRatingIntervals, markLessonComplete, saveLessonSession, saveMilestone,
  isKanaMastered, shouldShowRomaji,
} from '../src/renderer/learning.js';
import { kanaToRomaji } from '../src/renderer/romaji.js';

const course = JSON.parse(readFileSync(new URL('../course/course-v1.json', import.meta.url), 'utf8'));
const lessons = getLessons(course);
const milestoneIds = course.weeks.flatMap((w) => w.milestone ? [w.milestone.id] : []);

 describe('learning state', () => {
  test('initial state and normalized course preserve all 36 lesson IDs and six milestones', () => {
    const initial = createInitialProgress();
    expect(initial).toEqual({ version: 2, completedLessonIds: [], lessonSessions: {}, milestones: {}, flashcards: {}, kanaMastery: {}, lastStudyDate: null });
    const normalized = normalizeProgress({ completedLessonIds: lessons.map(({ lesson }) => lesson.id), milestones: Object.fromEntries(milestoneIds.map((id) => [id, { completed: true }])) });
    expect(normalized.completedLessonIds).toHaveLength(36);
    expect(normalized.completedLessonIds).toEqual(lessons.map(({ lesson }) => lesson.id));
    expect(Object.keys(normalized.milestones)).toEqual(milestoneIds);
  });
  test('migrates legacy progress without losing lesson, checkpoint, or card history', () => {
    const migrated = normalizeProgress({ version: 1, completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { step: 4 } }, milestones: { checkpoint: { completed: true } }, flashcards: { 'w1-phrase-1': { intervalDays: 3, dueDate: '2026-11-20', repetitions: 1, lastReviewed: '2026-11-17', lastRating: 'good' } }, lastStudyDate: '2026-11-17' });
    expect(migrated).toMatchObject({ version: 2, completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { step: 4 } }, milestones: { checkpoint: { completed: true } }, lastStudyDate: '2026-11-17' });
    expect(migrated.flashcards['w1-phrase-1']).toMatchObject({ intervalDays: 3, dueDate: '2026-11-20', repetitions: 1, lastRating: 'good', easeFactor: 2.5, lapses: 0 });
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
  test('unscheduled cards are due in order and scheduled future cards are withheld', () => {
    const cards = getFlashcards(course).slice(0, 4);
    const state = rateCard(createInitialProgress(), cards[0].id, 'good', '2026-11-17', cards[0]);
    expect(getDueCards(cards, state, '2026-11-19')).toEqual(cards.slice(1));
    expect(getDueCards(cards, state, '2026-11-20')).toEqual(cards);
    expect(getDueCards(cards, state, '2026-11-20', 2)).toEqual(cards.slice(0, 2));
  });
  test('weak and failed items are prioritized before fresh cards in the due queue', () => {
    const cards = getFlashcards(course).slice(0, 4);
    const state = rateCard(createInitialProgress(), cards[2].id, 'again', '2026-11-17', cards[2]);
    expect(getDueCards(cards, state, '2026-11-18', 1)).toEqual([cards[2]]);
  });
  test('successful review clears a phrase’s extra weak-retrieval priority', () => {
    let state = saveLessonSession(createInitialProgress(), 'W01-L1', { weakCardIds: ['w1-phrase-2'] });
    state = rateCard(state, 'w1-phrase-2', 'good', '2026-11-17');
    state = markLessonComplete(state, 'W01-L1', '2026-11-17');
    expect(getRetrievalPrompt(course, state, 'W01-L2').phrase).toEqual(course.weeks[0].phraseBank[0]);
    const cards = getFlashcards(course).filter((card) => card.id === 'w1-phrase-1' || card.id === 'w1-phrase-2');
    expect(getDueCards(cards, state, '2026-11-20', 1)).toEqual([cards[0]]);
  });
  test('weekly interleave uses the previous week in the current changed scene', () => {
    const prompt = getRetrievalPrompt(course, createInitialProgress(), 'W02-L1');
    expect(prompt).toMatchObject({ type: 'weekly', week: 1, phrase: course.weeks[0].phraseBank[0] });
    expect(prompt.context).toContain(course.weeks[1].lessons[0].scene);
  });
  test('long-spaced review chooses a weak phrase from two to four weeks earlier', () => {
    const state = rateCard(createInitialProgress(), 'w2-phrase-2', 'again', '2026-11-17');
    const prompt = getRetrievalPrompt(course, state, 'W05-L3');
    expect(prompt).toMatchObject({ type: 'spaced', week: 2, phrase: course.weeks[1].phraseBank[1] });
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
  test('each rating has deterministic intervals, ease adaptation, and UTC due date', () => {
    const date = '2026-11-17';
    const want = { again: [1, '2026-11-18', 0, 1], hard: [2, '2026-11-19', 1, 0], good: [3, '2026-11-20', 1, 0], easy: [5, '2026-11-22', 1, 0] };
    for (const [rating, expected] of Object.entries(want)) {
      const result = rateCard(createInitialProgress(), 'card', rating, date).flashcards.card;
      expect([result.intervalDays, result.dueDate, result.repetitions, result.lapses]).toEqual(expected);
      expect(result.lastReviewed).toBe(date); expect(result.lastRating).toBe(rating);
      expect(rateCard(createInitialProgress(), 'card', rating, date).lastStudyDate).toBe(date);
    }
    const firstGoodReview = rateCard(createInitialProgress(), 'c', 'good', date);
    const subsequent = rateCard(firstGoodReview, 'c', 'good', date).flashcards.c;
    expect(subsequent.intervalDays).toBe(8);
    expect(getRatingIntervals(createInitialProgress(), 'c', date)).toEqual({ again: 1, hard: 2, good: 3, easy: 5 });
    expect(() => rateCard(createInitialProgress(), 'c', 'bad', date)).toThrow();
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
    expect(state).toEqual({ version: 2, completedLessonIds: ['W01-L1'], lessonSessions: { x: { cursor: 2 } }, milestones: {}, flashcards: { ok: { intervalDays: 0, dueDate: null, repetitions: 0, lastReviewed: null, lastRating: null, easeFactor: 2.5, lapses: 0 } }, kanaMastery: {}, lastStudyDate: null });
    expect(normalizeProgress(null)).toEqual(createInitialProgress());
  });
  test('malformed weak-item IDs are discarded without breaking lesson recall', () => {
    const state = normalizeProgress({ completedLessonIds: ['W01-L1'], lessonSessions: { 'W01-L1': { weakCardIds: { unexpected: true } } } });
    expect(state.lessonSessions['W01-L1'].weakCardIds).toEqual([]);
    expect(getRetrievalPrompt(course, state, 'W01-L2').phrase).toEqual(course.weeks[0].phraseBank[0]);
  });
  test('UTC arithmetic handles leap day and year boundary', () => {
    expect(rateCard(createInitialProgress(), 'x', 'good', '2024-02-27').flashcards.x.dueDate).toBe('2024-03-01');
    expect(rateCard(createInitialProgress(), 'x', 'again', '2025-12-31').flashcards.x.dueDate).toBe('2026-01-01');
  });
});
