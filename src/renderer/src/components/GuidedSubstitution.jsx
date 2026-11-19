import { useState } from 'react'
import { Volume2, Sparkles, MapPin, Coffee, Train, Store, Check } from 'lucide-react'
import { kanaToRomaji } from '../../romaji.js'

// Pre-crafted beginner substitution templates based on week & theme
const SCENARIO_PRESETS = {
  1: [
    {
      id: 'store',
      icon: <Store size={16} />,
      location: 'Convenience Store (コンビニ)',
      context: 'Clerk welcomes you at the door.',
      replyJa: 'こんにちは。',
      replyEn: 'Hello / Good afternoon.',
      use: 'Return the greeting simply and naturally.'
    },
    {
      id: 'station',
      icon: <Train size={16} />,
      location: 'Train Station (駅 / えき)',
      context: 'You approach the information counter.',
      replyJa: 'すみません。',
      replyEn: 'Excuse me.',
      use: 'Politely get the attendant’s attention.'
    },
    {
      id: 'morning',
      icon: <Coffee size={16} />,
      location: 'Hotel Lobby Morning',
      context: 'Passing the front desk before 10 AM.',
      replyJa: 'おはようございます。',
      replyEn: 'Good morning.',
      use: 'Polite morning greeting.'
    }
  ]
}

export default function GuidedSubstitution({ weekNumber, tts, voiceContext, onSelectPhrase }) {
  const [selectedId, setSelectedId] = useState(null)
  const presets = SCENARIO_PRESETS[weekNumber] || SCENARIO_PRESETS[1]

  async function playPhrase(text) {
    if (!tts?.playText) return
    try {
      await tts.playText(text, voiceContext)
    } catch {}
  }

  return (
    <div className="guided-substitution-card">
      <div className="guided-sub-head">
        <Sparkles size={16} className="guided-sub-icon" />
        <div>
          <strong>Ready-to-use Real Travel Situations</strong>
          <small>Tap to hear how your greeting adapts to different places in Japan:</small>
        </div>
      </div>

      <div className="guided-sub-grid">
        {presets.map((item) => {
          const isSelected = selectedId === item.id
          const romaji = kanaToRomaji(item.replyJa)
          return (
            <div
              key={item.id}
              className={`substitution-tile ${isSelected ? 'is-selected' : ''}`}
            >
              <div className="sub-tile-header">
                <span className="sub-tile-location">
                  {item.icon} {item.location}
                </span>
                <button
                  type="button"
                  className="sub-tile-audio"
                  onClick={() => playPhrase(item.replyJa)}
                  title={`Listen to ${item.replyJa}`}
                >
                  <Volume2 size={13} />
                </button>
              </div>

              <p className="sub-tile-context">{item.context}</p>

              <div className="sub-tile-phrase">
                <span className="sub-phrase-ja" lang="ja">{item.replyJa}</span>
                {romaji && <small className="sub-phrase-romaji">{romaji}</small>}
                <span className="sub-phrase-en">{item.replyEn}</span>
              </div>

              <div className="sub-tile-actions">
                <button
                  type="button"
                  className={`sub-tile-select-btn ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedId(item.id)
                    onSelectPhrase?.(item.replyJa)
                    void playPhrase(item.replyJa)
                  }}
                >
                  {isSelected ? <><Check size={13} /> Selected</> : 'Practice this situation'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
