import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTtsEngineReadiness } from './readiness.js'
import { ENABLED_TTS_MODEL_IDS } from './modelCatalog.js'
import { isSupertonicVoice, normalizeSupertonicVoiceSettings, resolveSupertonicVoice } from './supertonicVoices.js'

export function useTts(supertonicVoiceSettings) {
  const voiceSettings = useMemo(() => normalizeSupertonicVoiceSettings(supertonicVoiceSettings), [supertonicVoiceSettings])
  const workerRef = useRef(null)
  const requestIdRef = useRef(0)
  const pendingRef = useRef(new Map())
  const warmPromisesRef = useRef(new Map())
  const activeAudioRef = useRef(null)
  const playbackRequestRef = useRef(0)
  const mountedRef = useRef(false)
  const [modelStatus, setModelStatus] = useState(null)
  const [magpieStatus, setMagpieStatus] = useState(null)
  const [qwenStatus, setQwenStatus] = useState(null)
  const [qwenStatusRefreshing, setQwenStatusRefreshing] = useState(false)
  const [irodoriStatus, setIrodoriStatus] = useState(null)
  const [irodoriMfOnnxStatus, setIrodoriMfOnnxStatus] = useState(null)
  const [mioStatus, setMioStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [magpieStatusError, setMagpieStatusError] = useState('')
  const [qwenStatusError, setQwenStatusError] = useState('')
  const [irodoriStatusError, setIrodoriStatusError] = useState('')
  const [irodoriMfOnnxStatusError, setIrodoriMfOnnxStatusError] = useState('')
  const [mioStatusError, setMioStatusError] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [magpieProgress, setMagpieProgress] = useState(null)
  const [magpieDownloading, setMagpieDownloading] = useState(false)
  const [magpieDownloadError, setMagpieDownloadError] = useState('')
  const [magpieSettingUp, setMagpieSettingUp] = useState(false)
  const [magpieSetupError, setMagpieSetupError] = useState('')
  const [magpieVoice, setMagpieVoice] = useState('Aria')
  const [qwenProgress, setQwenProgress] = useState(null)
  const [qwenDownloading, setQwenDownloading] = useState(false)
  const [qwenDownloadError, setQwenDownloadError] = useState('')
  const [qwenSettingUp, setQwenSettingUp] = useState(false)
  const [qwenSetupError, setQwenSetupError] = useState('')
  const [irodoriProgress, setIrodoriProgress] = useState(null)
  const [irodoriDownloading, setIrodoriDownloading] = useState(false)
  const [irodoriDownloadError, setIrodoriDownloadError] = useState('')
  const [irodoriMfOnnxProgress, setIrodoriMfOnnxProgress] = useState(null)
  const [irodoriMfOnnxDownloading, setIrodoriMfOnnxDownloading] = useState(false)
  const [irodoriMfOnnxCancelling, setIrodoriMfOnnxCancelling] = useState(false)
  const [irodoriMfOnnxDownloadError, setIrodoriMfOnnxDownloadError] = useState('')
  const [mioProgress, setMioProgress] = useState(null)
  const [mioDownloading, setMioDownloading] = useState(false)
  const [mioDownloadError, setMioDownloadError] = useState('')
  const [mioSettingUp, setMioSettingUp] = useState(false)
  const [mioSetupError, setMioSetupError] = useState('')
  const [mioVoice, setMioVoice] = useState('jp_female')
  const [irodoriSettingUp, setIrodoriSettingUp] = useState(false)
  const [irodoriSetupError, setIrodoriSetupError] = useState('')
  const [qwenVoice, setQwenVoice] = useState('ono_anna')
  const activeModelId = ENABLED_TTS_MODEL_IDS[0]
  const [backend, setBackend] = useState('')
  const [engineProgress, setEngineProgress] = useState(null)
  const [synthesisProgress, setSynthesisProgress] = useState(null)
  const [busyCount, setBusyCount] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playingText, setPlayingText] = useState('')
  const [error, setError] = useState('')

  const refreshModelStatus = useCallback(async () => {
    if (!window.kanafish?.getTtsModelStatus) {
      setStatusError('The local TTS model manager is available in the Kanafish desktop app.')
      return null
    }
    const [supertonicResult, magpieResult, qwenResult, irodoriResult, irodoriMfOnnxResult, mioResult] = await Promise.allSettled([
      window.kanafish.getTtsModelStatus(),
      window.kanafish.getMagpieStatus ? window.kanafish.getMagpieStatus() : Promise.resolve(null),
      window.kanafish.getQwenStatus ? window.kanafish.getQwenStatus() : Promise.resolve(null),
      window.kanafish.getIrodoriStatus ? window.kanafish.getIrodoriStatus() : Promise.resolve(null),
      window.kanafish.getIrodoriMfOnnxStatus ? window.kanafish.getIrodoriMfOnnxStatus() : Promise.resolve(null),
      window.kanafish.getMioStatus ? window.kanafish.getMioStatus() : Promise.resolve(null)
    ])
    if (supertonicResult.status === 'fulfilled') {
      setModelStatus(supertonicResult.value)
      setStatusError('')
    } else {
      setStatusError(supertonicResult.reason?.message || 'Could not read the local Supertonic cache.')
    }
    if (magpieResult.status === 'fulfilled') {
      setMagpieStatus(magpieResult.value)
      setMagpieStatusError('')
    } else {
      setMagpieStatusError(magpieResult.reason?.message || 'Could not inspect the Magpie runtime.')
    }
    if (qwenResult.status === 'fulfilled') {
      setQwenStatus(qwenResult.value)
      setQwenStatusError('')
    } else {
      setQwenStatusError(qwenResult.reason?.message || 'Could not inspect the codec.cpp runtime.')
    }
    if (irodoriResult.status === 'fulfilled') {
      setIrodoriStatus(irodoriResult.value)
      setIrodoriStatusError('')
    } else {
      setIrodoriStatusError(irodoriResult.reason?.message || 'Could not inspect the optional Irodori runtime.')
    }
    if (irodoriMfOnnxResult.status === 'fulfilled') {
      setIrodoriMfOnnxStatus(irodoriMfOnnxResult.value)
      setIrodoriMfOnnxStatusError('')
    } else {
      setIrodoriMfOnnxStatusError(irodoriMfOnnxResult.reason?.message || 'Could not inspect the Irodori MF ONNX cache.')
    }
    if (mioResult.status === 'fulfilled') {
      setMioStatus(mioResult.value)
      setMioStatusError('')
    } else {
      setMioStatusError(mioResult.reason?.message || 'Could not inspect the MioTTS runtime or model cache.')
    }
    return supertonicResult.status === 'fulfilled' ? supertonicResult.value : null
  }, [])

  const refreshQwenStatus = useCallback(async () => {
    if (!window.kanafish?.getQwenStatus) {
      setQwenStatusError('The codec.cpp runtime status is available in the Kanafish desktop app.')
      return null
    }
    setQwenStatusRefreshing(true)
    try {
      const status = await window.kanafish.getQwenStatus()
      setQwenStatus(status)
      setQwenStatusError('')
      return status
    } catch (failure) {
      setQwenStatusError(failure?.message || 'Could not inspect the codec.cpp runtime.')
      return null
    } finally {
      setQwenStatusRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    mountedRef.current = true
    const stopSupertonicProgress = window.kanafish?.onTtsDownloadProgress?.((progress) => {
      if (active) setDownloadProgress(progress)
    })
    const stopMagpieProgress = window.kanafish?.onMagpieProgress?.((progress) => {
      if (active) setMagpieProgress(progress)
    })
    const stopQwenProgress = window.kanafish?.onQwenProgress?.((progress) => {
      if (active) setQwenProgress(progress)
    })
    const stopNativeRuntimeSetupProgress = window.kanafish?.onNativeRuntimeSetupProgress?.((progress) => {
      if (!active) return
      if (progress.runtimeId === 'codecCpp') setQwenProgress(progress)
      if (progress.runtimeId === 'nemoSpeech') setMagpieProgress(progress)
    })
    const stopIrodoriProgress = window.kanafish?.onIrodoriProgress?.((progress) => {
      if (active) setIrodoriProgress(progress)
    })
    const stopIrodoriMfOnnxProgress = window.kanafish?.onIrodoriMfOnnxProgress?.((progress) => {
      if (active) setIrodoriMfOnnxProgress(progress)
    })
    const stopMioProgress = window.kanafish?.onMioProgress?.((progress) => {
      if (active) setMioProgress(progress)
    })
    void refreshModelStatus()
    return () => {
      active = false
      mountedRef.current = false
      playbackRequestRef.current += 1
      stopSupertonicProgress?.()
      stopMagpieProgress?.()
      stopQwenProgress?.()
      stopNativeRuntimeSetupProgress?.()
      stopIrodoriProgress?.()
      stopIrodoriMfOnnxProgress?.()
      stopMioProgress?.()
      workerRef.current?.terminate()
      workerRef.current = null
      for (const item of pendingRef.current.values()) item.reject(new Error('TTS session closed'))
      pendingRef.current.clear()
      if (activeAudioRef.current) {
        const playback = activeAudioRef.current
        activeAudioRef.current = null
        playback.audio.pause()
        URL.revokeObjectURL(playback.url)
        playback.finish?.(null)
      }
    }
  }, [refreshModelStatus])

  const downloadModel = useCallback(async () => {
    if (!window.kanafish?.downloadTtsModel) throw new Error('Model downloads are available in the Kanafish desktop app.')
    setDownloading(true)
    setDownloadError('')
    setDownloadProgress({ modelId: 'supertonic-3', downloadedBytes: 0, totalBytes: modelStatus?.totalBytes || 0, completedFiles: 0, totalFiles: modelStatus?.files?.length || 7 })
    try {
      const status = await window.kanafish.downloadTtsModel()
      setModelStatus(status)
      setDownloadProgress({ modelId: status.id, downloadedBytes: status.totalBytes, totalBytes: status.totalBytes, completedFiles: status.files.length, totalFiles: status.files.length })
      return status
    } catch (downloadFailure) {
      const message = downloadFailure?.message || 'Could not download the model from Hugging Face.'
      setDownloadError(message)
      throw downloadFailure
    } finally {
      setDownloading(false)
    }
  }, [modelStatus?.files?.length, modelStatus?.totalBytes])

  const downloadMagpieModel = useCallback(async () => {
    if (!window.kanafish?.downloadMagpieModel) throw new Error('Magpie downloads are available in the Kanafish desktop app.')
    setMagpieDownloading(true)
    setMagpieDownloadError('')
    setMagpieProgress({ modelId: 'magpie-v2607', state: 'downloading', message: 'Preparing the local Magpie model cache…' })
    try {
      const status = await window.kanafish.downloadMagpieModel()
      setMagpieStatus(status)
      setMagpieProgress({ modelId: status.id, state: 'complete', message: `Downloaded on this device · ${status.totalBytes} bytes` })
      return status
    } catch (downloadFailure) {
      const message = downloadFailure?.message || 'Could not download the Magpie model stack.'
      setMagpieDownloadError(message)
      throw downloadFailure
    } finally {
      setMagpieDownloading(false)
    }
  }, [])

  const setupMagpieRuntime = useCallback(async () => {
    if (!window.kanafish?.setupMagpieRuntime) throw new Error('NeMo-Speech.cpp setup is available in the Kanafish desktop app.')
    setMagpieSettingUp(true)
    setMagpieSetupError('')
    setMagpieProgress({ runtimeId: 'nemoSpeech', state: 'setup', stage: 'starting', message: 'Preparing the pinned NeMo-Speech.cpp build…' })
    try {
      const status = await window.kanafish.setupMagpieRuntime()
      setMagpieStatus(status)
      setMagpieProgress({ runtimeId: 'nemoSpeech', state: 'complete', stage: 'complete', message: 'Japanese-capable NeMo-Speech.cpp runtime is ready.' })
      return status
    } catch (setupFailure) {
      const message = setupFailure?.message || 'Could not build NeMo-Speech.cpp.'
      setMagpieSetupError(message)
      try { setMagpieStatus(await window.kanafish.getMagpieStatus()) } catch {}
      throw setupFailure
    } finally {
      setMagpieSettingUp(false)
    }
  }, [])

  const cancelMagpieRuntimeSetup = useCallback(async () => {
    if (!window.kanafish?.cancelMagpieRuntimeSetup) return { cancelled: false }
    return window.kanafish.cancelMagpieRuntimeSetup()
  }, [])

  const downloadQwenModel = useCallback(async () => {
    if (!window.kanafish?.downloadQwenModel) throw new Error('Qwen downloads are available in the Kanafish desktop app.')
    setQwenDownloading(true)
    setQwenDownloadError('')
    setQwenProgress({ modelId: 'qwen3-tts-0.6b-customvoice', state: 'downloading', message: 'Preparing the local Qwen model cache…' })
    try {
      const status = await window.kanafish.downloadQwenModel()
      setQwenStatus(status)
      setQwenProgress({ modelId: status.id, state: 'complete', downloadedBytes: status.totalBytes, totalBytes: status.totalBytes, completedFiles: 2, totalFiles: 2, message: 'Qwen3-TTS CustomVoice is cached and checksum-verified.' })
      return status
    } catch (downloadFailure) {
      const message = downloadFailure?.message || 'Could not download the Qwen model files from Hugging Face.'
      setQwenDownloadError(message)
      throw downloadFailure
    } finally {
      setQwenDownloading(false)
    }
  }, [])

  const setupQwenRuntime = useCallback(async () => {
    if (!window.kanafish?.setupQwenRuntime) throw new Error('codec.cpp setup is available in the Kanafish desktop app.')
    setQwenSettingUp(true)
    setQwenSetupError('')
    setQwenProgress({ runtimeId: 'codecCpp', state: 'setup', stage: 'starting', message: 'Preparing the pinned codec.cpp build…' })
    try {
      const status = await window.kanafish.setupQwenRuntime()
      setQwenStatus(status)
      setQwenProgress({ runtimeId: 'codecCpp', state: 'complete', stage: 'complete', message: 'Pinned codec.cpp installed; live server and Japanese-voice checks run at synthesis startup.' })
      return status
    } catch (setupFailure) {
      const message = setupFailure?.message || 'Could not build codec.cpp.'
      setQwenSetupError(message)
      try { setQwenStatus(await window.kanafish.getQwenStatus()) } catch {}
      throw setupFailure
    } finally {
      setQwenSettingUp(false)
    }
  }, [])

  const cancelQwenRuntimeSetup = useCallback(async () => {
    if (!window.kanafish?.cancelQwenRuntimeSetup) return { cancelled: false }
    return window.kanafish.cancelQwenRuntimeSetup()
  }, [])

  const downloadIrodoriModel = useCallback(async () => {
    if (!window.kanafish?.downloadIrodoriModel) throw new Error('Irodori downloads are available in the Kanafish desktop app.')
    setIrodoriDownloading(true)
    setIrodoriDownloadError('')
    setIrodoriProgress({ modelId: 'irodori-v4.1-small', state: 'downloading', downloadedBytes: 0, totalBytes: irodoriStatus?.approximateBytes || 0, message: 'Preparing the pinned Irodori model cache…' })
    try {
      const status = await window.kanafish.downloadIrodoriModel()
      setIrodoriStatus(status)
      setIrodoriProgress({ modelId: status.id, state: 'complete', downloadedBytes: status.downloadedBytes, totalBytes: status.approximateBytes, completedFiles: status.files.length, totalFiles: status.files.length, message: 'Irodori model, tokenizer and codec are checksum-verified.' })
      return status
    } catch (downloadFailure) {
      const message = downloadFailure?.message || 'Could not download the pinned Irodori model and codec.'
      setIrodoriDownloadError(message)
      if (window.kanafish?.getIrodoriStatus) {
        try { setIrodoriStatus(await window.kanafish.getIrodoriStatus()) } catch {}
      }
      throw downloadFailure
    } finally {
      setIrodoriDownloading(false)
    }
  }, [irodoriStatus?.approximateBytes])

  const downloadIrodoriMfOnnxModel = useCallback(async () => {
    if (!window.kanafish?.downloadIrodoriMfOnnxModel) throw new Error('Irodori MF ONNX downloads are available in the Kanafish desktop app.')
    setIrodoriMfOnnxDownloading(true)
    setIrodoriMfOnnxDownloadError('')
    setIrodoriMfOnnxProgress({ modelId: 'irodori-v4.1-small-mf', state: 'downloading', downloadedBytes: 0, totalBytes: irodoriMfOnnxStatus?.totalBytes || 0, message: 'Preparing the pinned Irodori-Small-MF ONNX cache…' })
    try {
      const status = await window.kanafish.downloadIrodoriMfOnnxModel()
      setIrodoriMfOnnxStatus(status)
      setIrodoriMfOnnxProgress({ modelId: status.id, state: 'complete', downloadedBytes: status.totalBytes, totalBytes: status.totalBytes, completedFiles: status.files.length, totalFiles: status.files.length, message: 'MF ONNX graphs and tokenizer are checksum-verified.' })
      return status
    } catch (downloadFailure) {
      const message = /cancelled/i.test(downloadFailure?.message || '')
        ? 'Download cancelled. Partial file data is kept; choose Download again to resume.'
        : downloadFailure?.message || 'Could not download the Irodori-Small-MF ONNX pack.'
      setIrodoriMfOnnxDownloadError(message)
      try { setIrodoriMfOnnxStatus(await window.kanafish.getIrodoriMfOnnxStatus()) } catch {}
      throw downloadFailure
    } finally {
      setIrodoriMfOnnxDownloading(false)
    }
  }, [irodoriMfOnnxStatus?.totalBytes])

  const cancelIrodoriMfOnnxDownload = useCallback(async () => {
    if (!window.kanafish?.cancelIrodoriMfOnnxDownload) return { cancelled: false }
    setIrodoriMfOnnxCancelling(true)
    try {
      return await window.kanafish.cancelIrodoriMfOnnxDownload()
    } finally {
      setIrodoriMfOnnxCancelling(false)
    }
  }, [])

  const setupIrodoriPython = useCallback(async () => {
    if (!window.kanafish?.setupIrodoriPython) throw new Error('Irodori setup is available in the Kanafish desktop app.')
    setIrodoriSettingUp(true)
    setIrodoriSetupError('')
    setIrodoriProgress({ modelId: 'irodori-v4.1-small', state: 'setting-up', message: 'Preparing the isolated Irodori Python environment…' })
    try {
      const status = await window.kanafish.setupIrodoriPython()
      setIrodoriStatus(status)
      setIrodoriProgress({ modelId: status.id, state: 'setup-complete', message: status.mpsAvailable ? 'Isolated Irodori runtime is ready; PyTorch MPS is available.' : 'Isolated Irodori runtime is ready; CPU backend is available.' })
      return status
    } catch (setupFailure) {
      const message = setupFailure?.message || 'Could not set up Irodori’s optional Python runtime.'
      setIrodoriSetupError(message)
      if (window.kanafish?.getIrodoriStatus) {
        try { setIrodoriStatus(await window.kanafish.getIrodoriStatus()) } catch {}
      }
      throw setupFailure
    } finally {
      setIrodoriSettingUp(false)
    }
  }, [])

  const clearIrodoriModelCache = useCallback(async () => {
    if (!window.kanafish?.clearIrodoriModelCache) throw new Error('Irodori cache controls are available in the Kanafish desktop app.')
    const status = await window.kanafish.clearIrodoriModelCache()
    setIrodoriStatus(status)
    setIrodoriProgress(null)
    return status
  }, [])

  const removeIrodoriPythonRuntime = useCallback(async () => {
    if (!window.kanafish?.removeIrodoriPythonRuntime) throw new Error('Irodori runtime controls are available in the Kanafish desktop app.')
    const status = await window.kanafish.removeIrodoriPythonRuntime()
    setIrodoriStatus(status)
    setIrodoriProgress(null)
    return status
  }, [])

  const removeIrodoriMfOnnxModel = useCallback(async () => {
    if (!window.kanafish?.removeIrodoriMfOnnxModel) throw new Error('Irodori MF ONNX cache controls are available in the Kanafish desktop app.')
    const status = await window.kanafish.removeIrodoriMfOnnxModel()
    setIrodoriMfOnnxStatus(status)
    setIrodoriMfOnnxProgress(null)
    return status
  }, [])

  const setupMioRuntime = useCallback(async () => {
    if (!window.kanafish?.setupMioRuntime) throw new Error('CrispASR setup is available in the Kanafish desktop app.')
    setMioSettingUp(true)
    setMioSetupError('')
    setMioProgress({ runtimeId: 'crispasr', state: 'setup', message: 'Preparing the pinned CrispASR runtime…' })
    try {
      const status = await window.kanafish.setupMioRuntime()
      setMioStatus(status)
      setMioProgress({ runtimeId: 'crispasr', state: 'runtime-ready', message: `CrispASR ${status.runtimeVersion} with MioTTS is ready.` })
      return status
    } catch (failure) {
      const message = failure?.message || 'Could not install the pinned CrispASR runtime.'
      setMioSetupError(message)
      try { setMioStatus(await window.kanafish.getMioStatus()) } catch {}
      throw failure
    } finally {
      setMioSettingUp(false)
    }
  }, [])

  const downloadMioModel = useCallback(async () => {
    if (!window.kanafish?.downloadMioModel) throw new Error('MioTTS downloads are available in the Kanafish desktop app.')
    setMioDownloading(true)
    setMioDownloadError('')
    setMioProgress({ modelId: 'miotts-0.6b', state: 'downloading', downloadedBytes: 0, totalBytes: mioStatus?.totalBytes || 540_000_888, message: 'Preparing the pinned MioTTS model cache…' })
    try {
      const status = await window.kanafish.downloadMioModel()
      setMioStatus(status)
      setMioProgress({ modelId: status.id, state: 'complete', downloadedBytes: status.totalBytes, totalBytes: status.totalBytes, completedFiles: status.files.length, totalFiles: status.files.length, message: 'MioTTS model, tokenizer and Japanese voices are checksum-verified.' })
      return status
    } catch (failure) {
      const message = failure?.message || 'Could not download the pinned MioTTS model files.'
      setMioDownloadError(message)
      try { setMioStatus(await window.kanafish.getMioStatus()) } catch {}
      throw failure
    } finally {
      setMioDownloading(false)
    }
  }, [mioStatus?.totalBytes])

  const removeMioModelCache = useCallback(async () => {
    if (!window.kanafish?.removeMioModelCache) throw new Error('MioTTS cache controls are available in the Kanafish desktop app.')
    const status = await window.kanafish.removeMioModelCache()
    setMioStatus(status)
    setMioProgress(null)
    return status
  }, [])

  const removeMioRuntime = useCallback(async () => {
    if (!window.kanafish?.removeMioRuntime) throw new Error('CrispASR runtime controls are available in the Kanafish desktop app.')
    const status = await window.kanafish.removeMioRuntime()
    setMioStatus(status)
    setMioProgress(null)
    return status
  }, [])

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('./supertonic.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const message = event.data || {}
      if (message.type === 'engine') setBackend(message.backend)
      if (message.type === 'load-progress') setEngineProgress(message)
      if (message.type === 'synthesis-progress') setSynthesisProgress(message)
      if (message.type === 'result' || message.type === 'error' || message.type === 'warmed') {
        const pending = pendingRef.current.get(message.id)
        if (!pending) return
        pendingRef.current.delete(message.id)
        setBusyCount(pendingRef.current.size)
        if (message.type === 'result') {
          setError('')
          setSynthesisProgress(null)
          pending.resolve(message)
        } else if (message.type === 'warmed') {
          setError('')
          setEngineProgress(null)
          setSynthesisProgress(null)
          pending.resolve(message)
        } else {
          setError(message.error)
          setSynthesisProgress(null)
          pending.reject(new Error(message.error))
        }
      }
    }
    worker.onerror = (event) => {
      const message = event.message || 'The local TTS worker stopped unexpectedly.'
      setError(message)
      for (const pending of pendingRef.current.values()) pending.reject(new Error(message))
      pendingRef.current.clear()
      warmPromisesRef.current.clear()
      setBusyCount(0)
      workerRef.current = null
    }
    workerRef.current = worker
    return worker
  }, [])

  const synthesize = useCallback((text, options = {}) => {
    if (!text?.trim()) return Promise.reject(new Error('Enter Japanese text to synthesize.'))
    setError('')
    if (activeModelId === 'miotts-0.6b') {
      if (!mioStatus?.modelInstalled) return Promise.reject(new Error('Download the pinned MioTTS-0.6B model and Japanese voice preset in Voice Lab before generating speech.'))
      if (!mioStatus?.runtimeReady) return Promise.reject(new Error('Install the pinned CrispASR runtime in Voice Lab before generating speech.'))
      if (!window.kanafish?.synthesizeMio) return Promise.reject(new Error('MioTTS synthesis is available in the Kanafish desktop app.'))
      setBusyCount((count) => count + 1)
      setEngineProgress({ name: 'CrispASR 0.8.54 MioTTS · CPU', current: 1, total: 1 })
      return window.kanafish.synthesizeMio({ text, voice: options.voice || mioVoice }).then((result) => {
        setBackend(result.backend)
        setEngineProgress(null)
        setError('')
        return result
      }).catch((failure) => {
        setEngineProgress(null)
        setError(failure?.message || 'MioTTS synthesis failed.')
        throw failure
      }).finally(() => setBusyCount((count) => Math.max(0, count - 1)))
    }
    if (activeModelId === 'irodori-v4.1-small-mf') {
      if (!irodoriMfOnnxStatus?.installed) return Promise.reject(new Error('Download the separate Irodori v4.1-Small-MF ONNX pack in Voice Lab before generating speech.'))
      if (!window.kanafish?.synthesizeIrodoriMfOnnx) return Promise.reject(new Error('Irodori MF ONNX synthesis is available in the Kanafish desktop app.'))
      setBusyCount((count) => count + 1)
      setEngineProgress({ name: 'Irodori v4.1-Small-MF · ONNX Runtime WebAssembly CPU', current: 1, total: 1 })
      return window.kanafish.synthesizeIrodoriMfOnnx({ text }).then((result) => {
        setBackend(result.backend)
        setEngineProgress(null)
        setError('')
        return result
      }).catch((failure) => {
        setEngineProgress(null)
        setError(failure?.message || 'Irodori MF ONNX synthesis failed.')
        throw failure
      }).finally(() => setBusyCount((count) => Math.max(0, count - 1)))
    }
    if (activeModelId === 'irodori-v4.1-small') {
      if (!irodoriStatus?.modelInstalled) return Promise.reject(new Error('Download the Irodori model and codec in Voice Lab before generating speech.'))
      if (!irodoriStatus?.runtimeReady) return Promise.reject(new Error('Set up the optional Irodori Python runtime in Voice Lab before generating speech.'))
      if (!window.kanafish?.synthesizeIrodori) return Promise.reject(new Error('Irodori synthesis is available in the Kanafish desktop app.'))
      setBusyCount((count) => count + 1)
      setEngineProgress({ name: 'Local Irodori Python sidecar', current: 1, total: 1 })
      return window.kanafish.synthesizeIrodori({ text }).then((result) => {
        setBackend(result.backend)
        setEngineProgress(null)
        setError('')
        return result
      }).catch((failure) => {
        setEngineProgress(null)
        setError(failure?.message || 'Irodori synthesis failed.')
        throw failure
      }).finally(() => setBusyCount((count) => Math.max(0, count - 1)))
    }
    if (activeModelId === 'qwen3-tts-0.6b-customvoice') {
      if (!qwenStatus?.modelInstalled) return Promise.reject(new Error('Download the Qwen3-TTS model in Voice Lab before generating speech.'))
      if (!window.kanafish?.synthesizeQwen) return Promise.reject(new Error('Qwen synthesis is available in the Kanafish desktop app.'))
      setBusyCount((count) => count + 1)
      setEngineProgress({ name: 'Local codec.cpp service', current: 1, total: 1 })
      return window.kanafish.synthesizeQwen({ text, voice: options.voice || qwenVoice }).then((result) => {
        setBackend(result.backend)
        setEngineProgress(null)
        setError('')
        return result
      }).catch((failure) => {
        setEngineProgress(null)
        setError(failure?.message || 'Qwen synthesis failed.')
        throw failure
      }).finally(() => setBusyCount((count) => Math.max(0, count - 1)))
    }
    if (activeModelId === 'magpie-v2607') {
      if (!magpieStatus?.modelInstalled) return Promise.reject(new Error('Download the Magpie model stack in Voice Lab before generating speech.'))
      if (!window.kanafish?.synthesizeMagpie) return Promise.reject(new Error('Magpie synthesis is available in the Kanafish desktop app.'))
      setBusyCount((count) => count + 1)
      setEngineProgress({ name: 'Local NeMo-Speech.cpp service', current: 1, total: 1 })
      return window.kanafish.synthesizeMagpie({ text, voice: options.voice || magpieVoice }).then((result) => {
        setBackend(result.backend)
        setEngineProgress(null)
        setError('')
        return result
      }).catch((failure) => {
        setEngineProgress(null)
        setError(failure?.message || 'Magpie synthesis failed.')
        throw failure
      }).finally(() => setBusyCount((count) => Math.max(0, count - 1)))
    }
    if (!modelStatus?.installed) return Promise.reject(new Error('Download the Supertonic model in Voice Lab before generating speech.'))
    const worker = ensureWorker()
    const id = ++requestIdRef.current
    setBusyCount(pendingRef.current.size + 1)
    setEngineProgress(null)
    const { weekNumber, lessonNumber, courseId, ...synthesisOptions } = options
    const voice = isSupertonicVoice(options.voice)
      ? options.voice
      : resolveSupertonicVoice(voiceSettings, { weekNumber, lessonNumber, courseId })
    return new Promise((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject })
      worker.postMessage({ type: 'synthesize', id, text, options: { ...synthesisOptions, voice } })
    })
  }, [activeModelId, ensureWorker, irodoriMfOnnxStatus?.installed, irodoriStatus?.modelInstalled, irodoriStatus?.runtimeReady, magpieStatus?.modelInstalled, magpieVoice, mioStatus?.modelInstalled, mioStatus?.runtimeReady, mioVoice, modelStatus?.installed, qwenStatus?.modelInstalled, qwenVoice, voiceSettings])

  const prewarm = useCallback((options = {}) => {
    if (activeModelId !== 'supertonic-3' || !modelStatus?.installed) return Promise.resolve({ ready: false, skipped: true })
    const { weekNumber, lessonNumber, courseId } = options
    const voice = isSupertonicVoice(options.voice)
      ? options.voice
      : resolveSupertonicVoice(voiceSettings, { weekNumber, lessonNumber, courseId })
    const existing = warmPromisesRef.current.get(voice)
    if (existing) return existing
    const worker = ensureWorker()
    const id = ++requestIdRef.current
    const promise = new Promise((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject, kind: 'warm' })
      setBusyCount(pendingRef.current.size)
      setEngineProgress({ name: 'Supertonic 3', current: 0, total: 1 })
      worker.postMessage({ type: 'warm', id, options: { voice } })
    }).finally(() => warmPromisesRef.current.delete(voice))
    warmPromisesRef.current.set(voice, promise)
    return promise
  }, [activeModelId, ensureWorker, modelStatus?.installed, voiceSettings])

  const stopCurrentAudio = useCallback(() => {
    const playback = activeAudioRef.current
    if (!playback) return false
    activeAudioRef.current = null
    playback.audio.pause()
    try { playback.audio.currentTime = 0 } catch {}
    playback.finish?.(null)
    if (mountedRef.current) {
      setIsPlaying(false)
      setPlayingText('')
    }
    return true
  }, [])

  const stopPlayback = useCallback(() => {
    playbackRequestRef.current += 1
    stopCurrentAudio()
    if (mountedRef.current) {
      setIsPlaying(false)
      setPlayingText('')
    }
  }, [stopCurrentAudio])

  const playAudioResult = useCallback((result, playbackRate, requestId, text) => {
    if (requestId !== playbackRequestRef.current) return Promise.resolve(null)
    const url = URL.createObjectURL(new Blob([result.audioBuffer], { type: 'audio/wav' }))
    const audio = new Audio(url)
    const rate = Number.isFinite(playbackRate) ? playbackRate : 1
    audio.playbackRate = Math.max(0.75, Math.min(1.25, rate))

    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (value, failure) => {
        if (finished) return
        finished = true
        if (activeAudioRef.current?.audio === audio) activeAudioRef.current = null
        URL.revokeObjectURL(url)
        if (mountedRef.current && requestId === playbackRequestRef.current) {
          setIsPlaying(false)
          setPlayingText('')
        }
        if (failure) reject(failure)
        else resolve(value)
      }
      activeAudioRef.current = { audio, url, finish }
      if (mountedRef.current) {
        setIsPlaying(true)
        setPlayingText(text)
      }
      audio.addEventListener('ended', () => finish(result), { once: true })
      audio.addEventListener('error', () => finish(null, new Error('Could not play the generated speech on this device.')), { once: true })
      audio.play().catch((playFailure) => finish(null, playFailure))
    })
  }, [])

  const playText = useCallback(async (text, options = {}) => {
    const requestId = ++playbackRequestRef.current
    stopCurrentAudio()
    setError('')
    const { rate = 1, ...synthesisOptions } = options
    try {
      const result = await synthesize(text, synthesisOptions)
      if (requestId !== playbackRequestRef.current) return { cancelled: true }
      const playback = await playAudioResult(result, rate, requestId, text)
      return playback === null ? { cancelled: true } : result
    } catch (playFailure) {
      if (requestId === playbackRequestRef.current) setError(playFailure?.message || 'Could not play the generated speech on this device.')
      throw playFailure
    }
  }, [playAudioResult, stopCurrentAudio, synthesize])

  const playDialogue = useCallback(async (lines, options = {}) => {
    const dialogue = (Array.isArray(lines) ? lines : []).filter((line) => typeof line?.ja === 'string' && line.ja.trim())
    if (!dialogue.length) throw new Error('This lesson does not contain Japanese dialogue to play.')
    const requestId = ++playbackRequestRef.current
    stopCurrentAudio()
    setError('')
    const { rate = 1, ...synthesisOptions } = options
    const voice = isSupertonicVoice(synthesisOptions.voice)
      ? synthesisOptions.voice
      : resolveSupertonicVoice(voiceSettings, synthesisOptions)
    const dialogueOptions = { ...synthesisOptions, voice }
    const results = []
    try {
      for (const [index, line] of dialogue.entries()) {
        if (requestId !== playbackRequestRef.current) return { cancelled: true, results }
        const result = await synthesize(line.ja, dialogueOptions)
        if (requestId !== playbackRequestRef.current) return { cancelled: true, results }
        const playback = await playAudioResult(result, rate, requestId, line.ja)
        if (playback === null || requestId !== playbackRequestRef.current) return { cancelled: true, results }
        results.push(result)
        if (index < dialogue.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 240))
        }
      }
      return { cancelled: false, results }
    } catch (playFailure) {
      if (requestId === playbackRequestRef.current) setError(playFailure?.message || 'Could not play the lesson dialogue.')
      throw playFailure
    }
  }, [playAudioResult, stopCurrentAudio, synthesize, voiceSettings])

  const clearError = useCallback(() => setError(''), [])

  const activeEngineStatus = getTtsEngineReadiness(activeModelId, {
    modelStatus,
    magpieStatus,
    qwenStatus,
    irodoriStatus,
    irodoriMfOnnxStatus,
    mioStatus
  })

  return {
    modelStatus,
    magpieStatus,
    qwenStatus,
    irodoriStatus,
    irodoriMfOnnxStatus,
    mioStatus,
    statusError,
    magpieStatusError,
    qwenStatusError,
    qwenStatusRefreshing,
    irodoriStatusError,
    irodoriMfOnnxStatusError,
    mioStatusError,
    refreshModelStatus,
    refreshQwenStatus,
    downloadProgress,
    downloading,
    downloadError,
    downloadModel,
    magpieProgress,
    magpieDownloading,
    magpieDownloadError,
    downloadMagpieModel,
    magpieSettingUp,
    magpieSetupError,
    setupMagpieRuntime,
    cancelMagpieRuntimeSetup,
    magpieVoice,
    setMagpieVoice,
    qwenProgress,
    qwenDownloading,
    qwenDownloadError,
    downloadQwenModel,
    qwenSettingUp,
    qwenSetupError,
    setupQwenRuntime,
    cancelQwenRuntimeSetup,
    qwenVoice,
    setQwenVoice,
    irodoriProgress,
    irodoriDownloading,
    irodoriDownloadError,
    downloadIrodoriModel,
    irodoriMfOnnxProgress,
    irodoriMfOnnxDownloading,
    irodoriMfOnnxCancelling,
    irodoriMfOnnxDownloadError,
    downloadIrodoriMfOnnxModel,
    cancelIrodoriMfOnnxDownload,
    removeIrodoriMfOnnxModel,
    mioProgress,
    mioDownloading,
    mioDownloadError,
    downloadMioModel,
    mioSettingUp,
    mioSetupError,
    setupMioRuntime,
    removeMioModelCache,
    removeMioRuntime,
    mioVoice,
    setMioVoice,
    irodoriSettingUp,
    irodoriSetupError,
    setupIrodoriPython,
    clearIrodoriModelCache,
    removeIrodoriPythonRuntime,
    activeModelId,
    activeEngineStatus,
    prewarm,
    backend,
    engineProgress,
    synthesisProgress,
    busy: busyCount > 0,
    isPlaying,
    playingText,
    stopPlayback,
    error,
    clearError,
    synthesize,
    playText,
    playDialogue
  }
}
