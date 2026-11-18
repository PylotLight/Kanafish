import { useEffect, useRef, useState } from 'react'
import { Activity, AlertCircle, Check, Mic, RotateCcw, Volume2, X } from 'lucide-react'
import { scoreSpokenLine } from './similarity.js'
import { useAsr } from './useAsr.js'
import { kanaToRomaji } from '../../romaji.js'
import { getRatingIntervals, shouldShowRomaji } from '../../learning.js'

const RATINGS = [
  { id: 'again', label: 'Need another try' },
  { id: 'hard', label: 'A bit tricky' },
  { id: 'good', label: 'Comfortable' },
  { id: 'easy', label: 'Felt easy' },
]

const todayISO = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

export default function LessonSpeakingPractice({ targets, tts, voiceContext, progress, romajiMode, onRate, onOpenVoiceLab }) {
  const asr = useAsr()
  const [selectedId, setSelectedId] = useState(targets[0]?.id || '')
  const [showTarget, setShowTarget] = useState(false)
  const [selfAttempted, setSelfAttempted] = useState(false)
  const [rated, setRated] = useState(false)
  const [warmFailed, setWarmFailed] = useState(false)
  const warmStarted = useRef(false)
  const target = targets.find((item) => item.id === selectedId) || targets[0]
  const score = asr.result && target ? scoreSpokenLine(target.text, asr.result.text) : null
  const asrReady = asr.readiness.ready
  const romaji = target && shouldShowRomaji(target.text, progress, romajiMode) ? kanaToRomaji(target.text) : ''
  const ratingIntervals = target ? getRatingIntervals(progress, target.id, todayISO()) : {}

  useEffect(() => {
    if (!asrReady || asr.warming || warmStarted.current) return
    warmStarted.current = true
    void asr.warmWorker().then(() => setWarmFailed(false)).catch(() => setWarmFailed(true))
  }, [asrReady, asr.warming, asr.warmWorker])

  useEffect(() => {
    if (asr.result) setWarmFailed(false)
  }, [asr.result])

  function retryWarmup() {
    if (asr.warming) return
    warmStarted.current = true
    setWarmFailed(false)
    void asr.warmWorker().then(() => setWarmFailed(false)).catch(() => setWarmFailed(true))
  }

  function chooseTarget(event) {
    setSelectedId(event.target.value)
    setShowTarget(false)
    setSelfAttempted(false)
    setRated(false)
    asr.clearResult()
  }

  function rate(rating) {
    if (!target) return
    onRate?.(target, rating)
    setRated(true)
  }

  const attempted = selfAttempted || Boolean(asr.result)
  return <section className="lesson-speech-panel" aria-labelledby="speaking-practice-heading">
    <div className="lesson-speech-heading">
      <span className="lesson-speech-icon"><Mic size={17} /></span>
      <div><span className="eyebrow">OPTIONAL SPEAKING PRACTICE</span><h3 id="speaking-practice-heading">Listen, say it, and reflect</h3></div>
      {asr.warming && <span className="speech-warm-pill" role="status"><Activity size={13} /> Warming local model</span>}
    </div>
    <p className="lesson-speech-intro">Listen to a model, try the line yourself, and optionally record it. Kanafish shows the text its recognizer heard; it does not grade pronunciation.</p>

    <label className="lesson-speech-select-label" htmlFor="lesson-speech-target">Choose a practice line</label>
    <select id="lesson-speech-target" className="lesson-speech-select" value={target?.id || ''} onChange={chooseTarget}>
      {targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>

    {target && <div className="lesson-speech-target">
      <div className="lesson-speech-target-top"><span>YOUR LINE</span><span>{target.meaning}</span></div>
      <strong lang="ja" className={showTarget ? '' : 'lesson-speech-target-hidden'}>{showTarget ? target.text : 'Try from memory, or reveal the Japanese cue.'}</strong>
      {showTarget && romaji && <small className="romaji-line" lang="ja-Latn">{romaji}</small>}
      {showTarget && target.detail && <small className="lesson-speech-target-detail">{target.detail}</small>}
      <div className="lesson-speech-actions">
        <button type="button" className="outline-button" onClick={() => setShowTarget((value) => !value)}>{showTarget ? 'Hide Japanese cue' : 'Reveal Japanese cue'}</button>
        <button type="button" className="outline-button" onClick={() => target && void tts.playText(target.text, { ...voiceContext }).catch(() => {})} disabled={!tts.activeEngineStatus?.ready || tts.busy} aria-label="Listen to the model line"><Volume2 size={14} /> Listen</button>
        <button type="button" className="outline-button" onClick={() => target && void tts.playText(target.text, { rate: 0.85, ...voiceContext }).catch(() => {})} disabled={!tts.activeEngineStatus?.ready || tts.busy}>Slow · 0.85×</button>
      </div>
    </div>}

    {!asrReady && <div className="lesson-speech-setup" role="status">
      <div><strong>Recording is optional</strong><span>{asr.readiness.message} You can still practise aloud and self-rate without setting up recognition.</span></div>
      <button type="button" className="text-link" onClick={onOpenVoiceLab}>Set up local speech <span aria-hidden="true">→</span></button>
    </div>}
    {asr.statusError && <div className="tts-inline-error" role="alert"><AlertCircle size={14} /> {asr.statusError}</div>}
    {asr.error && <div className="tts-inline-error" role="alert"><AlertCircle size={14} /> {asr.error}</div>}

    {asrReady && <div className="lesson-speech-recorder">
      <div className="lesson-speech-privacy"><span><Check size={13} /> On-device recognition</span><small>No audio or transcript is added to your saved progress.</small></div>
      <div className="lesson-speech-actions">
        <button type="button" className={`primary-button ${asr.recording ? 'recording' : ''}`} onClick={() => asr.recording ? asr.stopRecording() : void asr.startRecording()} disabled={asr.starting || asr.transcribing || asr.warming} aria-pressed={asr.recording}>
          {asr.recording ? <><X size={14} /> Stop · {asr.recordSeconds.toFixed(1)} s</> : <><Mic size={15} /> {asr.warming ? 'Warming…' : asr.starting ? 'Starting…' : asr.transcribing ? 'Recognizing…' : 'Record my line'}</>}
        </button>
        {asr.recording && <button type="button" className="outline-button" onClick={asr.cancelRecording}>Discard recording</button>}
        {asr.transcribing && <button type="button" className="outline-button" onClick={() => void asr.cancelTranscription()} disabled={asr.cancelling}>{asr.cancelling ? 'Cancelling…' : 'Cancel recognition'}</button>}
      </div>
      {warmFailed && <button type="button" className="text-link" onClick={retryWarmup} disabled={asr.warming}><RotateCcw size={13} /> Retry model warm-up</button>}
      {asr.transcribing && <div className="lesson-speech-progress" role="status"><Activity size={14} /> {asr.progress?.message || 'Recognizing on this device…'}</div>}
    </div>}

    {score && <div className="lesson-speech-result" role="status">
      <span className="eyebrow">WHAT THE RECOGNIZER HEARD</span>
      <strong lang="ja">{asr.result.text || 'No Japanese text was recognized.'}</strong>
      {score.heard && <span>Written-text resemblance: {score.score}%</span>}
      <small>This is a character-level comparison of the transcript and sample. It is not a pronunciation, accent, or fluency score; recognition can miss correctly spoken words or accept imperfect ones.</small>
      <button type="button" className="text-link" onClick={() => { asr.clearResult(); setSelfAttempted(false); setRated(false) }}><RotateCcw size={13} /> Try again</button>
    </div>}

    {!attempted && <button type="button" className="text-link lesson-self-attempt" onClick={() => setSelfAttempted(true)} disabled={asr.recording || asr.transcribing}><Check size={14} /> I tried saying it aloud</button>}
    {attempted && <div className="lesson-self-rating">
      <div><strong>How did it feel to recall?</strong><small>Your own rating chooses the review timing; the transcript does not.</small></div>
      {!rated ? <div className="lesson-self-rating-buttons">{RATINGS.map((rating) => { const days = ratingIntervals[rating.id] || 1; return <button type="button" key={rating.id} onClick={() => rate(rating.id)}><span>{rating.label}</span><small>Review in {days} day{days === 1 ? '' : 's'}</small></button> })}</div> : <div className="lesson-speech-scheduled" role="status"><Check size={14} /> Scheduled for a later review. You can continue whenever you’re ready.</div>}
    </div>}
  </section>
}
