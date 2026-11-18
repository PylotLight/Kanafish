import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const course = JSON.parse(readFileSync(new URL('../course/course-v1.json', import.meta.url), 'utf8'))
const expectedMilestones = [
  'M02-introductions',
  'M04-transactions',
  'M06-preferences',
  'M08-directions-plans',
  'M10-repair-help',
  'M12-integrated-conversation'
]

test('the published course backbone and checkpoint IDs remain stable', () => {
  expect(course.courseId).toBe('kanafish-ja-travel-a1')
  expect(course.schemaVersion).toBe('1.1.0')
  expect(course.durationWeeks).toBe(12)
  expect(course.sessionsPerWeek).toBe(3)
  expect(course.weeks).toHaveLength(12)
  expect(course.weeks.flatMap((week) => week.milestone ? [week.milestone.id] : [])).toEqual(expectedMilestones)
  expect(course.learningPath.map((phase) => phase.title)).toEqual(['Find your first words', 'Handle everyday needs', 'Get around', 'Keep the conversation moving'])
  expect(course.learningPath.flatMap((phase) => phase.weeks)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
  expect(course.learningPath.every((phase) => phase.outcome.length > 0)).toBe(true)
})

test('all 36 lessons retain their IDs, weekly order, and recognize/respond/adapt arc', () => {
  const lessons = course.weeks.flatMap((week) => week.lessons.map((lesson) => ({ week, lesson })))
  expect(lessons).toHaveLength(36)
  expect(new Set(lessons.map(({ lesson }) => lesson.id)).size).toBe(36)
  lessons.forEach(({ week, lesson }, index) => {
    const weekNumber = Math.floor(index / 3) + 1
    const lessonNumber = (index % 3) + 1
    expect(week.week).toBe(weekNumber)
    expect(lesson.id).toBe(`W${String(weekNumber).padStart(2, '0')}-L${lessonNumber}`)
    expect(lesson.stage).toBe(['recognize', 'supported-response', 'adapt'][lessonNumber - 1])
    expect(lesson.goal.trim().length).toBeGreaterThan(0)
    expect(lesson.dialogue.length).toBeGreaterThanOrEqual(2)
    expect(lesson.successChecks.length).toBeGreaterThan(0)
    expect(lesson.listenCheck.answer).toBeGreaterThanOrEqual(0)
    expect(lesson.listenCheck.answer).toBeLessThan(lesson.listenCheck.choices.length)
    expect(lesson.responsePractice.answer == null || lesson.responsePractice.answer < lesson.responsePractice.choices.length).toBe(true)
  })
})

test('the opening scene addresses a true beginner without claiming prior lesson knowledge', () => {
  const firstLesson = course.weeks[0].lessons[0]
  expect(firstLesson.id).toBe('W01-L1')
  expect(firstLesson.goal).toContain('Return a simple greeting')
  expect(firstLesson.scene).toContain('You do not need to understand every word yet')
  expect(firstLesson.dialogue.length).toBeGreaterThanOrEqual(2)
})

test('the final travel mission retains its open-ended response with no answer menu', () => {
  const finalLesson = course.weeks.at(-1).lessons.at(-1)
  expect(finalLesson.id).toBe('W12-L3')
  expect(finalLesson.responsePractice.choices).toEqual([])
  expect(finalLesson.responsePractice.answer).toBeNull()
  expect(finalLesson.responsePractice.prompt).toContain('without a fixed answer menu')
})
