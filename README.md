# Kanafish

Kanafish is a Japanese travel and conversation-learning Fish app. It turns a practical, communication-first course into short interactive lessons with visible progress—without making a broad kanji syllabus or automated speech scoring a prerequisite.

## Learning direction

The course helps beginners take part in useful exchanges: greetings, introductions, questions, requests, directions, plans, preferences, simple explanations, and asking for help. Lessons move through four stages: **recognize → respond with support → adapt the exchange → communicate with less scripting**.

Hiragana and katakana appear alongside the phrases learners say and hear. Each section introduces only kanji that help in that situation, with readings for unfamiliar forms. The provisional **12-week plan and its milestone checks remain the course backbone**; they are drafts to tune through a learner pilot, not claims of fluency.

## App experience

A lesson should let learners work through a short dialogue, choose or reveal useful responses, practise changing details, revisit kana, and check what they understood. Role-play and milestone checks stay focused on observable communication. Progress should show lesson activity and learner-recorded checkpoint evidence, not imply automated evaluation.

The MVP can support speaking and listening practice with visible prompts and a partner, tutor, or learner-led routine. **TTS, STT, and automated speaking evaluation are later extensions—not MVP scope.**

## Desktop direction

Follow the existing Fish desktop convention: **Bun, Electron, React, and electron-vite**. Start with a lightweight desktop shell, structured lesson content, and local progress tracking. The app itself is not implemented yet.

See [the phased app roadmap](docs/app-roadmap.md) for a staged direction that separates a useful MVP from later speech features.

## Starter documents

- [Course design](docs/course-design.md): scope, functional categories, progression, and script policy.
- [12-week plan](docs/12-week-plan.md): the preserved first-pass course sequence and observable checkpoints.
- [Lesson template](docs/lesson-template.md): a reusable structure for future interactive lessons.

## Status

Curriculum scaffold, v0.1. Next: pilot the first few lessons and tune pacing and milestone thresholds from learner experience before expanding the app scope.
