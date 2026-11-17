# Using Kanafish

Kanafish is designed for short, practical Japanese sessions. Begin from **Today**, continue the next lesson in the course, or do a small set of review cards first. The app offers up to eight due cards in one short review session and only draws cards from weeks unlocked by course progress.

## Work through a lesson

Lessons move through five steps: recall a useful phrase, read a scene, check what you understood, choose an appropriate reply (or write an open-ended reply in the final mission), then adapt the exchange. Japanese text remains visible; English meanings are optional. Dialogue-line play buttons become available after downloading the local voice model in Voice Lab. A learner can also try the dialogue independently or ask a partner or tutor to read it aloud. Kanafish does not record speech or score pronunciation.

Comprehension and response choices give task-level explanations and can be retried. The final mission accepts a written Japanese reply without a fixed answer key, then reveals guidance and the phrase bank after an attempt. The final step displays the lesson's change-the-detail prompt, a partner/self-led conversation task, kana focus, and any practical kanji cards. Lessons and steps remain freely navigable; marking a lesson complete is a learner self-attestation, not a check that every activity was finished or a proficiency score.

## Voice Lab

Open **Voice Lab** from the sidebar to compare Supertonic 3 and NVIDIA Magpie v2607 with the same four Japanese lines. Supertonic is about 399 MB and is downloaded from a pinned Hugging Face revision into the Hugging Face cache (set `HF_HUB_CACHE` or `HF_HOME` to choose its location). Magpie's model, tokenizer and codec are about 668 MB total; it is fetched only when requested into Kanafish's local app-data cache. Voice Lab reports the backend, selected Magpie speaker, audio length, generation time and real-time factor. Lesson dialogue play buttons use the currently selected local model.

Supertonic uses ONNX Runtime WebGPU first and falls back to WebAssembly CPU. Magpie needs a separately installed NeMo-Speech.cpp 0.3.0+ runtime whose `nemo-speech doctor` feature list includes `http`, `tts`, and `tts_japanese`; stock builds may omit the Japanese frontend. Kanafish then uses the native program to download the pinned weights and starts a loopback-only local synthesis service. See the [Magpie runtime setup guide](tts-runtime.md) before enabling it.

The sandbox CPU tests measured Supertonic at 0.21–0.46× real time, Magpie at 1.42–1.56× (plus about 2.12 seconds to load the service), and Irodori at 3.11–6.02×. A factor above 1.0 means synthesis took longer than the audio duration. These are speed measurements, not naturalness or pronunciation ratings. WebGPU is not PyTorch MPS; NeMo's Metal backend is also a separate native path. Neither Metal nor MPS was tested because the owner's Mac was unavailable. Irodori, MioTTS, Qwen3-TTS and retired Chatterbox remain unsupported research candidates in this build.

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

Lesson status, review schedules, and milestone notes are saved in versioned local browser storage on this device. Use **Export progress** in the sidebar to save a JSON copy. If device storage rejects a change, Kanafish shows a warning and an export action; the unsaved change remains only for the current open session, so export before closing. There is no account or cloud sync. Only the model files are fetched remotely when requested; text prompts and generated speech stay local.

## Development checks

- `bun run check` — course/learning/TTS registry tests and electron-vite production build after Bun dependencies are installed.
