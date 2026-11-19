import { describe, expect, test, mock } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('../src/renderer/src/asr/useAsr.js', () => ({
  useAsr: () => ({
    readiness: { ready: true, message: 'ready' },
    result: null,
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
    clearResult: () => {},
    startRecording: async () => {},
    stopRecording: () => {},
    cancelRecording: () => {},
    cancelTranscription: async () => ({ cancelled: false }),
    warmWorker: async () => {},
  })
}))

import SoundPrimer from '../src/renderer/src/components/SoundPrimer.jsx'
import InteractiveExchange from '../src/renderer/src/components/InteractiveExchange.jsx'
import GuidedSubstitution from '../src/renderer/src/components/GuidedSubstitution.jsx'

describe('SoundPrimer component', () => {
  test('renders 5 pure vowel tiles with pronunciation guides', () => {
    const html = renderToStaticMarkup(
      React.createElement(SoundPrimer, {
        tts: { playText: async () => {} },
        voiceContext: {},
        initiallyExpanded: true
      })
    )
    expect(html).toContain('The 5 Pure Vowels')
    expect(html).toContain('あ')
    expect(html).toContain('い')
    expect(html).toContain('う')
    expect(html).toContain('え')
    expect(html).toContain('お')
    expect(html).toContain('/ah/')
    expect(html).toContain('/ee/')
    expect(html).toContain('K-Row')
  })
})

describe('InteractiveExchange component', () => {
  const sampleDialogue = [
    { speaker: 'staff', ja: 'こんにちは。いらっしゃいませ。', en: 'Hello. Welcome.' },
    { speaker: 'traveller', ja: 'こんにちは。', en: 'Hello.' },
    { speaker: 'staff', ja: 'ごよやくのおなまえをおねがいします。', en: 'May I have the name on the reservation?' }
  ]

  test('renders turn 1 with NPC speaker and audio prompt', () => {
    const html = renderToStaticMarkup(
      React.createElement(InteractiveExchange, {
        dialogue: sampleDialogue,
        tts: { playText: async () => {}, busy: false, isPlaying: false },
        voiceContext: {},
        progress: {},
        romajiMode: 'adaptive',
        onOpenVoiceLab: () => {},
        onFinish: () => {}
      })
    )
    expect(html).toContain('Turn 1 of 3')
    expect(html).toContain('Hotel Receptionist')
    expect(html).toContain('こんにちは。いらっしゃいませ。')
    expect(html).toContain('Hear line')
    expect(html).toContain('Your turn to reply')
  })
})

describe('GuidedSubstitution component', () => {
  test('renders practical travel situation cards with Japanese phrases', () => {
    const html = renderToStaticMarkup(
      React.createElement(GuidedSubstitution, {
        weekNumber: 1,
        tts: { playText: async () => {} },
        voiceContext: {},
        onSelectPhrase: () => {}
      })
    )
    expect(html).toContain('Ready-to-use Real Travel Situations')
    expect(html).toContain('Convenience Store')
    expect(html).toContain('Train Station')
    expect(html).toContain('こんにちは。')
    expect(html).toContain('すみません。')
    expect(html).toContain('Practice this situation')
  })
})
