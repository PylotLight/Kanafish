import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, Check, ChevronLeft, ChevronRight, Mic, RotateCcw, Sparkles, Volume2, X } from 'lucide-react'
import { useAsr } from '../asr/useAsr.js'
import { scoreSpokenLine } from '../asr/similarity.js'
import { kanaToRomaji } from '../../romaji.js'
import { shouldShowRomaji } from '../../learning.js'

const isUserSpeaker = (speaker) => {
  const s = String(speaker).toLowerCase()
  return s.includes('traveller') || s === 'visitor' || s === 'you'
}

const labelSpeaker = (speaker) => ({
  staff: 'Hotel Receptionist', traveller: 'You (Traveller)', travellerA: 'Traveller A', travellerB: 'Traveller B',
  guest: 'Guest', host: 'Host', visitor: 'You (Visitor)', friend: 'Friend', guide: 'Tour Guide',
  clerk: 'Shop Clerk', waiter: 'Server', customer: 'Customer', stationStaff: 'Station Attendant'
}[speaker] || speaker.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))

export default function InteractiveExchange({
  dialogue,
  tts,
  voiceContext,
  progress,
  romajiMode,
  onOpenVoiceLab,
  onFinish
}) {
  const asr = useAsr()
  const [turnIndex, setTurnIndex] = useState(0)
  const [completedTurns, setCompletedTurns] = useState(() => new Set())
  const [hasPracticedSpeaking, setHasPracticedSpeaking] = useState(false)
  const [showMeaning, setShowMeaning] = useState(true)
  const warmStarted = useRef(false)

  const currentLine = dialogue[turnIndex] || dialogue[0]
  const isUserTurn = isUserSpeaker(currentLine.speaker)
  const isLastTurn = turnIndex === dialogue.length - 1
  const allCompleted = completedTurns.size >= dialogue.length

  const asrReady = asr.readiness.ready
  const spokenScore = asr.result && isUserTurn ? scoreSpokenLine(currentLine.ja, asr.result.text) : null

  // Prewarm ASR if user reaches their speaking turn
  useEffect(() => {
    if (isUserTurn && asrReady && !asr.warming && !warmStarted.current) {
      warmStarted.current = true
      void asr.warmWorker().catch(() => {})
    }
  }, [isUserTurn, asrReady, asr.warming, asr.warmWorker])

  // Mark turn completed if spoken successfully
  useEffect(() => {
    if (spokenScore && (spokenScore.verdict === 'match' || spokenScore.verdict === 'close')) {
      setHasPracticedSpeaking(true)
      setCompletedTurns((prev) => new Set([...prev, turnIndex]))
    }
  }, [spokenScore, turnIndex])

  // Play line audio
  async function playLine(line) {
    if (!tts?.playText) return
    try {
      await tts.playText(line.ja, voiceContext)
    } catch {}
  }

  function advanceTurn() {
    asr.clearResult()
    setHasPracticedSpeaking(false)
    setCompletedTurns((prev) => new Set([...prev, turnIndex]))
    if (turnIndex < dialogue.length - 1) {
      const nextIndex = turnIndex + 1
      setTurnIndex(nextIndex)
      // If next is NPC turn, auto play after a small delay
      const nextLine = dialogue[nextIndex]
      if (!isUserSpeaker(nextLine.speaker)) {
        setTimeout(() => playLine(nextLine), 350)
      }
    } else {
      onFinish?.()
    }
  }

  function prevTurn() {
    if (turnIndex > 0) {
      asr.clearResult()
      setTurnIndex(turnIndex - 1)
    }
  }

  function restartExchange() {
    asr.clearResult()
    setTurnIndex(0)
    setCompletedTurns(new Set())
    setHasPracticedSpeaking(false)
    const firstLine = dialogue[0]
    if (firstLine && !isUserSpeaker(firstLine.speaker)) {
      setTimeout(() => playLine(firstLine), 350)
    }
  }

  const romaji = currentLine && shouldShowRomaji(currentLine.ja, progress, romajiMode)
    ? kanaToRomaji(currentLine.ja)
    : ''

  return (
    <div className="interactive-exchange-card">
      <div className="exchange-topbar">
        <div className="exchange-progress-badge">
          <span className="exchange-step-num">Turn {turnIndex + 1} of {dialogue.length}</span>
          <span className="exchange-turn-role">{isUserTurn ? '🎯 Your turn to reply' : '👂 Listen to the prompt'}</span>
        </div>
        <div className="exchange-controls">
          <button
            type="button"
            className="outline-button exchange-mini-btn"
            onClick={() => setShowMeaning((v) => !v)}
          >
            {showMeaning ? 'Hide English' : 'Show English'}
          </button>
          <button
            type="button"
            className="outline-button exchange-mini-btn"
            onClick={restartExchange}
            title="Start exchange from turn 1"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>

      <div className="exchange-timeline">
        {dialogue.map((line, idx) => {
          const isDone = completedTurns.has(idx)
          const isCurrent = idx === turnIndex
          const userLine = isUserSpeaker(line.speaker)
          return (
            <button
              key={`${idx}-${line.speaker}`}
              type="button"
              className={`timeline-dot ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''} ${userLine ? 'is-user' : 'is-npc'}`}
              onClick={() => {
                asr.clearResult()
                setTurnIndex(idx)
              }}
              title={`Jump to turn ${idx + 1}: ${labelSpeaker(line.speaker)}`}
            >
              {isDone ? <Check size={11} /> : idx + 1}
            </button>
          )
        })}
      </div>

      <div className={`exchange-stage ${isUserTurn ? 'exchange-user-stage' : 'exchange-npc-stage'}`}>
        <div className="exchange-speaker-header">
          <span className={`speaker-tag ${isUserTurn ? 'speaker-user-tag' : 'speaker-npc-tag'}`}>
            {labelSpeaker(currentLine.speaker)}
          </span>
          <button
            type="button"
            className="exchange-audio-btn"
            onClick={() => playLine(currentLine)}
            disabled={tts.busy}
            aria-label={`Listen to ${currentLine.ja}`}
          >
            <Volume2 size={15} /> <span>{tts.isPlaying ? 'Playing…' : 'Hear line'}</span>
          </button>
        </div>

        <div className="exchange-bubble">
          <strong className="exchange-japanese" lang="ja">{currentLine.ja}</strong>
          {romaji && <small className="exchange-romaji" lang="ja-Latn">{romaji}</small>}
          {showMeaning && <p className="exchange-english">{currentLine.en}</p>}
        </div>

        {/* Action Panel for Current Turn */}
        {isUserTurn ? (
          <div className="exchange-user-actions">
            <div className="user-action-prompt">
              <Sparkles size={15} />
              <span>Say this response aloud, or tap to advance:</span>
            </div>

            <div className="user-action-row">
              {asrReady ? (
                <button
                  type="button"
                  className={`primary-button asr-record-btn ${asr.recording ? 'recording' : ''}`}
                  onClick={() => {
                    if (asr.recording) asr.stopRecording()
                    else void asr.startRecording()
                  }}
                  disabled={asr.transcribing || asr.starting || asr.warming}
                >
                  <Mic size={15} />
                  {asr.recording
                    ? `Stop (${asr.recordSeconds.toFixed(1)}s)`
                    : asr.transcribing
                      ? 'Recognizing…'
                      : 'Speak into mic'}
                </button>
              ) : (
                <button
                  type="button"
                  className="outline-button"
                  onClick={onOpenVoiceLab}
                  title="Configure on-device speech recognition"
                >
                  <Mic size={14} /> Speech setup optional
                </button>
              )}

              <button
                type="button"
                className="outline-button"
                onClick={() => playLine(currentLine)}
                disabled={tts.busy}
              >
                <Volume2 size={14} /> Shadow voice
              </button>

              <button
                type="button"
                className="primary-button advance-btn"
                onClick={advanceTurn}
              >
                <span>{isLastTurn ? 'Complete exchange' : 'Reply & Next'}</span>
                <ArrowRight size={15} />
              </button>
            </div>

            {/* ASR Feedback */}
            {asr.recording && asr.streaming && (
              <div className="exchange-live-transcription" role="status">
                <Activity size={13} className="spin-slow" />
                <span>Listening: </span>
                <strong lang="ja">{asr.liveText || '…'}</strong>
              </div>
            )}

            {spokenScore && (
              <div className={`exchange-speech-feedback feedback-${spokenScore.verdict}`}>
                {spokenScore.verdict === 'match' || spokenScore.verdict === 'close' ? (
                  <>
                    <Check size={16} />
                    <div>
                      <strong>Nicely spoken!</strong>
                      <span>Heard: &quot;{spokenScore.heard}&quot;</span>
                    </div>
                  </>
                ) : (
                  <>
                    <RotateCcw size={16} />
                    <div>
                      <strong>Keep practicing:</strong>
                      <span>Heard: &quot;{spokenScore.heard || 'Nothing recognized'}&quot; — try speaking clearly near your microphone.</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="exchange-npc-actions">
            <span className="npc-instruction">
              Listen to the receptionist, then advance to your turn.
            </span>
            <button
              type="button"
              className="primary-button advance-btn"
              onClick={advanceTurn}
            >
              <span>Your turn to reply</span>
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="exchange-footer-nav">
        <button
          type="button"
          className="quiet-button"
          onClick={prevTurn}
          disabled={turnIndex === 0}
        >
          <ChevronLeft size={15} /> Previous turn
        </button>
        <span className="exchange-turn-dots">
          {turnIndex + 1} / {dialogue.length}
        </span>
        <button
          type="button"
          className="quiet-button"
          onClick={advanceTurn}
        >
          {isLastTurn ? 'Finish' : 'Next'} <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}
