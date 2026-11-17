import { useState } from 'react'
import { Activity, AlertCircle, Check, Cpu, Download, ExternalLink, HardDrive, LockKeyhole, Sparkles, Volume2 } from 'lucide-react'
import { TTS_MODEL_CATALOG } from './modelCatalog.js'

const SAMPLE_LINES = [
  'こんにちは。',
  'すみません、東京駅までの行き方を教えていただけますか？',
  '電車は午後三時十五分に出発します。チケットは二枚、合計二千四百円です。',
  'ちょっと待ってください。コーヒーを一杯ください。ゆっくり話してもらえると助かります。'
]

function formatBytes(value = 0) {
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`
  return `${(value / 1_000_000).toFixed(value >= 1_000_000_000 ? 2 : 0)} MB`
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} s` : '—'
}

function CandidateCard({ model }) {
  return <article className={`tts-candidate-card candidate-${model.status}`}>
    <div className="tts-candidate-top"><span className={`tts-status-tag status-${model.status}`}>{model.statusLabel}</span><span className="tts-candidate-parameters">{model.parameters}</span></div>
    <h3>{model.name}</h3>
    <p className="tts-candidate-languages">{model.languages} · {model.weightsLicense}</p>
    <p>{model.runtime}</p>
    <p className="tts-candidate-evidence">{model.evidence}</p>
    <div className="tts-candidate-links">
      <a href={model.sourceUrl} target="_blank" rel="noreferrer">Model card <ExternalLink size={13} /></a>
      <a href={model.codeUrl} target="_blank" rel="noreferrer">Runtime source <ExternalLink size={13} /></a>
    </div>
    <div className="tts-not-runnable"><LockKeyhole size={13} /> Not selectable or downloadable in this build</div>
  </article>
}

export default function VoiceLabPage({ tts }) {
  const [text, setText] = useState(SAMPLE_LINES[0])
  const [lastResult, setLastResult] = useState(null)
  const [testError, setTestError] = useState('')
  const supertonic = tts.modelStatus
  const magpie = tts.magpieStatus
  const progress = tts.downloadProgress
  const downloadPercent = progress?.totalBytes ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)) : 0
  const activeModel = TTS_MODEL_CATALOG.find((candidate) => candidate.id === tts.activeModelId) || TTS_MODEL_CATALOG[0]
  const isMagpie = activeModel.id === 'magpie-v2607'
  const isInstalled = isMagpie ? Boolean(magpie?.modelInstalled) : Boolean(supertonic?.installed)
  const canGenerate = isMagpie ? Boolean(magpie?.runtimeReady && magpie?.modelInstalled) : Boolean(supertonic?.installed)
  const unsupportedModels = TTS_MODEL_CATALOG.filter((candidate) => !candidate.availableInApp)

  async function runSample(sample = text) {
    setText(sample)
    setTestError('')
    setLastResult(null)
    try {
      const result = await tts.playText(sample, isMagpie ? { voice: tts.magpieVoice } : {})
      setLastResult(result)
    } catch (error) {
      setTestError(error?.message || 'Speech generation failed.')
    }
  }

  function startDownload() {
    void tts.downloadModel().catch(() => {})
  }

  function startMagpieDownload() {
    void tts.downloadMagpieModel().catch(() => {})
  }

  function selectModel(id) {
    tts.setActiveModelId(id)
    setLastResult(null)
    setTestError('')
  }

  return <div className="content-page voice-lab-page page-enter">
    <div className="page-intro">
      <div className="eyebrow"><span className="eyebrow-line" /> LOCAL SPEECH TESTING</div>
      <h1>Voice Lab<span className="title-period">.</span></h1>
      <p>Compare two Japanese speech models with the same travel-conversation lines. Models run locally; Magpie needs an optional Japanese-enabled native runtime.</p>
    </div>

    <div className="voice-model-choice" role="group" aria-label="Select a local speech model">
      {TTS_MODEL_CATALOG.filter((candidate) => candidate.availableInApp).map((candidate) => <button key={candidate.id} type="button" className={candidate.id === tts.activeModelId ? 'selected' : ''} aria-pressed={candidate.id === tts.activeModelId} onClick={() => selectModel(candidate.id)}>
        <span>{candidate.name}</span><small>{candidate.id === 'magpie-v2607' ? 'Native runtime · 5 voices' : 'Browser ONNX · CPU fallback'}</small>
      </button>)}
    </div>

    <div className="voice-lab-grid">
      <section className="voice-lab-panel voice-model-panel" aria-labelledby="active-voice-heading">
        <div className="voice-panel-heading"><span className="voice-panel-icon"><Sparkles size={18} /></span><div><span className="eyebrow">SELECTED LOCAL MODEL</span><h2 id="active-voice-heading">{activeModel.name}</h2></div><span className="tts-status-tag status-runnable">Runnable</span></div>
        {!isMagpie ? <>
          <p className="voice-model-summary">Japanese and 30 other languages. Compact ONNX model; its pinned weights stay outside the app checkout.</p>
          <div className="voice-spec-grid">
            <div><span>Model size</span><strong>{supertonic ? formatBytes(supertonic.totalBytes) : 'about 399 MB'}</strong></div>
            <div><span>License</span><strong>OpenRAIL-M weights · MIT helper code</strong></div>
            <div><span>Backend</span><strong>{tts.backend || 'WebGPU, with CPU fallback'}</strong></div>
            <div><span>Sandbox CPU test</span><strong>0.21–0.46× real time</strong></div>
          </div>
          {tts.statusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.statusError}</div>}
          {tts.downloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.downloadError}</div>}
          {tts.downloading ? <div className="tts-download-state" aria-live="polite">
            <div className="tts-progress-copy"><span><Download size={15} /> Downloading {progress?.file || 'model files'}</span><strong>{downloadPercent}%</strong></div>
            <div className="tts-progress-track"><span style={{ width: `${downloadPercent}%` }} /></div>
            <small>{formatBytes(progress?.downloadedBytes || 0)} of {formatBytes(progress?.totalBytes || supertonic?.totalBytes || 0)} · {progress?.completedFiles || 0} of {progress?.totalFiles || supertonic?.files?.length || 7} files</small>
          </div> : supertonic?.installed ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Downloaded on this device · {formatBytes(supertonic.totalBytes)}</span></div> : <div className="tts-download-cta">
            <button className="primary-button" onClick={startDownload} disabled={tts.downloading}><Download size={15} /> Download model</button>
            <span>About 399 MB · Wi-Fi recommended · resumes from valid cached files</span>
          </div>}
        </> : <>
          <p className="voice-model-summary">Japanese-capable multilingual model with five preset voices. Kanafish downloads the model, tokenizer and codec into a local cache; it does not bundle or redistribute the model weights.</p>
          <div className="voice-spec-grid">
            <div><span>Model stack</span><strong>About 637 MiB · 668 MB on disk</strong></div>
            <div><span>License</span><strong>NVIDIA Open Model License weights</strong></div>
            <div><span>Backend</span><strong>NeMo native CPU or Metal · not PyTorch MPS</strong></div>
            <div><span>Sandbox CPU test</span><strong>1.42–1.56× real time</strong></div>
          </div>
          {tts.magpieStatusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.magpieStatusError}</div>}
          {tts.magpieDownloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.magpieDownloadError}</div>}
          {magpie?.runtimeReady ? <div className="tts-ready-state" role="status"><Check size={15} /><span>NeMo-Speech.cpp {magpie.runtimeVersion} detected · Japanese HTTP TTS enabled</span></div> : <div className="tts-inline-error" role="status"><AlertCircle size={15} /><span>{magpie?.runtimeFound ? `NeMo-Speech.cpp ${magpie.runtimeVersion || 'was found'}, but this build needs the HTTP, TTS and tts_japanese features.` : 'Optional NeMo-Speech.cpp runtime not detected.'}</span></div>}
          {tts.magpieDownloading ? <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Download size={15} /> {tts.magpieProgress?.message || 'Downloading Magpie model stack…'}</span><strong>In progress</strong></div><small>The first download is about 637 MiB and includes the local tokenizer and codec.</small></div> : magpie?.modelInstalled ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Model stack cached on this device · {formatBytes(magpie.totalBytes)}</span></div> : <div className="tts-download-cta">
            <button className="primary-button" onClick={startMagpieDownload} disabled={!magpie?.canDownload || tts.magpieDownloading}><Download size={15} /> Download Magpie</button>
            <span>About 637 MiB · fetched only when requested</span>
          </div>}
          <details className="magpie-runtime-help"><summary>Native runtime setup and limits</summary>
            <p>NeMo-Speech.cpp is an optional separate native program, not bundled with Kanafish. Its stock prebuilt release may omit Japanese text support; use a v0.3.0+ build whose <code>nemo-speech doctor</code> reports <code>http</code>, <code>tts</code>, and <code>tts_japanese</code>. The build needs HTTP support and <code>NEMO_SPEECH_TTS_WITH_JA=ON</code>; Kanafish also checks that its Magpie model index resolves to the pinned revisions.</p>
            <p>On Mac, NeMo uses its native Metal backend, which is distinct from PyTorch MPS. Metal and MPS have not been tested here.</p>
            <a href="https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md" target="_blank" rel="noreferrer">NeMo-Speech.cpp build guide <ExternalLink size={13} /></a>
          </details>
        </>}
        {tts.engineProgress && <div className="tts-engine-progress"><Activity size={14} /> {isMagpie ? tts.magpieProgress?.message || 'Starting the native service…' : `Loading ${tts.engineProgress.name} (${tts.engineProgress.current}/${tts.engineProgress.total})`}</div>}
        <div className="voice-local-note"><LockKeyhole size={15} /><span>Text and generated audio stay on this device. Magpie binds a local-only service; Kanafish does not record your voice or upload prompts.</span></div>
      </section>

      <section className="voice-lab-panel voice-test-panel" aria-labelledby="try-line-heading">
        <div className="voice-panel-heading"><span className="voice-panel-icon"><Volume2 size={18} /></span><div><span className="eyebrow">SYNTHESIS TEST</span><h2 id="try-line-heading">Try a Japanese line</h2></div></div>
        {isMagpie && magpie?.voices?.length > 0 && <label className="voice-text-label" htmlFor="magpie-voice">Preset voice
          <select id="magpie-voice" className="voice-voice-select" value={tts.magpieVoice} onChange={(event) => tts.setMagpieVoice(event.target.value)} disabled={tts.busy}>
            {magpie.voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
          </select>
        </label>}
        <label className="voice-text-label" htmlFor="voice-test-text">Text to speak</label>
        <textarea id="voice-test-text" className="voice-test-input" lang="ja" value={text} onChange={(event) => setText(event.target.value)} rows="4" placeholder="Enter Japanese text…" />
        <div className="voice-sample-list" aria-label="Benchmark sample lines">
          {SAMPLE_LINES.map((sample, index) => <button key={sample} type="button" className="voice-sample-chip" onClick={() => setText(sample)} aria-label={`Use sample ${index + 1}`}>{index + 1}</button>)}
          <span>Same four lines used in the sandbox CPU comparison</span>
        </div>
        <button type="button" className="primary-button voice-play-button" onClick={() => void runSample()} disabled={!canGenerate || tts.busy || !text.trim()}>
          <Volume2 size={16} /> {tts.busy ? 'Generating…' : 'Generate and play'}
        </button>
        {!isInstalled && <small className="voice-test-hint">Download the selected model first to enable local playback.</small>}
        {isMagpie && magpie?.modelInstalled && !magpie?.runtimeReady && <small className="voice-test-hint">Synthesis is unavailable until the native runtime includes Japanese TTS and HTTP support.</small>}
        {testError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {testError}</div>}
        {lastResult && <div className="tts-result-card" role="status">
          <div className="tts-result-heading"><Check size={15} /><strong>Audio generated</strong><span>{lastResult.voice ? `${lastResult.voice} · ` : ''}{lastResult.backend}</span></div>
          <div className="tts-result-stats"><div><span>Audio</span><strong>{formatSeconds(lastResult.audioSeconds)}</strong></div><div><span>Generation</span><strong>{formatSeconds(lastResult.generationSeconds)}</strong></div><div><span>RTF</span><strong>{Number.isFinite(lastResult.realTimeFactor) ? lastResult.realTimeFactor.toFixed(2) : '—'}</strong></div></div>
          <small>RTF below 1.0 means generation finished faster than the audio plays. First-time service startup is reported separately.</small>
        </div>}
      </section>
    </div>

    <section className="tts-benchmark-note"><Cpu size={16} /><span><strong>What the sandbox CPU tests say:</strong> Supertonic ran at 0.21–0.46× real time; Magpie ran at 1.42–1.56× with a 2.12 s service load; Irodori ran at 3.11–6.02×. These are speed tests, not naturalness scores. No human listening test or Mac Metal/MPS test has been done.</span></section>

    <section className="tts-candidates-section" aria-labelledby="candidate-models-heading">
      <div className="tts-candidates-heading"><div><span className="eyebrow">NOT SUPPORTED HERE YET</span><h2 id="candidate-models-heading">Other models reviewed</h2></div><span className="tts-candidates-count">{unsupportedModels.length} reviewed</span></div>
      <p className="tts-candidates-intro">These options remain research-only in Kanafish. Irodori has a CPU/MPS Python route but is slow on the sandbox and would add a large separate runtime and checkpoint; Mio and Qwen have unresolved CPU/Metal runtime trade-offs; Chatterbox is retired. No placeholder is presented as downloadable or runnable.</p>
      <div className="tts-candidate-grid">{unsupportedModels.map((candidate) => <CandidateCard key={candidate.id} model={candidate} />)}</div>
      <div className="tts-candidate-footnote"><HardDrive size={14} /> Candidate weights are not downloaded. Magpie’s model license is separate from NeMo-Speech.cpp’s Apache-2.0 runtime license.</div>
    </section>
  </div>
}
