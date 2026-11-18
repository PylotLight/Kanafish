# Using Kanafish

Kanafish is designed for short, practical Japanese sessions. Begin from **Today**, continue the next lesson in the course, or do a small set of due review cards first. The app offers up to eight cards in one short session, and review includes only material connected to a completed lesson or an item the learner has already rated.

## Work through a lesson

Lessons move through five steps: get a clear goal (or take an optional revisit from a completed lesson), meet the scene, check what you noticed, choose an appropriate reply (or write an open-ended reply in the final mission), then adapt the exchange. The Japanese scene is visible from the start, and English meanings can be shown when you want support. Listen if local audio is ready, replay more slowly at 0.85×, or read at your own pace; audio setup is never needed to continue. Local speech buttons also read Japanese cues, phrase-bank entries, response choices, kana groups, kanji readings, review cards, and phrasebook cards.

The final lesson step has optional speaking practice. Pick a course phrase or dialogue line, listen to a model voice, try it aloud, and rate how easily you recalled it. You can self-rate without recording. If the local recognizer is installed, you may choose to record a short attempt and see the transcript. Kanafish does not save or upload the audio or transcript. Any character-overlap display compares the written transcript with the sample; it is not a pronunciation, accent, or fluency grade. Audio, recording, recognition, and lesson completion are never required to continue.

Comprehension and response choices give task-level explanations and can be retried. The final mission accepts a written Japanese reply without a fixed answer key, then reveals guidance and the phrase bank after an attempt. The final step also displays the lesson's change-the-detail prompt, a partner/self-led conversation task, kana focus, and any practical kanji cards. Lessons and steps remain freely navigable; marking a lesson complete is a learner self-attestation, not a proficiency score.

## Voice Lab and local speech

Open **Voice Lab** from the sidebar to set up local speech. Supertonic 3 is the enabled text-to-speech engine, with ten built-in voices and course options to keep one voice, rotate each week, rotate each lesson, or shuffle each listen. Lesson/week rotation is repeatable, and a full dialogue keeps the same voice throughout. The selected voice is previewed directly in Voice Lab; preferences stay on this device.

Haas-ja-v1.0 is the optional Japanese speech recognizer. Voice Lab can install its speech.cpp runtime and download its model on request; model weights are about **656 MB** and runtime files are cached in the app's private data. TTS model weights are about **401 MB**. Neither model downloads automatically when a lesson is opened. TTS keeps its ONNX engine and the current voice style ready for reuse during the app session; it prewarms when the learner opens course browsing, review, phrasebook, or a lesson scene. The ASR worker prewarms for lesson speaking practice and stops after five minutes without work to release memory. Verified model files remain cached for later sessions.

TTS uses ONNX Runtime WebGPU when available, with a WebAssembly CPU fallback. First load can take longer; the app shows setup, warm-up, and recognition states. A learner can always practise aloud with a partner, tutor, or independently when speech setup is unavailable.

Sandbox CPU timings and smoke-test results are summarized in the [runtime notes](tts-runtime.md); they show whether a pipeline generated audio, not how natural or accurate it sounds. The owner's Mac and its Metal/MPS paths have not been tested. Do not treat performance on this sandbox as a prediction for a Mac.

## Romaji and script support

Kana stays primary, with useful kanji taught as recognition cards alongside readings. In **Settings → Romaji scaffold**, choose adaptive, always show, or hide. Adaptive mode shows romaji beneath kana and kana readings until each kana in a learning item has been recalled comfortably on two different days. It then hides the cue; a difficult kana review brings it back. This setting applies across lessons, course kana/kanji readings, review, and phrasebook, without using kanji romanization guesses.

## History-based review and spaced practice

When a useful phrase from an earlier completed lesson is eligible, the learner can try it from memory, ask for a hint, or skip the revisit. A brand-new learner—and anyone with no eligible revisit—starts with the current lesson's goal and new material. A phrase missed during practice can return in later retrieval; after comfortable recall, the app selects another phrase rather than repeating the same one immediately.

The review deck contains phrases and dialogue lines, kana groups, and useful kanji. Flip only after trying to recall, then select **Again / Hard / Good / Easy**. The first intervals are 1, 2, 3, and 5 days; later timing adapts to review history. Missed or difficult items receive extra priority when due, and a successful review clears that boost. The **Meaning → Japanese** direction applies to phrase and dialogue cards; kana and kanji remain recognition-first. These are scheduling choices, not test scores.

The course may revisit a phrase from the previous week in a new scene, or interleave material from two to four weeks earlier in lesson three, prioritizing unresolved difficult items. Those prompts are drawn only from lessons the learner completed and phrases that appeared there; if no suitable item exists, the lesson proceeds with new content. Checkpoints invite an earlier conversation function only when it has been practised. The phrasebook shows material across the course, while the due-review queue reflects the learner's own study history.

## Checkpoints and personal data

The six checkpoints keep their original stable IDs and task/evidence intent. Add notes about what you attempted and understood, what support helped, and what you want to practise next. A checkpoint is recorded only when the learner chooses to save it; Kanafish does not infer mastery from text fields or lesson completion.

Lesson status, review schedules, kana mastery, and milestone notes are saved in versioned local app storage on this device. Use **Export progress** in Settings to save a JSON copy. If device storage rejects a change, Kanafish shows a warning and an export action; the unsaved change remains only for the current open session, so export before closing. There is no account or cloud sync. Model and optional runtime files are fetched remotely only after a setup action; synthesis and recognition run on this device.

## Development checks

- `bun run check` — course/learning/speech runtime and TTS tests plus the electron-vite production build after Bun dependencies are installed.
