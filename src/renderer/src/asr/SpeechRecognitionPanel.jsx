import { useState } from 'react'
import { Activity, AlertCircle, Check, Cpu, Download, ExternalLink, Mic, Square, Trash2, X } from 'lucide-react'
import { VOICE_LAB_SAMPLE_LINES } from '../tts/sampleLines.js'
import { ASR_MAX_RECORD_SECONDS } from './audio.js'
import { scoreSpokenLine } from './similarity.js'
import { useAsr } from './useAsr.js'

function formatBytes(value = 0) {
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`
  return value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(2)} GB` : `${(value / 1_000_000).toFixed(0)} MB`
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} s` : '—'
}

const VERDICT_COPY = {
  match: 'Matches the line',
  close: 'Close — check the highlighted wording',
  retry: 'Quite different — try again more slowly',
  nothing: 'Nothing was recognized'
}

export default function SpeechRecognitionPanel() {
  const asr = useAsr()
  const [mode, setMode] = useState('free')
  const [lineIndex, setLineIndex] = useState(0)
  const status = asr.status
  const progress = asr.progress
  const percent = progress?.totalBytes ? Math.min(100, Math.round(((progress.downloadedBytes || 0) / progress.totalBytes) * 100)) : 0
  const ready = asr.readiness.ready
  const busy = asr.settingUp || asr.downloading
  const target = VOICE_LAB_SAMPLE_LINES[lineIndex]
  const score = mode === 'practice' && asr.result ? scoreSpokenLine(target, asr.result.text) : null

  function confirmRemoveModel() {
    if (!window.confirm('Remove the Haas-ja-v1.0 model from this device? You can download it again later.')) return
    void asr.removeModel().catch(() => {})
  }

  function confirmRemoveRuntime() {
    if (!window.confirm('Remove the speech.cpp runtime from Kanafish app data? The Haas model file is kept.')) return
    void asr.removeRuntime().catch(() => {})
  }

  function toggleRecording() {
    if (asr.recording) asr.stopRecording()
    else void asr.startRecording()
  }

  return <section className="voice-lab-panel asr-panel" aria-labelledby="asr-heading">
    <div className="voice-panel-heading">
      <span className="voice-panel-icon"><Mic size={18} /></span>
      <div><span className="eyebrow">ON-DEVICE SPEECH RECOGNITION</span><h2 id="asr-heading">Speech recognition</h2></div>
      <span className={`tts-status-tag ${ready ? 'status-runnable' : ''}`}>{ready ? 'Ready' : 'Setup required'}</span>
    </div>
    <p className="voice-model-summary">Haas-ja-v1.0 (Japanese, with punctuation) running in a local speech.cpp worker. Your voice is recorded, converted to 16 kHz mono and recognized on this device; nothing is uploaded.</p>

    <div className="asr-layout">
      <div className="asr-setup">
        <div className="voice-spec-grid">
          <div><span>Model</span><strong>Haas-ja-v1.0 · Q8_0 · {formatBytes(status?.totalBytes || 656_381_472)}</strong></div>
          <div><span>Runtime</span><strong>speech.cpp {status?.pinnedRuntimeVersion || '0.11.0'}{status?.runtimeBackend ? ` · ${status.runtimeBackend}` : ''}</strong></div>
          <div><span>Licenses</span><strong>Apache-2.0 weights · MIT runtime</strong></div>
          <div><span>Clip length</span><strong>Up to {ASR_MAX_RECORD_SECONDS} s per recording</strong></div>
        </div>
        {asr.statusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {asr.statusError}</div>}
        {asr.setupError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {asr.setupError}</div>}
        {asr.downloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {asr.downloadError}</div>}

        {status?.runtimeReady
          ? <div className="tts-ready-state" role="status"><Check size={15} /><span>speech.cpp {status.runtimeVersion} verified in app data</span></div>
          : asr.settingUp
            ? <div className="tts-download-state" aria-live="polite">
              <div className="tts-progress-copy"><span><Activity size={15} /> {progress?.message || 'Installing speech.cpp…'}</span><strong>{progress?.kind === 'runtime' && progress?.totalBytes ? `${percent}%` : '…'}</strong></div>
              <div className="tts-progress-track"><span style={{ width: `${progress?.kind === 'runtime' ? percent : 0}%` }} /></div>
              <div className="irodori-cache-controls"><button type="button" className="tts-cache-button" onClick={() => void asr.cancelSetup()}><X size={14} /> Cancel</button><small>The archive is SHA-256 checked, then the <code>speech</code> version is verified.</small></div>
            </div>
            : <div className="tts-download-cta native-runtime-setup">
              <button className="primary-button" type="button" onClick={() => void asr.setupRuntime().catch(() => {})} disabled={!status?.canSetupRuntime || busy || asr.transcribing}><Cpu size={15} /> Install speech.cpp runtime</button>
              <span>{status?.platformSupported === false ? (status.runtimeError || 'No pinned build for this platform.') : `${status?.runtimeAssetBytes ? formatBytes(status.runtimeAssetBytes) : '6–30 MB'} prebuilt · app-private · no PATH changes`}</span>
            </div>}

        {status?.modelInstalled
          ? <div className="tts-ready-state asr-gap" role="status"><Check size={15} /><span>Checksum-verified Haas-ja-v1.0 cached · {formatBytes(status.totalBytes)}</span></div>
          : asr.downloading
            ? <div className="tts-download-state asr-gap" aria-live="polite">
              <div className="tts-progress-copy"><span><Download size={15} /> {progress?.kind === 'model' ? progress.message : 'Downloading Haas-ja-v1.0…'}</span><strong>{progress?.kind === 'model' ? `${percent}%` : '…'}</strong></div>
              <div className="tts-progress-track"><span style={{ width: `${progress?.kind === 'model' ? percent : 0}%` }} /></div>
              <small>{formatBytes(progress?.kind === 'model' ? progress.downloadedBytes || 0 : 0)} of {formatBytes(status?.totalBytes || 656_381_472)}</small>
              <div className="irodori-cache-controls"><button type="button" className="tts-cache-button" onClick={() => void asr.cancelDownload()}><X size={14} /> Cancel download</button><small>The partial file is kept; downloading again resumes.</small></div>
            </div>
            : <div className="tts-download-cta asr-gap">
              <button className="primary-button" type="button" onClick={() => void asr.downloadModel().catch(() => {})} disabled={!status?.canDownload || busy}><Download size={15} /> {status?.downloadedBytes > 0 ? 'Resume Haas download' : 'Download Haas-ja-v1.0'}</button>
              <span>About 656 MB · fetched only when requested{status?.downloadedBytes > 0 ? ` · ${formatBytes(status.downloadedBytes)} already here` : ''}</span>
            </div>}

        {(status?.modelInstalled || status?.downloadedBytes > 0 || status?.runtimeReady) && <div className="irodori-cache-controls">
          {(status?.modelInstalled || status?.downloadedBytes > 0) && <button type="button" className="tts-cache-button" onClick={confirmRemoveModel} disabled={busy || asr.transcribing || asr.recording}><Trash2 size={14} /> Clear Haas model cache</button>}
          {status?.runtimeReady && <button type="button" className="tts-cache-button" onClick={confirmRemoveRuntime} disabled={busy || asr.transcribing || asr.recording}><Trash2 size={14} /> Remove speech.cpp runtime</button>}
        </div>}

        <details className="magpie-runtime-help"><summary>Runtime, model pins and privacy</summary>
          <p>Kanafish downloads the pinned speech.cpp {status?.pinnedRuntimeVersion || '0.11.0'} release archive for this platform from GitHub, checks its SHA-256 against the release's <code>SHA256SUMS</code>, and extracts only the <code>speech</code> executable into Kanafish app data. It does not run the upstream installer or change your PATH.</p>
          <p>The model is pinned to <code>{status?.modelRepo || 'sakasegawa/Haas-ja-v1.0-GGUF'}</code> revision <code>{(status?.modelRevision || '6b965d5007ba780585de51549d57a8c1c0d67c7e').slice(0, 12)}</code> and checked by size and SHA-256. A local <code>speech worker</code> loads it on your first recording and stops after five idle minutes or when Kanafish quits.</p>
          <a href="https://github.com/nyosegawa/speech.cpp" target="_blank" rel="noreferrer">speech.cpp source <ExternalLink size={13} /></a>
          <a href="https://huggingface.co/third-intelligence/Haas-ja-v1.0" target="_blank" rel="noreferrer">Haas-ja-v1.0 model card <ExternalLink size={13} /></a>
        </details>
      </div>

      <div className="asr-try">
        <div className="voice-model-choice asr-mode" role="group" aria-label="Recognition mode">
          <button type="button" className={mode === 'free' ? 'selected' : ''} aria-pressed={mode === 'free'} onClick={() => { setMode('free'); asr.clearResult() }}><span>Free speech</span><small>Say anything in Japanese</small></button>
          <button type="button" className={mode === 'practice' ? 'selected' : ''} aria-pressed={mode === 'practice'} onClick={() => { setMode('practice'); asr.clearResult() }}><span>Speak this line</span><small>Compare with a sample line</small></button>
        </div>

        {mode === 'practice' && <div className="asr-target">
          <div className="voice-sample-list" aria-label="Practice lines">
            {VOICE_LAB_SAMPLE_LINES.map((line, index) => <button key={line} type="button" className={`voice-sample-chip ${index === lineIndex ? 'selected' : ''}`} aria-pressed={index === lineIndex} onClick={() => { setLineIndex(index); asr.clearResult() }} aria-label={`Practice line ${index + 1}`}>{index + 1}</button>)}
            <span>Same lines as the synthesis test</span>
          </div>
          <p className="asr-target-line" lang="ja">{target}</p>
        </div>}

        <div className="asr-record-row">
          <button type="button" className={`primary-button asr-record-button ${asr.recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={!ready || asr.starting || asr.transcribing || busy} aria-pressed={asr.recording}>
            {asr.recording ? <><Square size={14} /> Stop · {asr.recordSeconds.toFixed(1)} s</> : <><Mic size={15} /> {asr.starting ? 'Starting…' : asr.transcribing ? 'Recognizing…' : 'Start recording'}</>}
          </button>
          {asr.recording && <button type="button" className="tts-cache-button" onClick={asr.cancelRecording}><X size={14} /> Discard</button>}
          {asr.transcribing && <button type="button" className="tts-cache-button" onClick={() => void asr.cancelTranscription()} disabled={asr.cancelling}><X size={14} /> {asr.cancelling ? 'Cancelling…' : 'Cancel recognition'}</button>}
          {!ready && <small className="voice-test-hint">{asr.readiness.message}</small>}
        </div>
        {asr.transcribing && progress?.kind === 'worker' && <div className="tts-engine-progress"><Activity size={14} /> {progress.message}</div>}
        {asr.error && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {asr.error}</div>}

        {asr.result && <div className="tts-result-card asr-result" role="status">
          <div className="tts-result-heading"><Check size={15} /><strong>Recognized</strong><span>{asr.result.backend}</span></div>
          <p className="asr-transcript" lang="ja">{asr.result.text || '（何も認識されませんでした）'}</p>
          {score && <div className={`asr-score asr-score-${score.verdict}`}><strong>{score.score}%</strong><span>{VERDICT_COPY[score.verdict]}</span></div>}
          <div className="tts-result-stats">
            <div><span>Audio</span><strong>{formatSeconds(asr.result.audioSeconds)}</strong></div>
            <div><span>Recognition</span><strong>{formatSeconds(asr.result.recognitionSeconds)}</strong></div>
            <div><span>{asr.result.loadSeconds > 0 ? 'Model load' : 'Speed'}</span><strong>{asr.result.loadSeconds > 0 ? formatSeconds(asr.result.loadSeconds) : Number.isFinite(asr.result.rtfx) ? `${asr.result.rtfx.toFixed(0)}× real time` : '—'}</strong></div>
          </div>
          {score && <small>The score compares characters after folding katakana to hiragana and dropping punctuation. It is not a pronunciation grade, and a kanji vs kana spelling of the same word counts as different.</small>}
        </div>}
      </div>
    </div>
  </section>
}
