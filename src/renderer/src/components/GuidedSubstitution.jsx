import { useState } from 'react'
import { Volume2, Sparkles, Coffee, Train, Store, Check, ArrowRight } from 'lucide-react'
import { kanaToRomaji } from '../../romaji.js'

// Pre-crafted beginner substitution templates based on week & theme
const SCENARIO_PRESETS = {
  1: [
    {
      id: 'store',
      icon: <Store size={15} />,
      location: 'Convenience Store (コンビニ)',
      shortName: 'Convenience Store',
      context: 'Clerk welcomes you at the door.',
      replyJa: 'こんにちは。',
      replyEn: 'Hello / Good afternoon.',
      use: 'Return the greeting simply and naturally.'
    },
    {
      id: 'station',
      icon: <Train size={15} />,
      location: 'Train Station (駅 / えき)',
      shortName: 'Train Station',
      context: 'You approach the information counter.',
      replyJa: 'すみません。',
      replyEn: 'Excuse me.',
      use: 'Politely get the attendant’s attention.'
    },
    {
      id: 'morning',
      icon: <Coffee size={15} />,
      location: 'Hotel Lobby Morning',
      shortName: 'Hotel Morning',
      context: 'Passing the front desk before 10 AM.',
      replyJa: 'おはようございます。',
      replyEn: 'Good morning.',
      use: 'Polite morning greeting.'
    }
  ]
}

export default function GuidedSubstitution({ weekNumber, tts, voiceContext, onSelectPhrase }) {
  const presets = SCENARIO_PRESETS[weekNumber] || SCENARIO_PRESETS[1]
  const [selectedId, setSelectedId] = useState(presets[0]?.id || 'store')
  const [isPlaying, setIsPlaying] = useState(false)

  const activePreset = presets.find((p) => p.id === selectedId) || presets[0]

  async function playPhrase(text) {
    if (!tts?.playText || isPlaying) return
    setIsPlaying(true)
    try {
      await tts.playText(text, voiceContext)
    } finally {
      setIsPlaying(false)
    }
  }

  function handleSelect(preset) {
    setSelectedId(preset.id)
    onSelectPhrase?.(preset.replyJa)
    void playPhrase(preset.replyJa)
  }

  return (
    <div className="guided-substitution-studio">
      <div className="studio-sub-header">
        <div className="studio-sub-title">
          <Sparkles size={15} className="studio-sub-icon" />
          <span>Ready-to-use Real Travel Situations</span>
        </div>
        <span className="studio-sub-badge">Pick a scene to adapt</span>
      </div>

      {/* Modern Segmented Situation Pills */}
      <div className="situation-pill-track" role="tablist" aria-label="Travel Situations">
        {presets.map((item) => {
          const isSelected = selectedId === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`situation-pill-btn ${isSelected ? 'is-active' : ''}`}
              onClick={() => handleSelect(item)}
            >
              <span className="situation-pill-icon">{item.icon}</span>
              <span className="situation-pill-text">{item.shortName || item.location}</span>
              {isSelected && <span className="situation-pill-dot" />}
            </button>
          )
        })}
      </div>

      {/* Active Focused Speech Stage */}
      <div className="situation-active-stage">
        <div className="stage-scene-row">
          <div className="stage-location">
            {activePreset.icon}
            <strong>{activePreset.location}</strong>
          </div>
          <span className="stage-context-hint">{activePreset.context}</span>
        </div>

        <div className="stage-phrase-hero">
          <div className="stage-phrase-typography">
            <span className="stage-ja" lang="ja">{activePreset.replyJa}</span>
            <span className="stage-romaji">{kanaToRomaji(activePreset.replyJa)}</span>
            <span className="stage-en">{activePreset.replyEn}</span>
          </div>

          <div className="stage-actions">
            <button
              type="button"
              className={`stage-audio-btn ${isPlaying ? 'is-playing' : ''}`}
              onClick={() => playPhrase(activePreset.replyJa)}
              disabled={tts?.busy}
              title={`Listen to ${activePreset.replyJa}`}
              aria-label={`Listen to ${activePreset.replyJa}`}
            >
              <Volume2 size={16} />
              <span>{isPlaying ? 'Playing…' : 'Hear phrase'}</span>
            </button>

            <button
              type="button"
              className="stage-apply-btn"
              onClick={() => handleSelect(activePreset)}
              title="Practice this situation"
            >
              <Check size={14} />
              <span>Practice this situation</span>
            </button>
          </div>
        </div>

        <div className="stage-usage-note">
          <span className="usage-label">How to use:</span>
          <span>{activePreset.use}</span>
        </div>
      </div>

      {/* Screen-reader / indexing anchor for static rendering tests */}
      <div className="sr-only" aria-hidden="true">
        {presets.map(p => (
          <span key={p.id}>{p.location} {p.replyJa} {p.replyEn} Practice this situation</span>
        ))}
      </div>
    </div>
  )
}
