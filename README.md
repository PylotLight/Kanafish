# Kanafish

Kanafish is a local-first Japanese conversation-learning app for beginner-to-low-intermediate learners. Its original 12-week companion broadly follows the scope and sequence of *GENKI I* (Third Edition), using new scenes, explanations, prompts, and dialogues; it does not reproduce textbook material and is not affiliated with the publisher. Learners make a first pass through the full core hiragana set in Week 1 and katakana in Week 2 alongside conversation, then revisit kana in later practice; neither script gates speaking or progress. The route turns practical scenes into short interactive lessons, daily recall, searchable phrase cards, and learner-recorded checkpoints. Speaking practice is optional; there is no automated pronunciation or fluency grade.

## What works now

- **Daily learning:** next-lesson guidance, course progress, a small due-card session, and a recall-first routine.
- **Interactive lessons:** previous-lesson retrieval, listen-first dialogue, normal-speed and slow replay, revealable kana and English, comprehension and reply choices, changed-detail practice, and optional speaking work.
- **Local speech in coursework:** Supertonic 3 reads dialogues, phrases, kana groups, kanji readings, and reply choices. Haas-ja-v1.0 can optionally transcribe a learner's short recording on-device. Learners can also practise aloud and self-rate without recording.
- **A full course path:** all 12 weeks and 36 original conversation-first lessons, broadly aligned to the beginner textbook sequence, with complete early kana practice, stable lesson IDs, and six milestone IDs.
- **Spaced retrieval:** dialogue and phrase cards join phrase, kana, and kanji cards. Again/Hard/Good/Easy ratings set due dates; difficult items return sooner, intervals adapt to review history, and successful reviews remove the extra weak-item priority.
- **Adaptive script support:** romaji appears under kana and kana readings while they are still being learned, then fades away after two comfortable reviews on different days. Settings can keep it always visible or hide it immediately. A difficult kana review brings it back in adaptive mode.
- **Phrasebook and checkpoints:** searchable course language, listening controls, and fields for learner-entered milestone evidence and next practice targets.
- **Local-first progress:** versioned progress and preferences stay on this device, with JSON export and a visible warning plus export action if device storage fails. Completion is freely self-recorded; it is not an assessment.
- **Efficient local models:** model weights and runtime files stay outside Git and are cached locally. Downloads are user-initiated in Voice Lab (about 401 MB for TTS and 656 MB for ASR, plus the small speech runtime). TTS warms the selected model and voice for course, review, and phrasebook use; ASR warms for lesson speaking practice and stops after five idle minutes. Cached models remain available for later sessions.
- **Glass desktop shell:** Bun, Electron, React, and electron-vite, with native macOS vibrancy and motion that respects reduced-motion settings.

## Privacy and assessment limits

Speech synthesis and recognition run on the device. Recording starts only when the learner asks for it; the audio and transcript are not added to saved progress. When a practice line is selected, Kanafish may show character overlap between the recognized written transcript and the sample. This is only a text comparison: it does not evaluate pronunciation, accent, or fluency, and recognition can miss correctly spoken words or accept imperfect ones.

## Run and test

Start the desktop app with Bun:

```sh
bun run dev
```

The development runner checks the package manifest and lockfile, runs `bun install` when dependencies are missing or changed, then starts `electron-vite`. Installation also downloads the Electron runtime. You can run `bun install` explicitly first, or use `bun run dev:bare` when dependencies are already installed.

Run the course, learning-engine, speech runtime, TTS registry/runtime tests, and production Electron build with `bun run check`.

## Course and design notes

- [App usage guide](docs/app-guide.md)
- [Course design](docs/course-design.md)
- [12-week plan](docs/12-week-plan.md)
- [Lesson template](docs/lesson-template.md)
- [Course system and retrieval cadence](docs/course-system.md)
- [Structured course data](course/course-v1.json) and [schema](course/course.schema.json)
- [Phased app roadmap](docs/app-roadmap.md)
- [Japanese TTS options](docs/tts-options.md) — benchmark evidence, model limitations, and the current in-app support boundary.
- [Optional TTS runtime setup](docs/tts-runtime.md) — in-app native builds, prerequisites and consent, both Irodori routes, local model/cache controls, MioTTS-0.6B assessment, benchmark results, and licensing notes.

## Status

The app is a working beginner-to-intermediate MVP; course language and checkpoints remain a draft for proficient-speaker review and learner piloting. Learners can open lessons and move between steps in any order; marking a lesson complete is self-attestation, not a gate or automatic check. Speech and downloads are optional and local. The app has no accounts or cloud sync, and does not claim to score speaking ability. Timing, Japanese phrasing, and checkpoint thresholds should be tuned from feedback.
