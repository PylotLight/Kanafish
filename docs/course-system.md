# Kanafish course system

Kanafish's first complete course is a practical, beginner Japanese journey: **12 weeks, three short lessons per week, and six observable can-do checkpoints**. Its aim is not to finish a grammar list. It is to help a traveller understand and take part in familiar exchanges, recover when a detail is missed, and see what they can do next.

The app-ready course content lives in [`course/course-v1.json`](../course/course-v1.json), with its structure in [`course/course.schema.json`](../course/course.schema.json). The existing [12-week outline](12-week-plan.md) remains the high-level sequence and milestone reference.

## The learning loop

Each weekly topic is practised in three short sessions:

1. **Recognize:** hear or read a brief scene, identify what each person needs, and catch one key detail.
2. **Respond with support:** choose an appropriate phrase, use a small phrase bank, then say the reply aloud.
3. **Adapt:** change a person, item, place, time, or preference; add a follow-up; and try again with less scripting.

A typical 12–20 minute lesson introduces one scene, plays or reads the dialogue, checks gist and a detail, offers one response choice with an explanation, gives a say-it prompt, and ends with a changed-detail attempt. Replaying and using a hint are normal learning actions, not failures. A learner should try once before opening the hint, then revisit the exchange with different details.

## Spaced retrieval cadence

Keep older language active with short, low-pressure recall—not a separate vocabulary grind. The cadence is also stored in the course data's `reviewCadence` field so a future player can use the same rules:

- Start each lesson with a 60–90 second attempt to recall one useful phrase or detail from the prior completed lesson before showing the phrase bank. Offer a cue only after the learner tries.
- In lesson 1 each week, bring back one high-value item from the previous week in a new mini-scenario. In lesson 3, interleave one item first practised 2–4 weeks earlier, prioritizing learner-recorded weak items.
- Include one earlier conversation function in each two-week can-do checkpoint, alongside the current task.
- If recall is difficult, reveal a short cue and revisit it next lesson. If recalled without help, move it to a later spaced review rather than repeating it every session. Do not turn review attempts into a fluency or memory score.

## What every lesson contains

The structured lesson records a stable ID, scene, conversation stage, short Japanese dialogue, English meaning, listening check, response practice, speaking task, adaptation prompt, and observable success checks. Week-level metadata groups the phrase bank, kana focus, practical kanji cards, and any checkpoint. This keeps lesson content separate from interface code and makes it possible to revise a phrase without rebuilding the lesson player.

Japanese lines are written in kana so a learner can read the same language they hear and say. Useful kanji appear separately as small recognition cards with readings and a reason they matter in that topic. The curriculum does not require romaji or handwriting; the first learner pilot can test an optional, temporary pronunciation scaffold if needed. Never make script recognition a gate for joining the conversation.

## Twelve-week route

| Weeks | Conversation goal | Script support |
|---|---|---|
| 1–2 | Open a conversation; introduce yourself and answer familiar questions | Start hiragana; learn only the most useful person/name recognition items |
| 3 | Ask what or where; ask someone to repeat or slow down | Complete core hiragana patterns and voiced sounds |
| 4–5 | Order, confirm a choice, and pay for a simple item | Begin katakana with menus, drinks, quantities, and checkout words; recognize 円 |
| 6 | State a preference, ask for a recommendation, and describe a food limitation | Continue practical katakana; recognize 好き in context |
| 7–8 | Ask for directions, follow two steps, and agree on a time | Practise signs and common place names; recognize 駅, 入口/出口, 時/時間 |
| 9 | Tell a short two-event travel story | Review time words and short kana passages; recognize 今日/明日 as whole words |
| 10 | Explain a problem and request help or repetition | Reuse useful signs and repair phrases; recognize 交番 |
| 11–12 | Combine familiar functions and recover from one changed or missed detail | Mixed kana and travel-text review; no new kanji burden |

The script targets are a lightweight path, not an exam prerequisite. Lessons revisit old sounds in new contexts, including menu words, place names, times, and signs.

## Progress that stays honest

The six checkpoints sit at the ends of weeks 2, 4, 6, 8, 10, and 12. Each is a task with evidence: what the learner attempted, what information they understood, what support they used, and what they want to practise next. The final checkpoint asks for a familiar three-minute role-play across several functions and comprehension of a clear 45–60 second beginner dialogue. These are pilot targets, not promises of independent fluency.

For app progress, keep lesson state separate from milestone evidence. A completed lesson means the learner worked through its practice; it does not mean their Japanese has been automatically assessed. Do not infer pronunciation quality or overall proficiency from clicks or self-reported completion.

## Listen-first practice with local TTS

Every lesson can play its existing Japanese dialogue locally, one turn at a time, using the learner's selected voice. The default is Supertonic 3; the learner may choose another supported engine in Voice Lab. Model weights and optional runtimes stay outside the repository and are fetched only after the learner chooses a setup action. The selected engine's license, size, runtime requirements, and test evidence are shown in Voice Lab; MioTTS's bundled Japanese presets have an upstream non-commercial output restriction.

The lesson opens with kana and English hidden so learners can listen at normal speed first. They can replay the dialogue at a slower playback rate, hear an individual turn or phrase, reveal kana, and then optionally reveal English. The same selected local voice is available for Japanese reply choices, recall cues, phrase-bank entries, kana groups, kanji readings, review cards, and the course phrasebook. A tutor, partner, or learner-led read-aloud remains an option when audio is unavailable. TTS is optional: it does not gate lesson navigation or completion. Kanafish does not record speech or score pronunciation, and listening results are not treated as proficiency evidence.

Supertonic 3 is the current default and the owner's preferred voice in listening comparisons. Other engines remain opt-in; their performance and audio quality are not assumed to match it. The owner’s Mac/Metal paths are not verified. See the [TTS options note](tts-options.md) for runtime evidence and licensing details.

## Content validation and pilot

Before turning the JSON into a production course, review the Japanese with a proficient speaker, check listening-answer keys against the dialogue, and pilot lesson length and kana workload with a beginner. Tune timings and checkpoint thresholds from observed attempts. Keep original checkpoint intent stable unless pilot evidence supports a change; store progress against lesson and milestone IDs so later copy edits do not erase a learner's history.
