import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createInitialProgress, normalizeProgress, getLessons, getCourseStats, getFlashcards, getDueCards, getRetrievalPrompt, rateCard, markLessonComplete, saveLessonSession, saveMilestone } from '../src/renderer/learning.js';

const course = JSON.parse(readFileSync(new URL('../course/course-v1.json', import.meta.url), 'utf8'));
const lessons = getLessons(course);
const milestoneIds = course.weeks.flatMap((w) => w.milestone ? [w.milestone.id] : []);

describe('learning state', () => {
  test('initial state and normalized course preserve all 36 lesson IDs and six milestones', () => {
    const initial = createInitialProgress();
    expect(initial).toEqual({ version: 1, completedLessonIds: [], lessonSessions: {}, milestones: {}, flashcards: {}, lastStudyDate: null });
    const normalized = normalizeProgress({ completedLessonIds: lessons.map(({ lesson }) => lesson.id), milestones: Object.fromEntries(milestoneIds.map((id) => [id, { completed: true }])) });
    expect(normalized.completedLessonIds).toHaveLength(36);
    expect(normalized.completedLessonIds).toEqual(lessons.map(({ lesson }) => lesson.id));
    expect(Object.keys(normalized.milestones)).toEqual(milestoneIds);
  });
  test('stats report ordered next lesson, completion, weeks, and original milestones', () => {
    const state = markLessonComplete(createInitialProgress(), 'W01-L1', '2026-11-17');
    const stats = getCourseStats(course, state);
    expect(stats).toMatchObject({ totalLessons: 36, completedLessons: 1, percent: 3, completedWeeks: 0, totalWeeks: 12 });
    expect(stats.nextLesson).toEqual(lessons[1]);
    expect(stats.milestones.map((m) => m.id)).toEqual(milestoneIds);
    expect(stats.milestones[0].completed).toBe(false);
  });
  test('cards have stable unique ids and correct prompt direction', () => {
    const cards = getFlashcards(course);
    expect(cards).toEqual(getFlashcards(course));
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    const phrase = cards.find((c) => c.type === 'phrase');
    expect(phrase).toMatchObject({ front: course.weeks[0].phraseBank[0].ja, back: course.weeks[0].phraseBank[0].en });
    const kana = cards.find((c) => c.type === 'kana');
    expect(kana.front).toBe('あいうえお'); expect(kana.back).toContain('あいうえお');
    const kanji = cards.find((c) => c.type === 'kanji');
    expect(kanji.front).toBe('人'); expect(kanji.back).toContain('ひと'); expect(kanji.back).toContain('person'); expect(kanji.detail).toContain('signs');
  });
  test('unscheduled cards are due in order and scheduled future cards are withheld', () => {
    const cards = getFlashcards(course).slice(0, 4);
    let state = rateCard(createInitialProgress(), cards[0].id, 'good', '2026-11-17');
    expect(getDueCards(cards, state, '2026-11-19')).toEqual(cards.slice(1));
    expect(getDueCards(cards, state, '2026-11-20')).toEqual(cards);
    expect(getDueCards(cards, state, '2026-11-20', 2)).toEqual(cards.slice(0, 2));
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
  test('a remembered phrase is replaced by a different phrase next lesson', () => {
    let state = saveLessonSession(createInitialProgress(), 'W01-L1', { warmup: 'remembered' });
    state = markLessonComplete(state, 'W01-L1', '2026-11-17');
    const prompt = getRetrievalPrompt(course, state, 'W01-L2');
    expect(prompt.type).toBe('lesson');
    expect(prompt.phrase).toEqual(course.weeks[0].phraseBank[1]);
  });
  test('each rating has deterministic intervals and UTC due date', () => {
    const date = '2026-11-17';
    const want = { again: [1, '2026-11-18', 0], hard: [2, '2026-11-19', 1], good: [3, '2026-11-20', 1], easy: [5, '2026-11-22', 1] };
    for (const [rating, expected] of Object.entries(want)) {
      const result = rateCard(createInitialProgress(), 'card', rating, date).flashcards.card;
      expect([result.intervalDays, result.dueDate, result.repetitions]).toEqual(expected);
      expect(result.lastReviewed).toBe(date); expect(result.lastRating).toBe(rating);
      expect(rateCard(createInitialProgress(), 'card', rating, date).lastStudyDate).toBe(date);
    }
    const subsequent = rateCard(rateCard(createInitialProgress(), 'c', 'good', date), 'c', 'good', date).flashcards.c;
    expect(subsequent.intervalDays).toBe(8);
    expect(() => rateCard(createInitialProgress(), 'c', 'bad', date)).toThrow();
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
    expect(state).toEqual({ version: 1, completedLessonIds: ['W01-L1'], lessonSessions: { x: { cursor: 2 } }, milestones: {}, flashcards: { ok: { intervalDays: 0, dueDate: null, repetitions: 0, lastReviewed: null, lastRating: null } }, lastStudyDate: null });
    expect(normalizeProgress(null)).toEqual(createInitialProgress());
  });
  test('UTC arithmetic handles leap day and year boundary', () => {
    expect(rateCard(createInitialProgress(), 'x', 'good', '2024-02-27').flashcards.x.dueDate).toBe('2024-03-01');
    expect(rateCard(createInitialProgress(), 'x', 'again', '2025-12-31').flashcards.x.dueDate).toBe('2026-01-01');
  });
});
