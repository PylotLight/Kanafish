import { useState } from 'react'
import { Activity, AlertCircle, Check, Cpu, Download, ExternalLink, HardDrive, LockKeyhole, Sparkles, Trash2, Volume2, X } from 'lucide-react'
import { TTS_MODEL_CATALOG } from './modelCatalog.js'

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
  const qwen = tts.qwenStatus
  const irodori = tts.irodoriStatus
  const irodoriMf = tts.irodoriMfOnnxStatus
  const mio = tts.mioStatus
  const progress = tts.downloadProgress
  const magpieProgress = tts.magpieProgress
  const downloadPercent = progress?.totalBytes ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)) : 0
  const qwenProgress = tts.qwenProgress
  const qwenDownloadPercent = qwenProgress?.totalBytes ? Math.min(100, Math.round((qwenProgress.downloadedBytes / qwenProgress.totalBytes) * 100)) : 0
  const irodoriProgress = tts.irodoriProgress
  const irodoriDownloadPercent = irodoriProgress?.totalBytes ? Math.min(100, Math.round((irodoriProgress.downloadedBytes / irodoriProgress.totalBytes) * 100)) : 0
  const irodoriMfProgress = tts.irodoriMfOnnxProgress
  const irodoriMfDownloadPercent = irodoriMfProgress?.totalBytes ? Math.min(100, Math.round((irodoriMfProgress.downloadedBytes / irodoriMfProgress.totalBytes) * 100)) : 0
  const mioProgress = tts.mioProgress
  const mioDownloadPercent = mioProgress?.totalBytes ? Math.min(100, Math.round((mioProgress.downloadedBytes / mioProgress.totalBytes) * 100)) : 0
  const activeModel = TTS_MODEL_CATALOG.find((candidate) => candidate.id === tts.activeModelId) || TTS_MODEL_CATALOG[0]
  const isMagpie = activeModel.id === 'magpie-v2607'
  const isQwen = activeModel.id === 'qwen3-tts-0.6b-customvoice'
  const isIrodoriMf = activeModel.id === 'irodori-v4.1-small-mf'
  const isIrodori = activeModel.id === 'irodori-v4.1-small'
  const isSupertonic = activeModel.id === 'supertonic-3'
  const isMio = activeModel.id === 'miotts-0.6b'
  const isInstalled = isMagpie ? Boolean(magpie?.modelInstalled) : isQwen ? Boolean(qwen?.modelInstalled) : isIrodoriMf ? Boolean(irodoriMf?.installed) : isIrodori ? Boolean(irodori?.modelInstalled) : isMio ? Boolean(mio?.modelInstalled) : Boolean(supertonic?.installed)
  const canGenerate = isMagpie ? Boolean(magpie?.runtimeReady && magpie?.modelInstalled) : isQwen ? Boolean(qwen?.runtimeReady && qwen?.modelInstalled) : isIrodoriMf ? Boolean(irodoriMf?.runtimeReady && irodoriMf?.installed) : isIrodori ? Boolean(irodori?.runtimeReady && irodori?.modelInstalled) : isMio ? Boolean(mio?.runtimeReady && mio?.modelInstalled) : Boolean(supertonic?.installed)
  const unsupportedModels = TTS_MODEL_CATALOG.filter((candidate) => !candidate.availableInApp)

  async function runSample(sample = text) {
    setText(sample)
    setTestError('')
    setLastResult(null)
    try {
      const options = isMagpie ? { voice: tts.magpieVoice } : isQwen ? { voice: tts.qwenVoice } : isMio ? { voice: tts.mioVoice } : {}
      const result = await tts.playText(sample, options)
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

  function startMagpieRuntimeSetup() {
    const consent = window.confirm('Build the pinned NeMo-Speech.cpp source and dependencies in Kanafish app data? This can take a long time and requires at least 8 GiB free. It will not install system packages or download Magpie model weights.')
    if (consent) void tts.setupMagpieRuntime().catch(() => {})
  }

  function startQwenDownload() {
    void tts.downloadQwenModel().catch(() => {})
  }

  function startQwenRuntimeSetup() {
    const consent = window.confirm('Build the pinned codec.cpp source and dependencies in Kanafish app data? This can take a long time and requires at least 8 GiB free. It will not install system packages or download Qwen model weights.')
    if (consent) void tts.setupQwenRuntime().catch(() => {})
  }

  function startIrodoriDownload() {
    void tts.downloadIrodoriModel().catch(() => {})
  }

  function startIrodoriMfDownload() {
    void tts.downloadIrodoriMfOnnxModel().catch(() => {})
  }

  function startMioRuntimeSetup() {
    void tts.setupMioRuntime().catch(() => {})
  }

  function startMioDownload() {
    void tts.downloadMioModel().catch(() => {})
  }

  function clearMioModelCache() {
    if (!window.confirm('Remove MioTTS-0.6B, its tokenizer and Japanese voice presets from this device? You can download them again later.')) return
    void tts.removeMioModelCache().catch((error) => setTestError(error?.message || 'Could not clear the MioTTS model cache.'))
  }

  function removeMioRuntime() {
    if (!window.confirm('Remove CrispASR from Kanafish app data? This keeps MioTTS model files and does not affect other TTS engines.')) return
    void tts.removeMioRuntime().catch((error) => setTestError(error?.message || 'Could not remove the CrispASR runtime.'))
  }

  function clearIrodoriMfOnnxCache() {
    if (!window.confirm('Remove the downloaded Irodori MF ONNX model files from this device? You can download them again later.')) return
    void tts.removeIrodoriMfOnnxModel().catch((error) => setTestError(error?.message || 'Could not clear the Irodori MF ONNX cache.'))
  }

  function startIrodoriSetup() {
    void tts.setupIrodoriPython().catch(() => {})
  }

  function clearIrodoriModelCache() {
    if (!window.confirm('Remove Irodori’s downloaded model, tokenizer and codec from this device? You can download them again later.')) return
    void tts.clearIrodoriModelCache().catch((error) => setTestError(error?.message || 'Could not clear the Irodori model cache.'))
  }

  function removeIrodoriPythonRuntime() {
    if (!window.confirm('Remove Irodori’s app-managed Python environment? This does not affect other Kanafish engines.')) return
    void tts.removeIrodoriPythonRuntime().catch((error) => setTestError(error?.message || 'Could not remove the Irodori Python environment.'))
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
          <p>Compare Japanese speech models with the same travel-conversation lines. MioTTS, Magpie and Qwen use app-managed native C++ runtimes without Python; plain Irodori v4.1 uses an optional Python sidecar, while its separately distilled MF variant uses ONNX. Model weights are fetched only when requested.</p>
    </div>

    <div className="voice-model-choice" role="group" aria-label="Select a local speech model">
      {TTS_MODEL_CATALOG.filter((candidate) => candidate.availableInApp).map((candidate) => <button key={candidate.id} type="button" className={candidate.id === tts.activeModelId ? 'selected' : ''} aria-pressed={candidate.id === tts.activeModelId} onClick={() => selectModel(candidate.id)}>
        <span>{candidate.name}</span><small>{candidate.id === 'magpie-v2607' ? 'Native runtime · 5 voices' : candidate.id === 'qwen3-tts-0.6b-customvoice' ? 'Native codec.cpp · ono_anna' : candidate.id === 'miotts-0.6b' ? 'Native CrispASR · Japanese presets · no Python' : candidate.id === 'irodori-v4.1-small-mf' ? 'MeanFlow-distilled · ONNX · no Python' : candidate.id === 'irodori-v4.1-small' ? 'Optional Python sidecar · MPS/CPU' : 'Browser ONNX · CPU fallback'}</small>
      </button>)}
    </div>

    <div className="voice-lab-grid">
      <section className="voice-lab-panel voice-model-panel" aria-labelledby="active-voice-heading">
        <div className="voice-panel-heading"><span className="voice-panel-icon"><Sparkles size={18} /></span><div><span className="eyebrow">SELECTED LOCAL MODEL</span><h2 id="active-voice-heading">{activeModel.name}</h2></div><span className="tts-status-tag status-runnable">{(isIrodori || isMio) && !canGenerate ? 'Setup required' : 'Runnable'}</span></div>
        {isSupertonic ? <>
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
        </> : isMio ? <>
          <p className="voice-model-summary">MioTTS-0.6B using the exact 0.6B Q4_K model and MioCodec-v2, with Japanese preset voices. CrispASR documents Japanese and English support; only Japanese synthesis has been tested here. The pinned native C++ CPU runtime and model are downloaded into app data only when requested.</p>
          <div className="voice-spec-grid">
            <div><span>Model + tokenizer + voices</span><strong>{formatBytes(mio?.totalBytes || 540_000_888)} · Q4_K</strong></div>
            <div><span>Model licenses</span><strong>Apache-2.0 model · MIT codec</strong></div>
            <div><span>Backend</span><strong>CrispASR native C++ · CPU · no Python</strong></div>
            <div><span>Output</span><strong>Japanese · mono 44.1 kHz PCM16 WAV</strong></div>
          </div>
          <div className="mio-license-note"><AlertCircle size={15} /><span><strong>Preset restriction:</strong> the bundled upstream Japanese voice presets are non-commercial. The upstream says audio generated with these default presets cannot be used commercially; this preset-specific restriction is separate from the model and codec licenses.</span></div>
          {tts.mioStatusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.mioStatusError}</div>}
          {tts.mioSetupError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.mioSetupError}</div>}
          {tts.mioDownloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.mioDownloadError}</div>}
          {mio?.runtimeReady ? <div className="tts-ready-state" role="status"><Check size={15} /><span>CrispASR {mio.runtimeVersion} verified · MioTTS backend available</span></div> : mio?.platformSupported ? <div className="tts-inline-error" role="status"><AlertCircle size={15} /><span>{mio?.runtimeFound ? (mio.runtimeError || 'The app-managed CrispASR runtime is not compatible.') : 'The pinned CrispASR runtime is not installed yet.'}</span></div> : <div className="tts-inline-error" role="status"><AlertCircle size={15} /><span>{mio?.runtimeError || 'A pinned CrispASR runtime is not available for this platform.'}</span></div>}
          <div className="tts-download-cta native-runtime-setup">
            <button className="primary-button" type="button" onClick={startMioRuntimeSetup} disabled={!mio?.canSetupRuntime || tts.mioSettingUp || tts.mioDownloading || tts.busy || mio?.runtimeReady}><Cpu size={15} /> {tts.mioSettingUp ? 'Installing runtime…' : mio?.runtimeReady ? 'CrispASR runtime ready' : 'Install no-Python runtime'}</button>
            <span>{mio?.runtimeReady ? `Pinned v${mio.runtimeVersion} · app-private cache` : `Pinned ${mio?.runtimeAssetBytes ? formatBytes(mio.runtimeAssetBytes) : '18–44 MB'} prebuilt runtime · no source build or 8 GiB build requirement`}</span>
          </div>
          {tts.mioSettingUp && <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Activity size={15} /> {mioProgress?.message || 'Installing CrispASR…'}</span><strong>{mioDownloadPercent}%</strong></div><div className="tts-progress-track"><span style={{ width: `${mioDownloadPercent}%` }} /></div><small>The archive is SHA-256 checked before extraction, then the runtime version and MioTTS backend are verified.</small></div>}
          {tts.mioDownloading ? <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Download size={15} /> {mioProgress?.message || `Downloading ${mioProgress?.file || 'MioTTS model files'}…`}</span><strong>{mioDownloadPercent}%</strong></div><div className="tts-progress-track"><span style={{ width: `${mioDownloadPercent}%` }} /></div><small>{formatBytes(mioProgress?.downloadedBytes || 0)} of {formatBytes(mioProgress?.totalBytes || mio?.totalBytes || 540_000_888)} · {mioProgress?.completedFiles || 0} of {mioProgress?.totalFiles || mio?.files?.length || 4} files</small></div> : mio?.modelInstalled ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Checksum-verified MioTTS model and Japanese presets cached · {formatBytes(mio.totalBytes)}</span></div> : <div className="tts-download-cta">
            <button className="primary-button" onClick={startMioDownload} disabled={!mio?.canDownload || tts.mioDownloading}><Download size={15} /> Download MioTTS-0.6B</button>
            <span>About 540 MB · requires the runtime first · downloaded only when requested</span>
          </div>}
          {mio?.downloadedBytes > 0 && <div className="irodori-cache-controls"><button type="button" className="tts-cache-button" onClick={clearMioModelCache} disabled={tts.mioDownloading || tts.busy}><Trash2 size={14} /> Clear MioTTS model cache</button></div>}
          {mio?.runtimeReady && <div className="irodori-cache-controls"><button type="button" className="tts-cache-button" onClick={removeMioRuntime} disabled={tts.mioSettingUp || tts.mioDownloading || tts.busy}><Trash2 size={14} /> Remove CrispASR runtime</button></div>}
          <details className="magpie-runtime-help mio-runtime-help"><summary>Runtime, model pins and preset terms</summary>
            <p>Kanafish installs CrispASR v0.8.54 from a pinned Linux x86_64, macOS Apple Silicon or macOS Intel release archive after verifying its SHA-256 digest. It then checks the exact runtime version and the presence of a TTS-capable <code>miotts</code> backend. Runtime files are kept in Kanafish app data; no Python, compiler or source build is needed.</p>
            <p>The model is pinned to Hugging Face revision <code>fab3cdbef802fb5f1047708c27378c6e34ec230f</code>. Model, tokenizer and both Japanese presets have pinned sizes and SHA-256 checks. The model weights are Apache-2.0; MioCodec-v2 weights are MIT. The upstream <a href="https://github.com/Aratako/MioTTS-Inference" target="_blank" rel="noreferrer">preset notes</a> say default Japanese presets were generated using T5Gemma-TTS and Gemini and that outputs made with them cannot be used commercially. This build uses synthetic speaker identity and does not watermark audio.</p>
            <a href="https://github.com/CrispStrobe/CrispASR/blob/main/docs/tts.md" target="_blank" rel="noreferrer">CrispASR MioTTS backend documentation <ExternalLink size={13} /></a>
            <a href="https://huggingface.co/cstr/miotts-0.6b-GGUF/tree/fab3cdbef802fb5f1047708c27378c6e34ec230f" target="_blank" rel="noreferrer">Pinned MioTTS-0.6B model files <ExternalLink size={13} /></a>
          </details>
        </> : isMagpie ? <>
          <p className="voice-model-summary">Japanese-capable multilingual model with five preset voices. Kanafish downloads the model, tokenizer and codec into a local cache; it does not bundle or redistribute the model weights.</p>
          <div className="voice-spec-grid">
            <div><span>Model stack</span><strong>About 637 MiB · 668 MB on disk</strong></div>
            <div><span>License</span><strong>NVIDIA Open Model License weights</strong></div>
            <div><span>Backend</span><strong>NeMo native CPU or Metal · not PyTorch MPS</strong></div>
            <div><span>Sandbox CPU test</span><strong>1.42–1.56× real time</strong></div>
          </div>
          {tts.magpieStatusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.magpieStatusError}</div>}
          {tts.magpieSetupError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.magpieSetupError}</div>}
          {tts.magpieDownloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.magpieDownloadError}</div>}
          {magpie?.runtimeReady ? <div className="tts-ready-state" role="status"><Check size={15} /><span>NeMo-Speech.cpp {magpie.runtimeVersion} detected · Japanese HTTP TTS enabled</span></div> : <div className="tts-inline-error" role="status"><AlertCircle size={15} /><span>{magpie?.runtimeFound ? `NeMo-Speech.cpp ${magpie.runtimeVersion || 'was found'}, but this build needs the HTTP, TTS and tts_japanese features.` : 'Optional NeMo-Speech.cpp runtime not detected.'}</span></div>}
          {!magpie?.runtimeReady && <>
            <div className="tts-download-cta native-runtime-setup">
              {tts.magpieSettingUp ? <button className="tts-cache-button" type="button" onClick={() => void tts.cancelMagpieRuntimeSetup()}><X size={14} /> Cancel build</button> : <button className="primary-button" type="button" onClick={startMagpieRuntimeSetup} disabled={tts.busy || tts.magpieDownloading || !magpie?.nativeSetup?.canBuild}><Cpu size={15} /> {magpie?.nativeSetup?.canBuild ? 'Build NeMo runtime' : 'Automatic setup unavailable'}</button>}
              <span>{tts.magpieSettingUp ? magpieProgress?.message || 'Building pinned NeMo-Speech.cpp…' : 'Pinned v0.3.0 source · app-private install · Magpie weights remain a separate download'}</span>
            </div>
            {tts.magpieSettingUp && <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Activity size={15} /> {magpieProgress?.message || 'Building the Japanese TTS runtime…'}</span><strong>In progress</strong></div><small>Build output is streamed here. Cancel removes temporary build files and allows retry.</small></div>}
            {!magpie?.nativeSetup?.canBuild && magpie?.nativeSetup?.blockers?.length > 0 && <ul className="runtime-blockers" aria-label="Automatic NeMo setup requirements">{magpie.nativeSetup.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
          </>}
          {tts.magpieDownloading ? <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Download size={15} /> {tts.magpieProgress?.message || 'Downloading Magpie model stack…'}</span><strong>In progress</strong></div><small>The first download is about 637 MiB and includes the local tokenizer and codec.</small></div> : magpie?.modelInstalled ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Model stack cached on this device · {formatBytes(magpie.totalBytes)}</span></div> : <div className="tts-download-cta">
            <button className="primary-button" onClick={startMagpieDownload} disabled={!magpie?.canDownload || tts.magpieDownloading}><Download size={15} /> Download Magpie</button>
            <span>About 637 MiB · fetched only when requested</span>
          </div>}
          <details className="magpie-runtime-help"><summary>Native runtime setup and limits</summary>
            <p>If prerequisites and disk space permit, Kanafish can download pinned NeMo-Speech.cpp v0.3.0 source and submodules, compile Japanese TTS plus HTTP support, health-check the result, then install it only under Kanafish app data. The build does not include Magpie model weights; those remain a separate explicit download. It requires Git, CMake 3.26+, Ninja, Bash, a C compiler, a C++17 compiler and at least 8 GiB free. Windows uses the manual path.</p>
            <p>On Apple Silicon, the setup selects NeMo’s native Metal preset. This is distinct from PyTorch MPS, and Metal has not been tested on the owner’s Mac. Kanafish verifies version, HTTP, TTS, Japanese TTS and model-pull support before enabling the Magpie download.</p>
            <a href="https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md" target="_blank" rel="noreferrer">NeMo-Speech.cpp build guide <ExternalLink size={13} /></a>
          </details>
        </> : isIrodoriMf ? <>
          <p className="voice-model-summary">Japanese-only Irodori v4.1-Small-MF, a separate MeanFlow-distilled model variant. This pinned int8 ONNX route runs in JavaScript with ONNX Runtime WebAssembly CPU and does not use Python or reference audio.</p>
          <div className="voice-spec-grid">
            <div><span>Model pack</span><strong>{irodoriMf ? formatBytes(irodoriMf.totalBytes) : '1.69 GB · int8 + FP32'}</strong></div>
            <div><span>License</span><strong>MIT component licenses · pack card says “other”</strong></div>
            <div><span>Backend</span><strong>ONNX Runtime WebAssembly · CPU</strong></div>
            <div><span>Sampler</span><strong>MeanFlow · 4 steps</strong></div>
          </div>
          {tts.irodoriMfOnnxStatusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.irodoriMfOnnxStatusError}</div>}
          {tts.irodoriMfOnnxDownloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.irodoriMfOnnxDownloadError}</div>}
          {tts.irodoriMfOnnxDownloading ? <div className="tts-download-state" aria-live="polite">
            <div className="tts-progress-copy"><span><Download size={15} /> {irodoriMfProgress?.file || irodoriMfProgress?.message || 'Downloading MF ONNX graphs…'}</span><strong>{irodoriMfDownloadPercent}%</strong></div>
            <div className="tts-progress-track"><span style={{ width: `${irodoriMfDownloadPercent}%` }} /></div>
            <small>{formatBytes(irodoriMfProgress?.downloadedBytes || 0)} of {formatBytes(irodoriMfProgress?.totalBytes || irodoriMf?.totalBytes || 1_693_722_741)} · {irodoriMfProgress?.completedFiles || 0} of {irodoriMfProgress?.totalFiles || irodoriMf?.files?.length || 9} files</small>
          </div> : irodoriMf?.installed ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Checksum-verified MF graphs and tokenizer cached · {formatBytes(irodoriMf.totalBytes)}</span></div> : <div className="tts-download-cta">
            <button className="primary-button" onClick={startIrodoriMfDownload} disabled={tts.irodoriMfOnnxDownloading}><Download size={15} /> Download MF ONNX pack</button>
            <span>About 1.69 GB · requires about 1.70 GiB free · fetched only when requested</span>
          </div>}
          {irodoriMf?.downloadedBytes > 0 && <div className="irodori-cache-controls"><button type="button" className="tts-cache-button" onClick={clearIrodoriMfOnnxCache} disabled={tts.irodoriMfOnnxDownloading || tts.busy}><Trash2 size={14} /> Clear MF ONNX model cache</button></div>}
          <details className="magpie-runtime-help irodori-runtime-help"><summary>Variant, runtime and responsible use</summary>
            <p>This is not the plain v4.1-Small checkpoint above. It is a four-step MeanFlow-distilled v4.1-Small variant. Only the text encoder and MeanFlow step graph are int8; the duration, context, speaker and audio decoder graphs are float32. The app does not download the encrypted UltraAlarm-only light decoder.</p>
            <p>Requests are limited to 500 characters and run one at a time to avoid overloading this CPU backend. The first sandbox run was slow; shorter text is recommended.</p>
            <p>The model card states MIT component licenses while its pack metadata labels the overall license “other”; review each component’s license separately. Synthetic speech is not watermarked. Do not impersonate a person or create misleading audio.</p>
            <a href="https://huggingface.co/Ryoppi/Irodori-TTS-v4.1-Small-MF-ONNX-int8" target="_blank" rel="noreferrer">Pinned MF ONNX model card <ExternalLink size={13} /></a>
            <a href="https://github.com/kgmkm/muse-irodori-voice" target="_blank" rel="noreferrer">Python reference runner and attribution <ExternalLink size={13} /></a>
          </details>
        </> : isIrodori ? <>
          <p className="voice-model-summary">Japanese-only v4.1-Small using its MIT checkpoint and MIT DACVAE codec. This optional app-managed Python sidecar uses PyTorch MPS when available on macOS and falls back to CPU. It uses no reference recording.</p>
          <div className="voice-spec-grid">
            <div><span>Model + codec</span><strong>About 3.50 GB · FP32</strong></div>
            <div><span>License</span><strong>MIT weights, runtime and codec</strong></div>
            <div><span>Backend</span><strong>PyTorch MPS when available · CPU fallback</strong></div>
            <div><span>Integrated CPU test</span><strong>5.47× real time · 11.55 s load</strong></div>
          </div>
          {tts.irodoriStatusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.irodoriStatusError}</div>}
          {tts.irodoriSetupError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.irodoriSetupError}</div>}
          {tts.irodoriDownloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.irodoriDownloadError}</div>}
          {irodori?.runtimeReady ? <div className="tts-ready-state" role="status"><Check size={15} /><span>App-managed Python environment ready · Python {irodori.pythonVersion} · {irodori.mpsAvailable ? 'PyTorch MPS detected' : 'CPU backend available'}</span></div> : <div className="tts-inline-error" role="status"><AlertCircle size={15} /><span>{irodori?.runtimeError || 'Set up the optional Python environment before using Irodori.'}</span></div>}
          <div className="tts-download-cta irodori-action-row">
            <button className="primary-button" onClick={startIrodoriSetup} disabled={tts.irodoriSettingUp || tts.busy || irodori?.runtimeReady}><Cpu size={15} /> {tts.irodoriSettingUp ? 'Setting up…' : irodori?.runtimeReady ? 'Python runtime ready' : 'Set up Python runtime'}</button>
            <span>Needs Python 3.10–3.13 to bootstrap; installs an isolated environment for Irodori only, using additional disk space beyond the model cache.</span>
          </div>
          {tts.irodoriSettingUp && <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Activity size={15} /> {irodoriProgress?.message || 'Installing the optional Irodori runtime…'}</span><strong>In progress</strong></div><small>PyTorch and pinned inference dependencies are installed only after you choose setup.</small></div>}
          {tts.irodoriDownloading ? <div className="tts-download-state" aria-live="polite">
            <div className="tts-progress-copy"><span><Download size={15} /> {irodoriProgress?.message || `Downloading ${irodoriProgress?.file || 'Irodori model files'}…`}</span><strong>{irodoriDownloadPercent}%</strong></div>
            <div className="tts-progress-track"><span style={{ width: `${irodoriDownloadPercent}%` }} /></div>
            <small>{formatBytes(irodoriProgress?.downloadedBytes || 0)} of {formatBytes(irodoriProgress?.totalBytes || irodori?.approximateBytes || 3_500_634_824)} · {irodoriProgress?.completedFiles || 0} of {irodoriProgress?.totalFiles || 4} files</small>
          </div> : irodori?.modelInstalled ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Checksum-verified model, tokenizer and codec cached · {formatBytes(irodori.approximateBytes)}</span></div> : <div className="tts-download-cta irodori-action-row">
            <button className="primary-button" onClick={startIrodoriDownload} disabled={tts.irodoriDownloading}><Download size={15} /> Download Irodori</button>
            <span>About 3.50 GB · requires about 3.63 GB free; downloaded only when requested.</span>
          </div>}
          {(irodori?.downloadedBytes > 0 || irodori?.pythonEnvironmentExists) && <div className="irodori-cache-controls">
            {irodori?.downloadedBytes > 0 && <button type="button" className="tts-cache-button" onClick={clearIrodoriModelCache} disabled={tts.irodoriDownloading || tts.busy}><Trash2 size={14} /> Clear Irodori model cache</button>}
            {irodori?.pythonEnvironmentExists && <button type="button" className="tts-cache-button" onClick={removeIrodoriPythonRuntime} disabled={tts.irodoriSettingUp || tts.busy}><Trash2 size={14} /> Remove Python environment</button>}
          </div>}
          <details className="magpie-runtime-help irodori-runtime-help"><summary>Runtime, pinned assets and responsible use</summary>
            <p>Kanafish creates a separate Python virtual environment and does not install Python or these dependencies for Supertonic, Magpie or Qwen. The model checkpoint, tokenizer and codec are pinned to Hugging Face revisions and checked by exact size and SHA-256 before use. The app does not bundle or commit model weights.</p>
            <p>The model card asks users not to clone or impersonate a person without consent or to create misleading synthetic speech/deepfakes. Irodori uses no reference audio in this Voice Lab path. The optional upstream SilentCipher package is not installed, so this build does not watermark generated audio with it.</p>
            <a href="https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small" target="_blank" rel="noreferrer">Irodori v4.1 model card <ExternalLink size={13} /></a>
            <a href="https://huggingface.co/Aratako/Semantic-DACVAE-Japanese-32dim" target="_blank" rel="noreferrer">Japanese DACVAE codec card <ExternalLink size={13} /></a>
          </details>
        </> : <>
          <p className="voice-model-summary">Japanese CustomVoice checkpoint with the built-in Ono Anna preset; no reference recording is needed. The optional C++ server stays on this device and the app downloads the pinned Q8_0 files only after you request them.</p>
          <div className="voice-spec-grid">
            <div><span>Model stack</span><strong>1.95 GB (1.82 GiB) · Q8_0</strong></div>
            <div><span>License</span><strong>Apache-2.0 weights · MIT runtime</strong></div>
            <div><span>Backend</span><strong>codec.cpp CPU; Metal build on macOS</strong></div>
            <div><span>Sandbox CPU test</span><strong>3.44–6.06× real time</strong></div>
          </div>
          {tts.qwenStatusError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.qwenStatusError}</div>}
          {tts.qwenSetupError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.qwenSetupError}</div>}
          {tts.qwenDownloadError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {tts.qwenDownloadError}</div>}
          {qwen?.runtimeReady ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Compatible codec.cpp tts-server detected · Japanese preset is verified when it starts</span></div> : <div className="tts-inline-error" role="status"><AlertCircle size={15} /><span>{qwen?.runtimeFound ? (qwen.runtimeError || 'codec.cpp tts-server was found, but this build is not compatible.') : 'Optional codec.cpp tts-server not detected.'}</span></div>}
          {!qwen?.runtimeReady && <>
            <div className="tts-download-cta native-runtime-setup">
              {tts.qwenSettingUp ? <button className="tts-cache-button" type="button" onClick={() => void tts.cancelQwenRuntimeSetup()}><X size={14} /> Cancel build</button> : <button className="primary-button" type="button" onClick={startQwenRuntimeSetup} disabled={tts.busy || tts.qwenDownloading || !qwen?.nativeSetup?.canBuild}><Cpu size={15} /> {qwen?.nativeSetup?.canBuild ? 'Build codec.cpp runtime' : 'Automatic setup unavailable'}</button>}
              <span>{tts.qwenSettingUp ? qwenProgress?.message || 'Building pinned codec.cpp…' : 'Pinned source · app-private install · Qwen weights remain a separate download'}</span>
            </div>
            {tts.qwenSettingUp && <div className="tts-download-state" aria-live="polite"><div className="tts-progress-copy"><span><Activity size={15} /> {qwenProgress?.message || 'Building the codec.cpp server…'}</span><strong>In progress</strong></div><small>Build output is streamed here. Cancel removes temporary build files and allows retry.</small></div>}
            {!qwen?.nativeSetup?.canBuild && qwen?.nativeSetup?.blockers?.length > 0 && <ul className="runtime-blockers" aria-label="Automatic codec.cpp setup requirements">{qwen.nativeSetup.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
          </>}
          {tts.qwenDownloading ? <div className="tts-download-state" aria-live="polite">
            <div className="tts-progress-copy"><span><Download size={15} /> {qwenProgress?.message || `Downloading ${qwenProgress?.file || 'Qwen model files'}…`}</span><strong>{qwenDownloadPercent}%</strong></div>
            <div className="tts-progress-track"><span style={{ width: `${qwenDownloadPercent}%` }} /></div>
            <small>{formatBytes(qwenProgress?.downloadedBytes || 0)} of {formatBytes(qwenProgress?.totalBytes || qwen?.approximateBytes || 1_949_930_688)} · {qwenProgress?.completedFiles || 0} of {qwenProgress?.totalFiles || 2} files</small>
          </div> : qwen?.modelInstalled ? <div className="tts-ready-state" role="status"><Check size={15} /><span>Checksum-verified model pair cached on this device · {formatBytes(qwen.totalBytes)}</span></div> : <div className="tts-download-cta">
            <button className="primary-button" onClick={startQwenDownload} disabled={!qwen?.canDownload || tts.qwenDownloading}><Download size={15} /> Download Qwen model</button>
            <span>About 1.95 GB · downloaded only when requested</span>
          </div>}
          <details className="magpie-runtime-help qwen-runtime-help"><summary>Native runtime setup and limits</summary>
            <p>If prerequisites and disk space permit, Kanafish can build the pinned codec.cpp commit <code>d5e3852</code> or newer, health-check its OpenAI-compatible WAV server, and install it only under Kanafish app data. This build requires Git, CMake, Ninja, a C++17 compiler, Bash and at least 8 GiB free; it does not include Qwen model weights, which are downloaded separately. Windows uses the manual path. If using your own build, set <code>KANAFISH_CODEC_CPP_TTS_SERVER_PATH</code> or place it in a standard executable directory.</p>
            <p>On Apple Silicon the setup enables <code>GGML_METAL=ON</code>; Kanafish tries the native GPU backend before CPU. The owner’s Mac/Metal path is not tested.</p>
            <p>The app pins Hugging Face revision <code>22f3c6369919f6374f790a65c6fe3aed0ec5f86b</code>, validates both file sizes and SHA-256 values, and starts a loopback-only service with a temporary access token. No reference audio is used or collected.</p>
            <a href="https://github.com/mybigday/codec.cpp/tree/d5e385229ea5a0f48fff696fed4699a852aa43b7" target="_blank" rel="noreferrer">Pinned codec.cpp source <ExternalLink size={13} /></a>
            <a href="https://huggingface.co/BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF/tree/22f3c6369919f6374f790a65c6fe3aed0ec5f86b" target="_blank" rel="noreferrer">Pinned Qwen model files <ExternalLink size={13} /></a>
          </details>
        </>}
        {tts.engineProgress && <div className="tts-engine-progress"><Activity size={14} /> {isMio ? mioProgress?.message || 'Running local CrispASR MioTTS…' : isMagpie ? tts.magpieProgress?.message || 'Starting the native service…' : isQwen ? tts.qwenProgress?.message || 'Starting the native service…' : isIrodoriMf ? `Running ${tts.engineProgress.name}` : isIrodori ? irodoriProgress?.message || 'Starting the local Python sidecar…' : `Loading ${tts.engineProgress.name} (${tts.engineProgress.current}/${tts.engineProgress.total})`}</div>}
        <div className="voice-local-note"><LockKeyhole size={15} /><span>Text and generated audio stay on this device. Magpie, Qwen and MioTTS use local native C++ processes; MioTTS uses CPU and Japanese presets. Plain Irodori runs in an optional local Python sidecar; MF ONNX uses JavaScript/WASM without Python. No reference audio is used here.</span></div>
      </section>

      <section className="voice-lab-panel voice-test-panel" aria-labelledby="try-line-heading">
        <div className="voice-panel-heading"><span className="voice-panel-icon"><Volume2 size={18} /></span><div><span className="eyebrow">SYNTHESIS TEST</span><h2 id="try-line-heading">Try a Japanese line</h2></div></div>
        {isMagpie && magpie?.voices?.length > 0 && <label className="voice-text-label" htmlFor="magpie-voice">Preset voice
          <select id="magpie-voice" className="voice-voice-select" value={tts.magpieVoice} onChange={(event) => tts.setMagpieVoice(event.target.value)} disabled={tts.busy}>
            {magpie.voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
          </select>
        </label>}
        {isQwen && <label className="voice-text-label" htmlFor="qwen-voice">Preset voice
          <select id="qwen-voice" className="voice-voice-select" value={tts.qwenVoice} onChange={(event) => tts.setQwenVoice(event.target.value)} disabled={tts.busy}>
            <option value="ono_anna">Ono Anna (Japanese)</option>
          </select>
        </label>}
        {isMio && <label className="voice-text-label" htmlFor="mio-voice">Japanese preset voice
          <select id="mio-voice" className="voice-voice-select" value={tts.mioVoice} onChange={(event) => tts.setMioVoice(event.target.value)} disabled={tts.busy}>
            <option value="jp_female">Japanese female preset</option>
            <option value="jp_male">Japanese male preset</option>
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
        {isIrodoriMf && !irodoriMf?.installed && <small className="voice-test-hint">Download the separate MF ONNX graphs before generating speech.</small>}
        {isIrodori && irodori?.modelInstalled && !irodori?.runtimeReady && <small className="voice-test-hint">Set up the optional Irodori Python environment before generating speech.</small>}
        {isMagpie && magpie?.modelInstalled && !magpie?.runtimeReady && <small className="voice-test-hint">Synthesis is unavailable until the native runtime includes Japanese TTS and HTTP support.</small>}
        {isQwen && qwen?.modelInstalled && !qwen?.runtimeReady && <small className="voice-test-hint">Synthesis is unavailable until a compatible codec.cpp tts-server is installed.</small>}
        {testError && <div className="tts-inline-error" role="alert"><AlertCircle size={15} /> {testError}</div>}
        {lastResult && <div className="tts-result-card" role="status">
          <div className="tts-result-heading"><Check size={15} /><strong>Audio generated</strong><span>{lastResult.voice ? `${lastResult.voice} · ` : ''}{lastResult.backend}</span></div>
          <div className="tts-result-stats"><div><span>Audio</span><strong>{formatSeconds(lastResult.audioSeconds)}</strong></div><div><span>Generation</span><strong>{formatSeconds(lastResult.generationSeconds)}</strong></div><div><span>RTF</span><strong>{Number.isFinite(lastResult.realTimeFactor) ? lastResult.realTimeFactor.toFixed(2) : '—'}</strong></div></div>
          <small>RTF below 1.0 means generation finished faster than the audio plays. First-time service startup is reported separately.</small>
        </div>}
      </section>
    </div>

    <section className="tts-benchmark-note"><Cpu size={16} /><span><strong>What the sandbox CPU tests say:</strong> Supertonic ran at 0.21–0.46× real time; Magpie at 1.42–1.56×; Qwen at 3.44–6.06×; plain Irodori’s separate four-line benchmark at 3.11–6.02×. The integrated plain v4.1-Small Python path passed a 48 kHz WAV test at 5.47× real time. The separate MF ONNX route generated a valid 48 kHz WAV on JavaScript/WASM in 12.78 s for 1.20 s audio (RTF 10.65, including model loading). MioTTS's integrated no-Python adapter produced a valid 44.1 kHz WAV in 2.81 s for 0.60 s audio (RTF 4.68, including model/process startup). CPU playback is slow. These are speed tests, not naturalness scores; no human listening review or Mac test has been done.</span></section>

    <section className="tts-candidates-section" aria-labelledby="candidate-models-heading">
      <div className="tts-candidates-heading"><div><span className="eyebrow">NOT SUPPORTED HERE YET</span><h2 id="candidate-models-heading">Other models reviewed</h2></div><span className="tts-candidates-count">{unsupportedModels.length} reviewed</span></div>
      <p className="tts-candidates-intro">MioTTS-0.6B is now selectable through Kanafish's verified CrispASR no-Python path; its bundled Japanese preset outputs have an upstream non-commercial restriction. Qwen Base still lacks a verified preset-voice path, and Chatterbox is retired. No untested placeholder is selectable.</p>
      <div className="tts-candidate-grid">{unsupportedModels.map((candidate) => <CandidateCard key={candidate.id} model={candidate} />)}</div>
      <div className="tts-candidate-footnote"><HardDrive size={14} /> Candidate weights are not downloaded. Model, runtime and preset terms for Magpie, Qwen, Irodori and Mio are separate and must be reviewed independently.</div>
    </section>
  </div>
}
