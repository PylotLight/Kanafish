# Using Kanafish

Kanafish is designed for short, practical Japanese sessions. Begin from **Today**, continue the next lesson in the course, or do a small set of review cards first. The app offers up to eight due cards in one short review session and only draws cards from weeks unlocked by course progress.

## Work through a lesson

Lessons move through five steps: recall a useful phrase, listen to or read a scene, check what you understood, choose an appropriate reply (or write an open-ended reply in the final mission), then adapt the exchange. The lesson opens with kana and English hidden for a listen-first attempt; reveal either when you want support. Play the full dialogue in turn order, replay it more slowly, or hear a single line. Local speech buttons are also available for Japanese recall cues, phrase-bank entries, response choices, kana and kanji readings, review cards, and phrasebook cards. A learner can also read the dialogue independently or ask a partner or tutor. Kanafish does not record speech or score pronunciation.

Comprehension and response choices give task-level explanations and can be retried. The final mission accepts a written Japanese reply without a fixed answer key, then reveals guidance and the phrase bank after an attempt. The final step displays the lesson's change-the-detail prompt, a partner/self-led conversation task, kana focus, and any practical kanji cards. Lessons and steps remain freely navigable; marking a lesson complete is a learner self-attestation, not a check that every activity was finished or a proficiency score.

## Voice Lab

Open **Voice Lab** from the sidebar to compare the same Japanese test lines across six local engines: Supertonic 3, Magpie, Qwen3-TTS, Irodori, Irodori MF ONNX, and MioTTS. Supertonic 3 is the default and the owner's preferred voice in listening comparisons; other engines are optional, and their quality or speed is not assumed to match. Voice Lab shows setup state, license notes, model size, runtime needs, and available test evidence. Lessons and other speech buttons use the currently selected engine; Kanafish does not silently switch engines if it is not ready.

Model weights and optional runtimes are fetched only after setup is requested and are kept outside Git. Supertonic uses ONNX Runtime WebGPU with a WebAssembly CPU fallback; Magpie and Qwen use app-managed native C++ runtimes; MioTTS uses its pinned native runtime; Irodori MF runs with ONNX and no Python; plain Irodori uses an optional app-managed Python environment. See the [local runtime setup guide](tts-runtime.md) for exact setup and license distinctions. The MioTTS Japanese preset output is restricted to non-commercial use.

Sandbox CPU timings and smoke-test results are summarized in the [runtime notes](tts-runtime.md); they show whether a pipeline generated audio, not how natural or accurate it sounds. The owner’s Mac and its Metal/MPS paths have not been tested. Do not treat performance on this sandbox as a prediction for a Mac.

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

Lesson status, review schedules, and milestone notes are saved in versioned local browser storage on this device. Use **Export progress** in the sidebar to save a JSON copy. If device storage rejects a change, Kanafish shows a warning and an export action; the unsaved change remains only for the current open session, so export before closing. There is no account or cloud sync. Model and optional runtime files are fetched remotely only after a setup action; lesson text and generated speech stay on this device.

## Development checks

- `bun run check` — course/learning/TTS registry tests and electron-vite production build after Bun dependencies are installed.
