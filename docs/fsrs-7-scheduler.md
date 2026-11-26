# FSRS-7 spaced-repetition scheduler

Kanafish now uses `ts-fsrs` 6.0.1 with its FSRS-7 model instead of the app's homegrown ease-and-interval calculation. The scheduler targets 90% desired retention, disables interval fuzz for deterministic persisted results, enables short-term scheduling, uses `1m` and `10m` learning steps, a `10m` relearning step, and caps intervals at 36,500 days.

For each review, Kanafish stores the serialized FSRS card state under the existing card ID, including precise UTC `dueAt`, review state, difficulty, and both stability values. It also appends the scheduler's review event to `reviewHistory`. Rating buttons preview the four FSRS outcomes, and the app compares exact due timestamps so a short retry is not shown early. Legacy records that have only a date still use their preserved calendar due date.

## Existing learner data

Kanafish keeps the existing generated card IDs unchanged so current progress remains attached to the same cards. The previous scheduler did not retain a review-event log, so the app cannot reconstruct exact historical FSRS memory states. It does not invent past reviews. During migration, an old card retains its existing due date and legacy interval, repetition, rating, and lapse metadata in `legacySchedule`; its `fsrsCard` remains empty until the learner rates it under FSRS. New reviews then create FSRS state and real review events for that same card ID.

## References

- [`ts-fsrs` project documentation](https://github.com/open-spaced-repetition/ts-fsrs) — scheduler API and FSRS version support.
- [Upstream migration guide](https://open-spaced-repetition.github.io/ts-fsrs/guide/migration) — scheduler-state migration considerations.
- [FSRS-7 model guide](https://open-spaced-repetition.github.io/ts-fsrs/guide/model/fsrs-7.md) — FSRS-7 model details, including fast and slow stability values persisted by Kanafish.
- [`ts-fsrs` 6.0.1 package](https://www.npmjs.com/package/ts-fsrs/v/6.0.1) — pinned package version and license metadata.

## Compatibility note

This migration leaves the current card-ID generation unchanged. Some existing IDs include an item’s position in its curriculum list, so future curriculum reorders must preserve those IDs or ship an explicit alias migration; otherwise saved review state could attach to the wrong item.
