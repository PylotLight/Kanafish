import { useEffect, useRef, useState } from 'react'
import { Activity, AlertCircle, Check, Mic, RotateCcw, X } from 'lucide-react'
import { useAsr } from './useAsr.js'
import { extractJapanesePhrases, extractGreetings, scoreSayTask } from './sayTask.js'

// Replaces the old "Attempt noted" checkbox on the "Make it yours" step (step 4). It records the learner
// speaking the say task, then scores the transcript against the key phrases the task names (a greeting +
// the polite opener). Falls back to an "I said it aloud" self-rate when local recognition is not set up.
export default function SayTaskPractice({
  sayTask,
  greetingTargets,
  instructionPhrases,
  successChecks,
  tts,
  voiceContext,
  progress,
  romajiMode,
  onPatch,
  onOpenVoiceLab,
  session
}) {
  const asr = useAsr()
  const [selfAttempted, setSelfAttempted] = useState(!!session?.sayTaskAttempted)
  const [warmFailed, setWarmFailed] = useState(false)
  const warmStarted = useRef(false)

  const asrReady = asr.readiness.ready

  // Score the latest transcript against the say task. Derived synchronously so the result shows on the
  // first paint after recognition; the effect below only persists the attempt.
  const scored = asr.result ? scoreSayTask(sayTask, greetingTargets, instructionPhrases, asr.result.text) : null

  useEffect(() => {
    if (!asrReady || asr.warming || warmStarted.current) return
    warmStarted.current = true
    void asr.warmWorker().then(() => setWarmFailed(false)).catch(() => setWarmFailed(true))
  }, [asrReady, asr.warming, asr.warmWorker])

  useEffect(() => {
    if (asr.result) setWarmFailed(false)
  }, [asr.result])

  useEffect(() => {
    if (scored?.passed) onPatch?.({ sayTaskAttempted: true })
  }, [scored])

  function retry() {
    asr.clearResult()
    setSelfAttempted(false)
  }

  function selfTry() {
    setSelfAttempted(true)
    onPatch?.({ sayTaskAttempted: true })
  }

  const attempted = selfAttempted || Boolean(scored)
  const passed = scored?.passed === true

  // ---- render helpers (block body avoids the ternary-with-JSX build quirk) ----
  function renderRecordButtonLabel() {
    if (asr.recording) return <><X size={14} /> Stop · {asr.recordSeconds.toFixed(1)} s</>
    if (asr.warming) return <><Mic size={15} /> Warming…</>
    if (asr.starting) return <><Mic size={15} /> Starting…</>
    if (asr.transcribing) return <><Mic size={15} /> Recognizing…</>
    return <><Mic size={15} /> Record my answer</>
  }

  function renderRecorder() {
    if (!asrReady) return null
    return <div className="say-task-recorder">
      <div className="say-task-privacy"><span><Check size={13} /> On-device recognition</span><small>No audio is added to your saved progress.</small></div>
      <div className="say-task-actions">
        <button type="button" className={`primary-button ${asr.recording ? 'recording' : ''}`} onClick={() => { if (asr.recording) asr.stopRecording(); else void asr.startRecording() }} disabled={asr.starting || asr.transcribing || asr.warming} aria-pressed={asr.recording}>{renderRecordButtonLabel()}</button>
        {asr.recording && <button type="button" className="outline-button" onClick={asr.cancelRecording}>Discard</button>}
        {asr.transcribing && <button type="button" className="outline-button" onClick={() => void asr.cancelTranscription()} disabled={asr.cancelling}>{asr.cancelling ? 'Cancelling…' : 'Cancel recognition'}</button>}
      </div>
      {warmFailed && <button type="button" className="text-link" onClick={() => { warmStarted.current = true; void asr.warmWorker().then(() => setWarmFailed(false)).catch(() => setWarmFailed(true)) }}><RotateCcw size={13} /> Retry model warm-up</button>}
      {asr.transcribing && <div className="say-task-progress" role="status"><Activity size={14} /> {asr.progress?.message || 'Recognizing on this device…'}</div>}
      {asr.recording && asr.streaming && <div className="say-task-live" role="status" aria-live="polite"><span><Activity size={14} /> LIVE DRAFT · MAY CHANGE</span><p lang="ja">{asr.liveText || 'Listening…'}</p></div>}
    </div>
  }

  function renderNotReady() {
    if (asrReady) return null
    return <div className="say-task-setup" role="status">
      <div><strong>Recording is optional</strong><span>{asr.readiness.message} You can still practise aloud and mark it tried without setting up recognition.</span></div>
      <button type="button" className="text-link" onClick={onOpenVoiceLab}>Set up local speech <span aria-hidden="true">→</span></button>
    </div>
  }

  function renderChecks() {
    if (!scored) return null
    const labels = Array.isArray(successChecks) ? successChecks : []
    return <div className="say-task-checks" aria-label={labels.length ? '' : 'What this practice invited you to say'}>
      <span className="eyebrow">WHAT THIS PRACTICE INVITED YOU TO SAY</span>
      {scored.checks.map((check) => <div key={check.id} className={`say-task-check ${check.ok ? 'is-pass' : 'is-pending'}`}>
        <Check size={14} aria-hidden="true" /><span><strong lang="ja">{check.detail}</strong>{check.meaning ? <small>{check.meaning}</small> : null}</span>{check.ok ? <span className="say-task-check-status">said it</span> : <span className="say-task-check-status">say it again</span>}
      </div>)}
    </div>
  }

  function renderResult() {
    if (!scored) return null
    return <div className="say-task-result" role="status">
      <span className="eyebrow">WHAT THE RECOGNIZER HEARD</span>
      <strong lang="ja">{asr.result.text || 'No Japanese text was recognized.'}</strong>
      <small>This is a character-level comparison of the transcript and sample; it is not a pronunciation score, and recognition can miss correctly spoken words or accept imperfect ones.</small>
      <button type="button" className="text-link" onClick={retry}><RotateCcw size={13} /> Try again</button>
    </div>
  }

  function renderDone() {
    if (!attempted) return null
    return <div className="say-task-done" role="status"><Check size={14} /> Noted — keep practising at your own pace.</div>
  }

  return <section className="say-task-practice" aria-label="Speak the conversation">
    {renderRecorder()}
    {renderNotReady()}
    {asr.error && <div className="tts-inline-error" role="alert"><AlertCircle size={14} /> {asr.error}</div>}
    {renderResult()}
    {renderChecks()}
    {!attempted && <button type="button" className="text-link say-task-self-try" onClick={selfTry}>I said it aloud</button>}
    {renderDone()}
  </section>
}
