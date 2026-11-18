// Score a free-form "say task" (e.g. "Say a greeting, then say すみせん to get the receptionist's attention.")
// against a speech-recognition transcript. The task is multi-step, so whole-line similarity (scoreSpokenLine)
// is unreliable; instead we extract the key Japanese phrases the task names and check that the transcript
// contains each one (after kana-agnostic folding + width normalisation). A greeting is one of the week's
// greeting phrases (from the phrase bank "use" field or a dialogue line that matches it).

import { isJapanesePracticeText } from '../tts/readiness.js'
import { scoreSpokenLine, normalizeForComparison } from './similarity.js'

// Japanese runs embedded in a (mostly English) instruction, de-duplicated and in order.
export function extractJapanesePhrases(sayTask) {
  if (typeof sayTask !== 'string') return []
  const matches = sayTask.match(/[\u3040-\u30ff\u3400-\u9fff]+/gu) || []
  const seen = new Set()
  const out = []
  for (const raw of matches) {
    const phrase = raw.trim()
    if (phrase.length >= 2 && !seen.has(phrase)) {
      seen.add(phrase)
      out.push(phrase)
    }
  }
  return out
}

// Greeting candidates for a lesson: phrase-bank entries whose "use" reads like a greeting, plus any
// dialogue line that exactly matches one of those greetings (so we reuse the phrase-bank wording).
// `speechTargets` is already the object returned by getLessonSpeechTargets ({ dialogue, phrases, … }).
export function extractGreetings(speechTargets) {
  const phrases = Array.isArray(speechTargets?.phrases) ? speechTargets.phrases : []
  const dialogue = Array.isArray(speechTargets?.dialogue) ? speechTargets.dialogue : []
  const keyOf = (ja) => normalizeForComparison(ja)
  const seen = new Set()
  const out = []
  const add = (ja, meaning) => {
    const key = keyOf(ja)
    if (!ja || !key || seen.has(key)) return
    seen.add(key)
    out.push({ ja, meaning })
  }
  for (const phrase of phrases) {
    const use = (phrase.use || '').toLowerCase()
    if (!/greeting|hello|welcome|goodbye|good night/i.test(use)) continue
    add(phrase.ja, phrase.en)
  }
  for (const line of dialogue) {
    if (!isJapanesePracticeText(line.ja)) continue
    const key = keyOf(line.ja)
    if (!key || seen.has(key)) continue
    if (phrases.some((phrase) => keyOf(phrase.ja) === key)) add(line.ja, line.en)
  }
  return out
}

// Score a recorded transcript against the say task. Returns per-check pass/fail plus what was heard.
export function scoreSayTask(sayTask, greetingTargets, instructionPhrases, transcript) {
  const checks = []
  const heard = normalizeForComparison(transcript)
  const hasHeard = heard.length > 0

  for (const greeting of greetingTargets || []) {
    const target = normalizeForComparison(greeting.ja)
    if (!target) continue
    checks.push({ id: 'greeting', detail: greeting.ja, meaning: greeting.meaning, ok: hasHeard && heard.includes(target) })
    break
  }

  for (const phrase of instructionPhrases || []) {
    const target = normalizeForComparison(phrase)
    if (!target) continue
    const score = scoreSpokenLine(phrase, transcript)
    const ok = hasHeard && heard.includes(target)
    checks.push({ id: `phrase-${target}`, detail: phrase, meaning: null, ok, score: score.score })
  }

  const passed = checks.length > 0 && checks.every((check) => check.ok)
  return { passed, checks, heard, hasHeard }
}
