import { useState } from 'react'
import SpeechRecognitionPanel from '../asr/SpeechRecognitionPanel.jsx'
import { AlertCircle, Check, Download, LockKeyhole, Sparkles, Volume2 } from 'lucide-react'

const SAMPLE_LINES = [
  'こんにちは。',
  'すみません、東京駅までの行き方を教えていただけますか？',
  '電車は午後三時十五分に出発します。チケットは二枚、合計二千四百円です。',
  'ちょっと待ってください。コーヒーを一杯ください。ゆっくり話してもらえると助かります。'
]

function formatBytes(value = 0) {
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`
  return value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(2)} GB` : `${(value / 1_000_000).toFixed(0)} MB`
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} s` : '—'
}

export default function VoiceLabPage({ tts }) {
  const [text, setText] = useState(SAMPLE_LINES[0])
  const [lastResult, setLastResult] = useState(null)
  const [testError, setTestError] = useState('')
  const model = tts.modelStatus
  const progress = tts.downloadProgress
  const downloadPercent = progress?.totalBytes
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : 0
  const ready = Boolean(model?.installed)

  async function runSample(sample = text) {
    setText(sample)
    setTestError('')
    setLastResult(null)
    try {
      setLastResult(await tts.playText(sample))
    } catch (error) {
      setTestError(error?.message || 'Speech generation failed.')
    }
  }

  return <div className="content-page voice-lab-page page-enter">
    <div className="page-intro">
      <div className="eyebrow"><span className="eyebrow-line" /> LOCAL SPEECH</div>
      <h1>Voice Lab<span className="title-period">.</span></h1>
      <p>Supertonic 3 is the only speech engine enabled right now. Other experimental engines are hidden while the live setup is being checked; their code is retained but cannot be selected here.</p>
    </div>

    <div className="voice-lab-grid">
      <section className="voice-lab-panel voice-model-panel" aria-labelledby="active-voice-heading">
        <div className="voice-panel-heading">
          <span className="voice-panel-icon"><Sparkles size={18} /></span>
          <div><span className="eyebrow">ACTIVE LOCAL MODEL</span><h2 id="active-voice-heading">Supertonic 3</h2></div>
          <span className={`tts-status-tag ${ready ? 'status-runnable' : 'status-benchmark-only'}`}>{ready ? 'Ready' : 'Download needed'}</span>
        </div>
        <p className="voice-model-summary">Japanese and 30 other languages. Audio is generated on this device with ONNX Runtime WebGPU when available, or a WebAssembly CPU fallback.</p>
        <div className="voice-spec-grid">
          <div><span>Model size</span><strong>{formatBytes(model?.totalBytes || 399_000_000)}</strong></div>
          <div><span>Voice</span><strong>M1 · fixed preset</strong></div>
          <div><span>Backend</span><strong>{tts.backend || 'WebGPU · CPU fallback'}</strong></div>
          <div><span>Speech controls</span><strong>Normal · 0.85× replay</strong></div>
        </div>
        {tts.statusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.statusError}</div>}
        {tts.downloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.downloadError}</div>}
        {tts.downloading ? <div className="tts-download-state" aria-live="polite">
          <div className="tts-progress-copy"><span><Download size={15} /> Downloading {progress?.file || 'model files'}</span><strong>{downloadPercent}%</strong></div>
          <div className="tts-progress-track"><span style={{ width: `${downloadPercent}%` }} /></div>
          <small>{formatBytes(progress?.downloadedBytes || 0)} of {formatBytes(progress?.totalBytes || model?.totalBytes || 0)} · {progress?.completedFiles || 0} of {progress?.totalFiles || model?.files?.length || 7} files</small>
        </div> : ready ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Downloaded on this device · {formatBytes(model.totalBytes)}</span></div> : <div className="tts-download-cta">
          <button className="primary-button" type="button" onClick={() => void tts.downloadModel().catch(() => {})} disabled={tts.downloading}><Download size={15} /> Download model</button>
          <span>About 399 MB · Wi-Fi recommended · resumes from valid cached files</span>
        </div>}
        <div className="voice-local-note"><LockKeyhole size={15} /><span>Text and generated audio stay on this device. Kanafish does not record speech or score pronunciation.</span></div>
      </section>

      <section className="voice-lab-panel voice-test-panel" aria-labelledby="try-line-heading">
        <div className="voice-panel-heading"><span className="voice-panel-icon"><Volume2 size={18} /></span><div><span className="eyebrow">SYNTHESIS TEST</span><h2 id="try-line-heading">Try a Japanese line</h2></div></div>
        <label className="voice-text-label" htmlFor="voice-test-text">Text to speak</label>
        <textarea id="voice-test-text" className="voice-test-input" lang="ja" value={text} onChange={(event) => setText(event.target.value)} rows="4" placeholder="Enter Japanese text…" />
        <div className="voice-sample-list" aria-label="Sample lines">
          {SAMPLE_LINES.map((sample, index) => <button key={sample} type="button" className="voice-sample-chip" onClick={() => setText(sample)} aria-label={`Use sample ${index + 1}`}>{index + 1}</button>)}
          <span>Choose a sample or enter your own text.</span>
        </div>
        <button type="button" className="primary-button voice-play-button" onClick={() => void runSample()} disabled={!ready || tts.busy || tts.isPlaying || !text.trim()}>
          <Volume2 size={16} /> {tts.busy ? 'Generating…' : tts.isPlaying ? 'Playing…' : 'Generate and play'}
        </button>
        {!ready && <small className="voice-test-hint">Download the Supertonic 3 model first to enable local playback.</small>}
        {testError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {testError}</div>}
        {lastResult && <div className="tts-result-card" role="status">
          <div className="tts-result-heading"><Check size={15} /><strong>Audio generated</strong><span>{lastResult.backend}</span></div>
          <div className="tts-result-stats"><div><span>Audio</span><strong>{formatSeconds(lastResult.audioSeconds)}</strong></div><div><span>Generation</span><strong>{formatSeconds(lastResult.generationSeconds)}</strong></div><div><span>RTF</span><strong>{Number.isFinite(lastResult.realTimeFactor) ? lastResult.realTimeFactor.toFixed(2) : '—'}</strong></div></div>
          <small>RTF below 1.0 means generation finished faster than the audio plays. First-time model loading may take longer.</small>
        </div>}
      </section>
    </div>

    <SpeechRecognitionPanel />
  </div>
}
