# Kanafish app direction and roadmap

Kanafish should help a learner practise useful Japanese exchanges, return to weak spots, and see what they have worked through. The course—not a generic language-learning feature checklist—sets the app’s structure.

## Product principles

- **Conversation first:** lessons practise real travel and everyday exchanges, with reading and writing supporting those interactions.
- **Kana alongside conversation:** hiragana and katakana are woven into relevant phrases from the start; kanji is limited to useful, section-specific recognition with readings.
- **Support that fades:** move from recognizing a phrase to supported replies, adaptable exchanges, and less-scripted communication.
- **Honest progress:** show completed practice and learner-recorded milestone evidence. Do not label activity as fluency or automatic speech assessment.
- **Small, testable scope:** validate the lesson format with learners before investing in advanced audio systems.

## MVP direction

Build a focused desktop app around the course system. A learner should be able to:

1. Browse the course sequence and open a lesson.
2. Work through a short exchange and check its gist and key details.
3. Select an appropriate reply, reveal a hint or phrase bank, and try again with a changed detail or follow-up.
4. Practise relevant hiragana and katakana in context, with only the kanji selected for that section.
5. Complete a speaking or listening check using visible prompts and a partner, tutor, or learner-led routine.
6. Mark a lesson’s practice complete, follow the course data’s brief spaced-retrieval prompts, review prior activity, and record evidence or a reflection for the existing milestone checks.

For the first version, listening material can be presented as readable prompts for a partner or tutor to say, or used in a learner-led practice routine. Kanafish does not need generated audio, speech recording, transcription, or automated scoring to make the lesson flow interactive.

## Desktop stack

Use **Bun, Electron, React, and electron-vite**, matching the maintained Fish desktop apps. Keep lesson content separate from the interface so the existing course sequence and checkpoints can be revised without redesigning the app. Prefer local progress storage for the initial version; keep records tied to stable lesson and milestone identifiers so later format changes are manageable. Cloud accounts, sync, and a backend are not required for the MVP.

## Phased roadmap

### Phase 1 — Foundation

- Establish the Electron/React app shell and basic course navigation.
- Define a small lesson-content format based on the [lesson template](lesson-template.md) and the [versioned course data](../course/course-v1.json).
- Add versioned local storage for lesson status and learner-entered checkpoint notes.
- Build only the reusable interaction patterns needed by the first pilot lessons.

**Exit check:** the app can open a sample lesson, preserve local progress after restart, and present the course content without hard-coding a single lesson into the interface.

### Phase 2 — Interactive lesson MVP

- Implement the core lesson flow: dialogue/context, response choice, hint or phrase reveal, changed-detail practice, kana review, and a short comprehension check.
- Make speaking checks usable without app audio features, using prompts and the existing observable criteria.
- Show what is started, completed, and revisited, plus learner-entered evidence for milestone checks.
- Keep feedback descriptive and tied to a task; do not infer a learner’s overall proficiency from completion alone.

**Exit check:** a learner can finish several lessons, resume them, and understand what they practised and what to revisit.

### Phase 3 — Pilot and tune the course experience

- Pilot lessons from several parts of the complete [36-lesson course draft](../course/course-v1.json) and collect feedback on pacing, prompts, kana support, and progress displays.
- Calibrate the provisional thresholds in the [12-week plan](12-week-plan.md) from observed learner experience; preserve its course sequence and milestone intent unless evidence supports a revision.
- Treat current course content as a reviewed draft, not a production-approved syllabus; revise it from learner and proficient-speaker feedback.

**Exit check:** the first learning loop is understandable and useful, and proposed course adjustments are based on pilot observations.

### Phase 4 — Later speech extension (not MVP)

Only after the lesson format and human-readable rubric have been tested, investigate optional TTS, STT, and speaking feedback. The [Japanese TTS options review](tts-options.md) recommends a small voice audition, not a vendor commitment or implementation. If TTS is added, put it behind a provider adapter, keep credentials out of the Electron renderer, cache stable lesson audio, offer normal-speed and learner-selected slower replays, and retain a no-audio fallback for desktop and phone use. Treat TTS, STT, and speaking feedback as separate capabilities with their own accuracy, privacy, licensing, cost, accessibility, and user-control decisions. They are not prerequisites for the MVP and should not silently change the existing milestone standards.

## Not part of the MVP

- TTS, STT, voice recording, or automated pronunciation/speaking evaluation.
- A broad kanji curriculum or kanji mastery gate.
- Accounts, cloud sync, social features, or a backend requirement.
- Treating the authored course draft as validated before a learner pilot.
