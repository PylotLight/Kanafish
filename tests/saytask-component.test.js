import { describe, expect, test, mock } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Control the built-in ASR hook: readiness and a scored transcript, plus no-op lifecycle calls.
const state = { ready: true }
let transcript = ''
const calls = { start: 0, stop: 0, clear: 0 }

mock.module('../src/renderer/src/asr/useAsr.js', () => ({
  useAsr: () => ({
    readiness: { ready: state.ready, message: 'ready for on-device Japanese speech' },
    result: transcript ? { text: transcript } : null,
    recording: false,
    streaming: false,
    transcribing: false,
    recordSeconds: 0,
    warming: false,
    starting: false,
    cancelling: false,
    liveText: '',
    error: '',
    status: {},
    clearResult: () => { calls.clear += 1 },
    startRecording: async () => { calls.start += 1 },
    stopRecording: () => { calls.stop += 1 },
    cancelRecording: () => {},
    cancelTranscription: async () => ({ cancelled: false }),
    warmWorker: async () => {},
  })
}))

// Import after mocking so the hook resolves to the mock.
import SayTaskPractice from '../src/renderer/src/asr/SayTaskPractice.jsx'

const baseProps = {
  sayTask: 'Say a greeting, then say すみせん to get the receptionist\'s attention.',
  greetingTargets: [{ ja: 'こんにちは。', meaning: 'Hello / good afternoon.' }],
  instructionPhrases: ['みせん'],
  successChecks: ['Recognizes a greeting', 'Chooses a polite greeting in return', 'Uses すみせん to open a request'],
  tts: { playText: async () => {} },
  voiceContext: {},
  progress: {},
  romajiMode: 'adaptive',
  onPatch: () => {},
  onOpenVoiceLab: () => {},
  session: {},
}

function render(props = baseProps) {
  return renderToStaticMarkup(React.createElement(SayTaskPractice, props))
}

describe('SayTaskPractice rendering', () => {
  test('renders the record button when recognition is ready', () => {
    const html = render()
    expect(html).toContain('Record my answer')
    expect(calls.start).toBe(0)
  })

  test('renders the "Recording is optional" fallback when recognition is not set up', () => {
    state.ready = false
    const html = render()
    expect(html).toContain('Recording is optional')
    state.ready = true
  })

  test('renders what the recognizer heard plus per-check pass/fail once a transcript is scored', () => {
    transcript = 'こんにちは、みせん'
    const html = render()
    expect(html).toContain('WHAT THE RECOGNIZER HEARD')
    // Both the greeting and the polite opener are present and said → "said it" appears twice.
    expect(html.match(/said it/g) || []).toHaveLength(2)
    // The greeting detail (Hello。) and the opener detail (みせん) appear in the checks.
    expect(html).toContain('こんにちは。')
    expect(html).toContain('みせん')
    transcript = ''
  })

  test('marks the pending (not-yet-said) checks when the transcript is incomplete', () => {
    transcript = 'こんにちは' // only the greeting, opener missing
    const html = render()
    expect(html).toContain('say it again')
    transcript = ''
  })
})
