import { useState } from 'react'
import { Volume2, Mic, Check, Sparkles, Lightbulb, Activity, RotateCcw } from 'lucide-react'
import { useAsr } from '../asr/useAsr.js'
import { scoreSpokenLine } from '../asr/similarity.js'
import { kanaToRomaji } from '../../romaji.js'

const TRAVEL_PHRASES = [
  {
    ja: 'すみません。',
    en: 'Excuse me / Sorry / Thank you',
    tip: 'The ultimate Japanese survival word! Use it to get a waiter’s attention, apologize for bumping into someone, or thank someone who held an elevator.',
    situation: 'Restaurant / Street / Train'
  },
  {
    ja: 'これをおねがいします。',
    en: 'This one, please.',
    tip: 'Point to any menu item, train ticket, or convenience store item and say this. It works everywhere!',
    situation: 'Café & Ordering'
  },
  {
    ja: 'おいくらですか。',
    en: 'How much is it?',
    tip: 'Useful at markets, souvenir shops, and street food stalls. Point at the item and ask politely.',
    situation: 'Shopping & Markets'
  },
  {
    ja: 'だいじょうぶです。',
    en: 'It’s okay / I’m fine / No thank you.',
    tip: 'Use with a polite hand wave to decline a plastic bag (レジ袋) or say you’re all good.',
    situation: 'Convenience Stores'
  },
  {
    ja: 'おすすめはなんですか。',
    en: 'What do you recommend?',
    tip: 'Servers in izakayas and ramen shops love this question. They will point to their freshest daily specialty!',
    situation: 'Dining & Izakaya'
  }
]

export default function DailyPhraseWidget({ tts, voiceContext }) {
  // Rotate phrase based on day of year so each day has a fresh survival phrase
  const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % TRAVEL_PHRASES.length
  const phrase = TRAVEL_PHRASES[dayIndex]
  const romaji = kanaToRomaji(phrase.ja)

  const asr = useAsr()
  const asrReady = asr.readiness.ready
  const [isPlaying, setIsPlaying] = useState(false)
  const spokenScore = asr.result ? scoreSpokenLine(phrase.ja, asr.result.text) : null

  async function playPhrase() {
    if (!tts?.playText || isPlaying) return
    setIsPlaying(true)
    try {
      await tts.playText(phrase.ja, voiceContext)
    } finally {
      setIsPlaying(false)
    }
  }

  return (
    <div className="daily-phrase-card">
      <div className="daily-phrase-header">
        <span className="daily-phrase-tag">
          <Sparkles size={13} /> TRAVEL SURVIVAL PHRASE
        </span>
        <span className="daily-phrase-situation">{phrase.situation}</span>
      </div>

      <div className="daily-phrase-main">
        <div className="daily-phrase-text-block">
          <strong className="daily-phrase-ja" lang="ja">{phrase.ja}</strong>
          <small className="daily-phrase-romaji">{romaji}</small>
          <span className="daily-phrase-en">{phrase.en}</span>
        </div>

        <div className="daily-phrase-controls">
          <button
            type="button"
            className={`phrase-audio-circle-btn ${isPlaying ? 'is-playing' : ''}`}
            onClick={playPhrase}
            disabled={tts.busy}
            title="Listen to phrase audio"
            aria-label={`Listen to ${phrase.ja}`}
          >
            <Volume2 size={16} />
          </button>
          
          {asrReady && (
            <button
              type="button"
              className={`phrase-mic-circle-btn ${asr.recording ? 'recording' : ''}`}
              onClick={() => {
                if (asr.recording) asr.stopRecording()
                else void asr.startRecording()
              }}
              disabled={asr.transcribing || asr.starting || asr.warming}
              title={asr.recording ? 'Stop recording' : 'Practice saying this phrase'}
              aria-label="Practice speaking"
            >
              <Mic size={15} />
            </button>
          )}
        </div>
      </div>

      {asr.recording && asr.streaming && (
        <div className="daily-phrase-stream" role="status">
          <Activity size={12} className="spin-slow" />
          <span>Listening: <strong lang="ja">{asr.liveText || '…'}</strong></span>
        </div>
      )}

      {spokenScore && (
        <div className={`daily-phrase-feedback feedback-${spokenScore.verdict}`}>
          {spokenScore.verdict === 'match' || spokenScore.verdict === 'close' ? (
            <>
              <Check size={14} />
              <span>Great pronunciation! Heard &quot;{spokenScore.heard}&quot;</span>
            </>
          ) : (
            <>
              <RotateCcw size={14} />
              <span>Heard: &quot;{spokenScore.heard || 'Nothing recognized'}&quot; — try speaking clearly near your mic.</span>
            </>
          )}
        </div>
      )}

      <div className="daily-phrase-tip">
        <Lightbulb size={13} className="tip-icon" />
        <p>{phrase.tip}</p>
      </div>
    </div>
  )
}
