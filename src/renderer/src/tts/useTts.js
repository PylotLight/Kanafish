import { useCallback, useEffect, useRef, useState } from 'react'

export function useTts() {
  const workerRef = useRef(null)
  const requestIdRef = useRef(0)
  const pendingRef = useRef(new Map())
  const activeAudioRef = useRef(null)
  const [modelStatus, setModelStatus] = useState(null)
  const [magpieStatus, setMagpieStatus] = useState(null)
  const [qwenStatus, setQwenStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [magpieStatusError, setMagpieStatusError] = useState('')
  const [qwenStatusError, setQwenStatusError] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [magpieProgress, setMagpieProgress] = useState(null)
  const [magpieDownloading, setMagpieDownloading] = useState(false)
  const [magpieDownloadError, setMagpieDownloadError] = useState('')
  const [magpieVoice, setMagpieVoice] = useState('Aria')
  const [qwenProgress, setQwenProgress] = useState(null)
  const [qwenDownloading, setQwenDownloading] = useState(false)
  const [qwenDownloadError, setQwenDownloadError] = useState('')
  const [qwenVoice, setQwenVoice] = useState('ono_anna')
  const [activeModelId, setActiveModelId] = useState('supertonic-3')
  const [backend, setBackend] = useState('')
  const [engineProgress, setEngineProgress] = useState(null)
  const [synthesisProgress, setSynthesisProgress] = useState(null)
  const [busyCount, setBusyCount] = useState(0)
  const [error, setError] = useState('')

  const refreshModelStatus = useCallback(async () => {
    if (!window.kanafish?.getTtsModelStatus) {
      setStatusError('The local TTS model manager is available in the Kanafish desktop app.')
      return null
    }
    const [supertonicResult, magpieResult, qwenResult] = await Promise.allSettled([
      window.kanafish.getTtsModelStatus(),
      window.kanafish.getMagpieStatus ? window.kanafish.getMagpieStatus() : Promise.resolve(null),
      window.kanafish.getQwenStatus ? window.kanafish.getQwenStatus() : Promise.resolve(null)
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
    return supertonicResult.status === 'fulfilled' ? supertonicResult.value : null
  }, [])

  useEffect(() => {
    let active = true
    const stopSupertonicProgress = window.kanafish?.onTtsDownloadProgress?.((progress) => {
      if (active) setDownloadProgress(progress)
    })
    const stopMagpieProgress = window.kanafish?.onMagpieProgress?.((progress) => {
      if (active) setMagpieProgress(progress)
    })
    const stopQwenProgress = window.kanafish?.onQwenProgress?.((progress) => {
      if (active) setQwenProgress(progress)
    })
    void refreshModelStatus()
    return () => {
      active = false
      stopSupertonicProgress?.()
      stopMagpieProgress?.()
      stopQwenProgress?.()
      workerRef.current?.terminate()
      workerRef.current = null
      for (const item of pendingRef.current.values()) item.reject(new Error('TTS session closed'))
      pendingRef.current.clear()
      if (activeAudioRef.current) {
        activeAudioRef.current.audio.pause()
        URL.revokeObjectURL(activeAudioRef.current.url)
        activeAudioRef.current = null
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

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('./supertonic.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const message = event.data || {}
      if (message.type === 'engine') setBackend(message.backend)
      if (message.type === 'load-progress') setEngineProgress(message)
      if (message.type === 'synthesis-progress') setSynthesisProgress(message)
      if (message.type === 'result' || message.type === 'error') {
        const pending = pendingRef.current.get(message.id)
        if (!pending) return
        pendingRef.current.delete(message.id)
        setBusyCount(pendingRef.current.size)
        if (message.type === 'result') {
          setError('')
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
      setBusyCount(0)
      workerRef.current = null
    }
    workerRef.current = worker
    return worker
  }, [])

  const synthesize = useCallback((text, options = {}) => {
    if (!text?.trim()) return Promise.reject(new Error('Enter Japanese text to synthesize.'))
    setError('')
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
    return new Promise((resolve, reject) => {
      pendingRef.current.set(id, { resolve, reject })
      worker.postMessage({ type: 'synthesize', id, text, options })
    })
  }, [activeModelId, ensureWorker, magpieStatus?.modelInstalled, magpieVoice, modelStatus?.installed, qwenStatus?.modelInstalled, qwenVoice])

  const playText = useCallback(async (text, options = {}) => {
    const result = await synthesize(text, options)
    if (activeAudioRef.current) {
      activeAudioRef.current.audio.pause()
      activeAudioRef.current.audio.currentTime = 0
      URL.revokeObjectURL(activeAudioRef.current.url)
      activeAudioRef.current = null
    }
    const url = URL.createObjectURL(new Blob([result.audioBuffer], { type: 'audio/wav' }))
    const audio = new Audio(url)
    activeAudioRef.current = { audio, url }
    audio.addEventListener('ended', () => {
      if (activeAudioRef.current?.audio === audio) activeAudioRef.current = null
      URL.revokeObjectURL(url)
    }, { once: true })
    try {
      await audio.play()
      return result
    } catch (playFailure) {
      URL.revokeObjectURL(url)
      activeAudioRef.current = null
      setError(playFailure?.message || 'Could not play the generated speech on this device.')
      throw playFailure
    }
  }, [synthesize])

  const clearError = useCallback(() => setError(''), [])

  return {
    modelStatus,
    magpieStatus,
    qwenStatus,
    statusError,
    magpieStatusError,
    qwenStatusError,
    refreshModelStatus,
    downloadProgress,
    downloading,
    downloadError,
    downloadModel,
    magpieProgress,
    magpieDownloading,
    magpieDownloadError,
    downloadMagpieModel,
    magpieVoice,
    setMagpieVoice,
    qwenProgress,
    qwenDownloading,
    qwenDownloadError,
    downloadQwenModel,
    qwenVoice,
    setQwenVoice,
    activeModelId,
    setActiveModelId,
    backend,
    engineProgress,
    synthesisProgress,
    busy: busyCount > 0,
    error,
    clearError,
    synthesize,
    playText
  }
}
