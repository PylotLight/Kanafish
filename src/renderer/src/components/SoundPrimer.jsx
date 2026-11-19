import { useState } from 'react'
import { Volume2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

const VOWELS = [
  { kana: 'あ', romaji: 'a', sound: 'ah', example: 'like "father"' },
  { kana: 'い', romaji: 'i', sound: 'ee', example: 'like "feet"' },
  { kana: 'う', romaji: 'u', sound: 'oo', example: 'like "food"' },
  { kana: 'え', romaji: 'e', sound: 'eh', example: 'like "bed"' },
  { kana: 'お', romaji: 'o', sound: 'oh', example: 'like "home"' },
]

const KA_GROUP = [
  { kana: 'か', romaji: 'ka' },
  { kana: 'き', romaji: 'ki' },
  { kana: 'く', romaji: 'ku' },
  { kana: 'け', romaji: 'ke' },
  { kana: 'こ', romaji: 'ko' },
]

export default function SoundPrimer({ tts, voiceContext, initiallyExpanded = true }) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
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
    <div className="sound-primer-card">
      <button
        type="button"
        className="sound-primer-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="sound-primer-title">
          <span className="sound-primer-icon"><Sparkles size={16} /></span>
          <div>
            <strong>Japanese Sound Basics: The 5 Pure Vowels</strong>
            <small>All Japanese syllables are formed from these 5 clean vowel sounds.</small>
          </div>
        </div>
        <span className="sound-primer-toggle">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="sound-primer-body">
          <p className="sound-primer-lead">
            Tap any tile to hear its clear native pronunciation. Notice how every vowel stays crisp and unmixed:
          </p>
          <div className="vowel-grid" role="group" aria-label="Five basic Japanese vowels">
            {VOWELS.map((item) => {
              const isPlaying = playingChar === item.kana
              return (
                <button
                  key={item.kana}
                  type="button"
                  className={`vowel-tile ${isPlaying ? 'is-playing' : ''}`}
                  onClick={() => playSound(item.kana)}
                  aria-label={`Listen to ${item.kana}, romanized ${item.romaji}, pronounced ${item.sound}`}
                >
                  <span className="vowel-kana" lang="ja">{item.kana}</span>
                  <strong className="vowel-romaji">{item.romaji}</strong>
                  <span className="vowel-sound">/{item.sound}/</span>
                  <small className="vowel-example">{item.example}</small>
                  <span className="vowel-listen-hint">
                    <Volume2 size={12} /> {isPlaying ? 'Playing' : 'Tap'}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="sound-primer-subgroup">
            <span className="subgroup-label">K-Row (Consonant + Vowel):</span>
            <div className="subgroup-chips">
              {KA_GROUP.map((item) => (
                <button
                  key={item.kana}
                  type="button"
                  className={`subgroup-chip ${playingChar === item.kana ? 'is-playing' : ''}`}
                  onClick={() => playSound(item.kana)}
                  title={`Listen to ${item.kana} (${item.romaji})`}
                >
                  <span lang="ja">{item.kana}</span>
                  <small>{item.romaji}</small>
                  <Volume2 size={11} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
