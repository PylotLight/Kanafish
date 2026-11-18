import { useState } from 'react'
import SpeechRecognitionPanel from '../asr/SpeechRecognitionPanel.jsx'
import { AlertCircle, Check, Download, LockKeyhole, Sparkles, Volume2 } from 'lucide-react'
import { getSupertonicVoice, normalizeSupertonicVoiceSettings, SUPERTONIC_VOICES } from './supertonicVoices.js'

const SAMPLE_LINES = [
  'こんにちは。',
  'すみません、東京駅までの行き方を教えていただけますか？',
  '電車は午後三時十五分に出発します。チケットは二枚、合計二千四百円です。',
  'ちょっと待ってください。コーヒーを一杯ください。ゆっくり話してもらえると助かります。'
]

const ROTATION_MODES = [
  { id: 'lesson', label: 'Rotate each lesson' },
  { id: 'week', label: 'Change each week' },
  { id: 'fixed', label: 'Keep one voice' },
  { id: 'shuffle', label: 'Shuffle each listen' }
]

const MODE_DETAILS = {
  lesson: 'Cycle through all ten voices in course order. Replays keep the same voice for that lesson.',
  week: 'Use one voice throughout each week, then move to the next voice. Replays stay consistent.',
  fixed: 'Use the selected voice for course lessons and other Japanese playback.',
  shuffle: 'Choose a random voice for each listen. A whole dialogue keeps one voice from start to finish; the selected preset is used only for Voice Lab previews.'
}

function formatBytes(value = 0) {
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`
  return value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(2)} GB` : `${(value / 1_000_000).toFixed(0)} MB`
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} s` : '—'
}

export default function VoiceLabPage({ tts, voiceSettings, onVoiceSettingsChange = () => {} }) {
  const [text, setText] = useState(SAMPLE_LINES[0])
  const [lastResult, setLastResult] = useState(null)
  const [testError, setTestError] = useState('')
  const settings = normalizeSupertonicVoiceSettings(voiceSettings)
  const selectedVoice = getSupertonicVoice(settings.preset)
  const model = tts.modelStatus
  const progress = tts.downloadProgress
  const downloadPercent = progress?.totalBytes
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : 0
  const ready = Boolean(model?.installed)

  function updateVoiceSettings(patch) {
    onVoiceSettingsChange(normalizeSupertonicVoiceSettings({ ...settings, ...patch }))
  }

  async function runSample(sample = text) {
    setText(sample)
    setTestError('')
    setLastResult(null)
    try {
      setLastResult(await tts.playText(sample, { voice: settings.preset }))
    } catch (error) {
      setTestError(error?.message || 'Speech generation failed.')
    }
  }

  return <div className="content-page voice-lab-page page-enter">
    <div className="page-intro">
      <div className="eyebrow"><span className="eyebrow-line" /> LOCAL SPEECH</div>
      <h1>Voice Lab<span className="title-period">.</span></h1>
      <p>Supertonic 3 is the only speech engine enabled. Choose from its ten built-in voices and set how they rotate through the course; other experimental engines remain hidden pending live re-validation.</p>
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
          <div><span>Model size</span><strong>{formatBytes(model?.totalBytes || 401_276_744)}</strong></div>
          <div><span>Available voices</span><strong>10 presets · M1–M5 / F1–F5</strong></div>
          <div><span>Rotation</span><strong>{ROTATION_MODES.find(({ id }) => id === settings.mode)?.label}</strong></div>
          <div><span>Speech controls</span><strong>Normal · 0.85× replay</strong></div>
        </div>
        {tts.statusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.statusError}</div>}
        {tts.downloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.downloadError}</div>}
        {tts.downloading ? <div className="tts-download-state" aria-live="polite">
          <div className="tts-progress-copy"><span><Download size={15} /> Downloading {progress?.file || 'model files'}</span><strong>{downloadPercent}%</strong></div>
          <div className="tts-progress-track"><span style={{ width: `${downloadPercent}%` }} /></div>
          <small>{formatBytes(progress?.downloadedBytes || 0)} of {formatBytes(progress?.totalBytes || model?.totalBytes || 0)} · {progress?.completedFiles || 0} of {progress?.totalFiles || model?.files?.length || 16} files</small>
        </div> : ready ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Downloaded on this device · {formatBytes(model.totalBytes)}</span></div> : <div className="tts-download-cta">
          <button className="primary-button" type="button" onClick={() => void tts.downloadModel().catch(() => {})} disabled={tts.downloading}><Download size={15} /> Download model</button>
          <span>About 401 MB · Wi-Fi recommended · resumes from valid cached files</span>
        </div>}
        <div className="voice-local-note"><LockKeyhole size={15} /><span>Text and generated audio stay on this device. Any recording and transcript are processed locally and not saved to progress; Kanafish does not score pronunciation.</span></div>
      </section>

      <section className="voice-lab-panel voice-test-panel" aria-labelledby="try-line-heading">
        <div className="voice-panel-heading"><span className="voice-panel-icon"><Volume2 size={18} /></span><div><span className="eyebrow">SYNTHESIS TEST</span><h2 id="try-line-heading">Try a Japanese line</h2></div></div>
        <label className="voice-text-label" htmlFor="voice-test-text">Text to speak</label>
        <textarea id="voice-test-text" className="voice-test-input" lang="ja" value={text} onChange={(event) => setText(event.target.value)} rows="4" placeholder="Enter Japanese text…" />
        <div className="voice-sample-list" aria-label="Sample lines">
          {SAMPLE_LINES.map((sample, index) => <button key={sample} type="button" className="voice-sample-chip" onClick={() => setText(sample)} aria-label={`Use sample ${index + 1}`}>{index + 1}</button>)}
          <span>Choose a sample or enter your own text.</span>
        </div>
        <div className="voice-config-controls">
          <label className="voice-text-label" htmlFor="supertonic-rotation-mode">Course voice pattern</label>
          <select id="supertonic-rotation-mode" className="voice-voice-select" value={settings.mode} onChange={(event) => updateVoiceSettings({ mode: event.target.value })}>
            {ROTATION_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select>
          <label className="voice-text-label" htmlFor="supertonic-starting-voice">{settings.mode === 'fixed' ? 'Voice' : settings.mode === 'shuffle' ? 'Preview voice' : 'Starting voice'}</label>
          <select id="supertonic-starting-voice" className="voice-voice-select" value={settings.preset} onChange={(event) => updateVoiceSettings({ preset: event.target.value })}>
            {SUPERTONIC_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.id} · {voice.gender}</option>)}
          </select>
          <p className="voice-config-description"><strong>{selectedVoice.id}:</strong> {selectedVoice.description} {MODE_DETAILS[settings.mode]}</p>
          <p className="voice-config-note">The sample button below previews the selected preset directly. The full course uses your rotation choice; changes are saved on this device.</p>
        </div>
        <button type="button" className="primary-button voice-play-button" onClick={() => void runSample()} disabled={!ready || tts.busy || tts.isPlaying || !text.trim()}>
          <Volume2 size={16} /> {tts.busy ? 'Generating…' : tts.isPlaying ? 'Playing…' : `Preview ${settings.preset}`}
        </button>
        {!ready && <small className="voice-test-hint">Download the Supertonic 3 model first to enable local playback.</small>}
        {testError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {testError}</div>}
        {lastResult && <div className="tts-result-card" role="status">
          <div className="tts-result-heading"><Check size={15} /><strong>Audio generated · {lastResult.voiceId || settings.preset}</strong><span>{lastResult.backend}</span></div>
          <div className="tts-result-stats"><div><span>Audio</span><strong>{formatSeconds(lastResult.audioSeconds)}</strong></div><div><span>Generation</span><strong>{formatSeconds(lastResult.generationSeconds)}</strong></div><div><span>RTF</span><strong>{Number.isFinite(lastResult.realTimeFactor) ? lastResult.realTimeFactor.toFixed(2) : '—'}</strong></div></div>
          <small>RTF below 1.0 means generation finished faster than the audio plays. First-time model loading may take longer.</small>
        </div>}
      </section>
    </div>

    <SpeechRecognitionPanel />
  </div>
}
