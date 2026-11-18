# Kanafish

Kanafish is a Japanese travel and conversation-learning app. The first desktop implementation is text-first: it turns the existing practical course into short interactive lessons, daily recall, searchable phrase cards, and learner-recorded checkpoints. It does not require speech recognition or automated scoring.

## What works now

- **Daily learning:** a next-lesson card, course progress, a small review session, and a gentle recall-first routine.
- **Interactive lessons:** prior-lesson warmup, readable dialogue with meanings revealed on demand, gist/detail and reply choices with explanations, changed-detail practice, partner/tutor prompts, and kana/kanji recognition in context.
- **A full course path:** all 12 weeks and 36 existing lessons, with stable lesson IDs and the six original milestone IDs and task intent.
- **Spaced retrieval:** previous-lesson recall, a changed-scene revisit in the first lesson of a week, longer-spaced weak-item recall in the third lesson, plus rated phrase/kana/kanji flashcards.
- **Phrasebook and checkpoints:** searchable course language and fields for learner-entered milestone evidence and next practice targets.
- **Local-first progress:** versioned progress stored on this device, with JSON export and a visible warning plus export action if device storage fails. Completion is freely self-recorded; it is not a fluency or automatic speaking score.
- **Local TTS Voice Lab:** Supertonic 3 is the only engine currently enabled, using ONNX Runtime WebGPU with a WebAssembly CPU fallback and all ten built-in voices (M1–M5/F1–F5). Learners can keep one voice, rotate by week or lesson, or shuffle each listen; the model downloads on request. Other integrated engines remain hidden pending live re-validation.
- **Glass desktop shell:** Bun, Electron, React, and electron-vite, with native macOS vibrancy and motion that respects reduced-motion settings.

## Run and test

Start the desktop app with Bun:

```sh
bun run dev
```

The development runner checks the package manifest and lockfile, runs `bun install` when dependencies are missing or changed, then starts `electron-vite`. Installation also downloads the Electron runtime. You can run `bun install` explicitly first, or use `bun run dev:bare` when dependencies are already installed.

Run the course, learning-engine, TTS registry/runtime tests, and production Electron build with `bun run check`.

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

The app is a working text-first MVP foundation with optional local TTS testing; the course data remains a draft for proficient-speaker review and learner piloting. Learners can open lessons and move between steps in any order; marking a lesson complete is a self-attestation, not a gate or automatic check that every activity was done. Timing, Japanese phrasing, and checkpoint thresholds should be tuned from feedback. Model downloads happen only when requested; speech synthesis runs locally. STT, recording, accounts, cloud sync, and automated speaking evaluation are not part of this implementation.
