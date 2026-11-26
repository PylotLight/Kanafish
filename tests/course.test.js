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
const originalPhrasePrefixes = [
  ['こんにちは。', 'すみません。', 'ありがとうございます。', 'お願いします。'],
  ['はじめまして。', 'わたしは [なまえ] です。', '[くに] からきました。', 'よろしくおねがいします。'],
  ['これはなんですか。', '[ばしょ] はどこですか。', 'もういちどおねがいします。', 'ゆっくりおねがいします。'],
  ['コーヒーをください。', 'メニューをおねがいします。', 'ここでたべます。', 'いくらですか。'],
  ['これをひとつください。', 'ふたつください。', 'カードでおねがいします。', 'ふくろはいりますか。'],
  ['おすすめはなんですか。', 'これがすきです。', 'あまいものがすきです。', '[たべもの] のアレルギーがあります。たべられません。'],
  ['えきはどこですか。', 'まっすぐいってください。', 'みぎにまがってください。', 'ここからちかいですか。'],
  ['なんじですか。', 'さんじにあいましょう。', 'どのくらいかかりますか。', 'もういちどかくにんします。'],
  ['きょう、[ばしょ] にいきます。', 'きのう、[こと] をしました。', 'それから、[こと] をしました。', 'とてもたのしかったです。'],
  ['たすけてください。', 'さいふをなくしました。', 'もういちどおねがいできますか。', 'えいごをはなせますか。'],
  ['そうですか。', 'では、[あたらしいこと] でおねがいします。', 'それはどこですか。', 'かくにんしてもいいですか。'],
  ['まず、[こと] をおねがいします。', 'それから、[しつもん]。', 'もういちどおねがいします。', 'わかりました。ありがとうございます。']
]

test('the published course backbone and checkpoint IDs remain stable', () => {
  expect(course.courseId).toBe('kanafish-ja-travel-a1')
  expect(course.schemaVersion).toBe('1.2.0')
  expect(course.durationWeeks).toBe(12)
  expect(course.sessionsPerWeek).toBe(3)
  expect(course.weeks).toHaveLength(12)
  expect(course.weeks.flatMap((week) => week.milestone ? [week.milestone.id] : [])).toEqual(expectedMilestones)
  expect(course.learningPath.map((phase) => phase.title)).toEqual(['Meet people and find your first words', 'Describe, travel, and connect actions', 'Talk about people and share stories', 'Make plans, share experiences, and get help'])
  expect(course.learningPath.flatMap((phase) => phase.weeks)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
  expect(course.learningPath.every((phase) => phase.outcome.length > 0)).toBe(true)
  expect(course.courseAlignment).toContain('GENKI I (Third Edition)')
  expect(course.courseAlignment).toContain('not affiliated')
})

test('the original weekly phrase-card prefixes keep their stored review IDs', () => {
  expect(course.weeks.map((week) => week.phraseBank.slice(0, 4).map((phrase) => phrase.ja))).toEqual(originalPhrasePrefixes)
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
  expect(firstLesson.goal).toContain('Say hello back')
  expect(firstLesson.scene).toContain('You do not need to understand every word yet')
  expect(firstLesson.dialogue.length).toBeGreaterThanOrEqual(2)
})

test('the opening conversations practise the complete core kana alongside useful spoken exchanges', () => {
  const hira = course.weeks[0].kanaFocus.join('')
  const kata = course.weeks[1].kanaFocus.join('')
  const contains = (text, required) => [...required].every((character) => text.includes(character))
  expect(contains(hira, 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん')) .toBe(true)
  expect(contains(hira, 'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽきゃきゅきょしゃしゅしょちゃちゅちょにゃにゅにょひゃひゅひょみゃみゅみょりゃりゅりょぎゃぎゅぎょじゃじゅじょびゃびゅびょぴゃぴゅぴょっ')).toBe(true)
  expect(contains(kata, 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン')).toBe(true)
  expect(contains(kata, 'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポキャキュキョシャシュショチャチュチョニャニュニョヒャヒュヒョミャミュミョリャリュリョギャギュギョジャジュジョビャビュビョピャピュピョッーァィゥェォ')).toBe(true)
  expect(course.weeks.slice(0, 2).every((week) => week.lessons.every((lesson) => lesson.sayTask.includes(week.week === 1 ? 'hiragana groups' : 'katakana groups')))).toBe(true)
})

test('Japanese glosses and scene cues match their intended meaning', () => {
  const lesson = (week, id) => course.weeks.find((item) => item.week === week).lessons.find((item) => item.id === id)
  expect(course.weeks[0].phraseBank[5].en).toBe("I'm [nationality].")
  const officeRole = lesson(1, 'W01-L2')
  expect(officeRole.dialogue[1].en).toBe("No, I'm an office worker.")
  expect(officeRole.listenCheck.choices[officeRole.listenCheck.answer]).toBe('She is an office worker')
  expect(lesson(2, 'W02-L1').responsePractice.prompt).toContain('next to the clerk as they listen to you')
  expect(lesson(12, 'W12-L2').dialogue[1].en).toContain('take it easy')
  const healthConcern = lesson(12, 'W12-L3').dialogue[1]
  expect(healthConcern.ja).toContain('まだあたまがいたいです')
  expect(healthConcern.en).toContain('my head still hurts')
})

test('the final travel mission retains its open-ended response with no answer menu', () => {
  const finalLesson = course.weeks.at(-1).lessons.at(-1)
  expect(finalLesson.id).toBe('W12-L3')
  expect(finalLesson.responsePractice.choices).toEqual([])
  expect(finalLesson.responsePractice.answer).toBeNull()
  expect(finalLesson.responsePractice.prompt).toContain('without a fixed answer menu')
})
