# Using Kanafish

Kanafish is designed for short, practical Japanese sessions. Begin from **Today**, continue the next lesson in the course, or do a small set of review cards first. The app offers up to eight due cards in one short review session and only draws cards from weeks unlocked by course progress.

## Work through a lesson

Lessons move through five steps: recall a useful phrase, read a scene, check what you understood, choose an appropriate reply (or write an open-ended reply in the final mission), then adapt the exchange. Japanese text remains visible; English meanings are optional. A learner can try the dialogue independently or ask a partner or tutor to read it aloud. The app does not generate audio, record speech, or score pronunciation.

Comprehension and response choices give task-level explanations and can be retried. The final mission accepts a written Japanese reply without a fixed answer key, then reveals guidance and the phrase bank after an attempt. The final step displays the lesson's change-the-detail prompt, a partner/self-led conversation task, kana focus, and any practical kanji cards. Lessons and steps remain freely navigable; marking a lesson complete is a learner self-attestation, not a check that every activity was finished or a proficiency score.

## Daily recall and spaced review

At the start of a lesson, try a quick recall before opening a cue. A missed item can reappear in the next lesson; after a self-reported easy recall, the next prompt uses another useful phrase rather than repeating that same one immediately.

The course's review cadence is represented in the app:

- The first lesson of each week brings back a phrase from the previous week's phrase bank and places it in the new scene.
- The third lesson from week 4 onward revisits an item from 2–4 weeks earlier, preferring items rated **Again** or **Hard** when available.
- A two-week checkpoint includes a reminder to bring an earlier conversation function into the milestone task.
- Phrase, kana, and kanji cards use learner-selected **Again / Hard / Good / Easy** ratings to set the next review date. These are scheduling choices, not test scores.

The phrasebook includes material across the course, while the daily review queue follows the learner's unlocked week.

## Checkpoints and personal data

The six checkpoints keep their original stable IDs and task/evidence intent. Add notes for what you attempted and understood, what support helped, and what you want to practise next. A checkpoint is marked recorded only when the learner chooses to save it; Kanafish does not infer mastery from text fields or lesson completion.

Lesson status, review schedules, and milestone notes are saved in versioned local browser storage on this device. Use **Export progress** in the sidebar to save a JSON copy. If device storage rejects a change, Kanafish shows a warning and an export action; the unsaved change remains only for the current open session, so export before closing. There is no account, cloud sync, or remote language service in this MVP.

## Development checks

- `bun test` — course IDs, milestone IDs, course structure, progress state, card scheduling, and retrieval-cadence tests.
- `bun run build` — electron-vite production build after Bun dependencies are installed.
