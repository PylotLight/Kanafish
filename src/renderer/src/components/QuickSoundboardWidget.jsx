import { useState } from 'react'
import { Volume2, Music } from 'lucide-react'

const QUICK_VOWELS = [
  { kana: 'あ', romaji: 'a', sound: 'ah' },
  { kana: 'い', romaji: 'i', sound: 'ee' },
  { kana: 'う', romaji: 'u', sound: 'oo' },
  { kana: 'え', romaji: 'e', sound: 'eh' },
  { kana: 'お', romaji: 'o', sound: 'oh' },
]

export default function QuickSoundboardWidget({ tts, voiceContext }) {
  const [playingChar, setPlayingChar] = useState(null)

  async function playSound(char) {
    if (!tts?.playText) return
    setPlayingChar(char)
    try {
      await tts.playText(char, voiceContext)
    } finally {
      setPlayingChar(null)
    }
  }

  return (
    <div className="quick-soundboard-card">
      <div className="quick-soundboard-header">
        <div className="quick-soundboard-title">
          <Music size={14} className="soundboard-icon" />
          <span>Tune Your Ear: 5 Pure Japanese Vowels</span>
        </div>
        <small className="quick-soundboard-subtitle">Tap to listen</small>
      </div>

      <div className="quick-vowel-row">
        {QUICK_VOWELS.map((item) => (
          <button
            key={item.kana}
            type="button"
            className={`quick-vowel-btn ${playingChar === item.kana ? 'is-playing' : ''}`}
            onClick={() => playSound(item.kana)}
            title={`Listen to ${item.kana} (${item.romaji})`}
          >
            <span className="qv-kana" lang="ja">{item.kana}</span>
            <small className="qv-romaji">{item.romaji}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
