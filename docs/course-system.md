# Kanafish course system

Kanafish's first complete course is a practical, beginner-to-intermediate Japanese journey: **12 weeks, three short lessons per week, and six observable can-do checkpoints**. Its aim is not to finish a grammar list. It is to help a traveller understand and take part in familiar exchanges, recover when a detail is missed, and see what they can do next.

The app-ready course content lives in [`course/course-v1.json`](../course/course-v1.json), with its structure in [`course/course.schema.json`](../course/course.schema.json). The existing [12-week outline](12-week-plan.md) remains the high-level sequence and milestone reference.

## The learner's route

The path is grouped into four connected phases: **Find your first words** (weeks 1–3), **Handle everyday needs** (weeks 4–6), **Get around** (weeks 7–8), and **Keep the conversation moving** (weeks 9–12). The route starts from zero and builds toward familiar travel exchanges with less scripting. It is a beginner-to-intermediate travel course; advanced Japanese is intentionally reserved for a later course. The 12-week pace is a suggestion, not a deadline.

## The learning loop

Each weekly topic is practised in three short lessons:

1. **Recognize:** listen to or read a brief scene, identify what each person needs, and catch one key detail.
2. **Respond with support:** choose an appropriate phrase, use a small phrase bank, then try the reply aloud.
3. **Adapt:** change a person, item, place, time, or preference; add a follow-up; and try again with less scripting.

A brand-new learner starts with a short orientation and the lesson's stated goal, never a pretend recall task. Later lessons offer a brief revisit only when its source lesson is marked practised; the learner can skip it. With no eligible revisit, the lesson goes straight to new material. A typical lesson introduces a scene, keeps the Japanese text visible and readable, offers English meanings on request, checks gist and one detail, guides a reply, and ends with a changed-detail attempt. Local listening, recording, and recognition are optional; speech setup never blocks progress. Replaying and using a cue are ordinary learning actions, not failures.

## Spaced retrieval and adaptation

Short, low-pressure recall keeps studied language active without turning the course into a vocabulary grind. Retrieval considers only phrases that occur in a lesson the learner completed. A new week's first lesson may revisit the previous week in a changed scene; lesson three may interleave material from two to four weeks earlier. If no source lesson in that range was completed, no prompt is fabricated. Checkpoints invite an earlier conversation function only when it was practised.

The local review deck adds course phrases and dialogue lines alongside kana and practical kanji. A card becomes eligible only after its lesson is completed (or the learner explicitly self-rates it); untouched course material is not due. Completion introduces eligible cards with the first review scheduled for the following day. Learners try to recall a card, then choose Again, Hard, Good, or Easy. The first rating intervals are one, two, three, and five days respectively. Later intervals adapt to the card's history and ease factor. Again and Hard items get extra priority when due; a successful review removes that extra weak-item boost. The daily session is capped at eight cards, and stable card IDs keep schedules attached to the same learning items.

Lesson misses and learner ratings guide what to revisit, not a pronunciation score. A failed response can be offered again as a recall prompt; a comfortable recall moves to a later spaced interval rather than being repeated every session. These rules are gentle scaffolds: learners can move between lesson steps freely and are never blocked by a review result.

## Script support

Japanese dialogue is written primarily in kana so learners can connect the written line with what they hear and say. Useful kanji appear separately as small recognition cards with readings and a reason they matter in the current topic. Script recognition is not a gate for joining a conversation.

Romaji is a configurable scaffold, not the course's main writing system. In adaptive mode it is shown beneath kana and kana readings until all characters in the item have been recalled comfortably (Good or Easy) on two different calendar days. It then hides in dialogue, phrasebook, course, and review views. A later Hard or Again kana review resets that mastery cue, so the support can return. Learners may instead always show or hide romaji in Settings. The app preserves progress from older versions when this preference is introduced.

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

## What every lesson contains

Structured lesson records have a stable ID, scene, conversation stage, short Japanese dialogue, English meaning, listening check, response practice, speaking task, adaptation prompt, and observable success checks. Week metadata groups the phrase bank, kana focus, practical kanji cards, and any checkpoint. This keeps content separate from interface code and lets a phrase be revised without changing lesson identity.

At the scene step, Supertonic 3 can read the existing dialogue with one selected voice for the entire exchange. Normal-speed playback is primary; a slower 0.85× replay is available. The Japanese dialogue is visible immediately, while English meanings can be shown or hidden. Individual turns, phrases, kana groups, reply choices, and kanji readings also have local playback. Model downloads are initiated by the learner in Voice Lab and stay in the local app cache, outside the repository.

The lesson's optional speaking activity lets learners choose a course phrase or dialogue line, listen to a model voice, reveal kana and the adaptive romaji cue, and try the line aloud. They may self-rate recall without recording. If they choose to record, Haas-ja-v1.0 transcribes a clip on the same device. Audio and transcript are not saved in progress or uploaded. The recognizer's character-level overlap with a sample is only a written-text comparison; it is not a pronunciation, accent, or fluency grade. It can miss correctly spoken words and may accept imperfect ones. Kanafish does not use this comparison to set review timing: the learner's own rating does that.

## Efficient local models

The TTS worker lives for the app session, reuses its ONNX engine and voice style, and can be prewarmed when the learner opens course browsing, review, phrasebook, or a scene. It uses WebGPU where available and WebAssembly CPU otherwise. The ASR runtime and model start only after the learner has installed or downloaded them; lesson speaking practice warms the recognizer before recording. After five minutes without recognition work, the ASR worker stops to release memory, while verified model files remain cached for a later session. Neither model is downloaded automatically as a side effect of opening a lesson.

TTS and STT are optional. Learners can practise with a partner, tutor, or self-led read-aloud if setup is unavailable. A first model load may still take time; the app reports setup, warming, and recognition states rather than implying that a model is immediately ready.

## Progress that stays honest

The six checkpoints sit at the ends of weeks 2, 4, 6, 8, 10, and 12. Each is a task with evidence: what the learner attempted, what information they understood, what support they used, and what they want to practise next. The final checkpoint asks for a familiar three-minute role-play across several functions and comprehension of a clear 45–60 second beginner dialogue. These are pilot targets, not promises of independent fluency.

Lesson state, spaced-review schedules, kana mastery, and milestone evidence are stored separately in version-three local progress. The app migrates earlier progress without losing lesson sessions, milestone evidence, review schedules, or stable lesson, milestone, and flashcard IDs; progress can be exported as JSON. A completed lesson means the learner chose to record that they practised. It does not mean their Japanese has been automatically assessed. Do not infer pronunciation quality or overall proficiency from clicks, transcripts, or self-reported completion.

## Content validation and pilot

Before turning the JSON into a production course, review the Japanese with a proficient speaker, check listening-answer keys against the dialogue, and pilot lesson length and kana workload with a beginner. Tune timings, Japanese phrasing, and checkpoint thresholds from observed attempts. Keep original checkpoint intent stable unless pilot evidence supports a change; store progress against lesson and milestone IDs so later copy edits do not erase a learner's history.
