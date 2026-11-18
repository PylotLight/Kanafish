import { useCallback, useEffect, useRef, useState } from 'react'
import { ASR_MAX_RECORD_SECONDS, ASR_SAMPLE_RATE, downmixToMono, encodeWav16, peakLevel, resampleLinear, trimToSeconds } from './audio.js'
import { getAsrReadiness } from './readiness.js'

async function toSixteenKilohertzMono(blob) {
  const encoded = await blob.arrayBuffer()
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  const context = new AudioContextClass()
  let decoded
  try {
    decoded = await context.decodeAudioData(encoded)
  } finally {
    void context.close().catch(() => {})
  }
  const seconds = Math.min(decoded.duration, ASR_MAX_RECORD_SECONDS)
  try {
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * ASR_SAMPLE_RATE)), ASR_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return Float32Array.from(rendered.getChannelData(0))
  } catch {
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
    return resampleLinear(trimToSeconds(downmixToMono(channels), decoded.sampleRate), decoded.sampleRate, ASR_SAMPLE_RATE)
  }
}

function isCancellation(error) {
  return /cancelled|canceled/i.test(error?.message || '')
}

export function useAsr() {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [progress, setProgress] = useState(null)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const startingRef = useRef(null)
  const recognitionRef = useRef(null)
  const mountedRef = useRef(false)

  const available = typeof window !== 'undefined' && Boolean(window.kanafish?.getAsrStatus)

  const refreshStatus = useCallback(async () => {
    if (!window.kanafish?.getAsrStatus) {
      setStatusError('Speech recognition is available in the Kanafish desktop app.')
      return null
    }
    try {
      const next = await window.kanafish.getAsrStatus()
      if (mountedRef.current) {
        setStatus(next)
        setStatusError('')
      }
      return next
    } catch (failure) {
      if (mountedRef.current) setStatusError(failure?.message || 'Could not inspect speech recognition.')
      return null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const stopProgress = window.kanafish?.onAsrProgress?.((next) => { if (mountedRef.current) setProgress(next) })
    void refreshStatus()
    return () => {
      mountedRef.current = false
      stopProgress?.()
      const startingRequest = startingRef.current
      startingRef.current = null
      if (startingRequest) {
        startingRequest.cancelled = true
        startingRequest.stream?.getTracks().forEach((track) => track.stop())
      }
      const current = recorderRef.current
      recorderRef.current = null
      if (current) {
        current.discard = true
        current.cancelled = true
        clearInterval(current.ticker)
        clearTimeout(current.limit)
        try { current.recorder.state !== 'inactive' && current.recorder.stop() } catch {}
        current.stream.getTracks().forEach((track) => track.stop())
      }
      if (recognitionRef.current) recognitionRef.current.cancelled = true
      recognitionRef.current = null
      try { void window.kanafish?.cancelAsrTranscription?.().catch(() => {}) } catch {}
    }
  }, [refreshStatus])

  const setupRuntime = useCallback(async () => {
    setSettingUp(true)
    setSetupError('')
    setProgress({ kind: 'runtime', state: 'setup', message: 'Preparing the pinned speech.cpp runtime…' })
    try {
      const next = await window.kanafish.setupAsrRuntime()
      setStatus(next)
      return next
    } catch (failure) {
      setSetupError(failure?.message || 'Could not install speech.cpp.')
      await refreshStatus()
      throw failure
    } finally {
      setSettingUp(false)
    }
  }, [refreshStatus])

  const downloadModel = useCallback(async () => {
    setDownloading(true)
    setDownloadError('')
    setProgress({ kind: 'model', state: 'downloading', downloadedBytes: status?.downloadedBytes || 0, totalBytes: status?.totalBytes || 0, message: 'Preparing the Haas model download…' })
    try {
      const next = await window.kanafish.downloadAsrModel()
      setStatus(next)
      return next
    } catch (failure) {
      setDownloadError(failure?.message || 'Could not download Haas-ja-v1.0.')
      await refreshStatus()
      throw failure
    } finally {
      setDownloading(false)
    }
  }, [refreshStatus, status?.downloadedBytes, status?.totalBytes])

  const cancelSetup = useCallback(() => window.kanafish?.cancelAsrRuntimeSetup?.(), [])
  const cancelDownload = useCallback(() => window.kanafish?.cancelAsrModelDownload?.(), [])

  const removeModel = useCallback(async () => {
    const next = await window.kanafish.removeAsrModel()
    setStatus(next)
    setProgress(null)
    return next
  }, [])

  const removeRuntime = useCallback(async () => {
    const next = await window.kanafish.removeAsrRuntime()
    setStatus(next)
    setProgress(null)
    return next
  }, [])

  const transcribeWav = useCallback(async (wavBytes) => {
    setTranscribing(true)
    setCancelling(false)
    setError('')
    try {
      const next = await window.kanafish.transcribeAsr({ audio: wavBytes })
      if (mountedRef.current && !recognitionRef.current?.cancelled) setResult(next)
      return next
    } catch (failure) {
      if (mountedRef.current && !isCancellation(failure)) setError(failure?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Speech recognition failed.')
      if (!isCancellation(failure)) throw failure
      return null
    } finally {
      if (mountedRef.current) {
        setTranscribing(false)
        setCancelling(false)
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (!mountedRef.current || recorderRef.current || startingRef.current || transcribing) return
    setError('')
    setResult(null)
    const request = { cancelled: false, stream: null }
    startingRef.current = request
    setStarting(true)
    let stream = null
    try {
      const access = await window.kanafish?.requestMicrophoneAccess?.()
      if (request.cancelled || !mountedRef.current) return
      if (access && access.granted === false) throw new Error('Microphone access is off for Kanafish. Allow it in System Settings › Privacy & Security › Microphone.')
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      request.stream = stream
      if (request.cancelled || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const recorder = new MediaRecorder(stream)
      const chunks = []
      const startedAt = performance.now()
      const session = { recorder, stream, chunks, discard: false, cancelled: false, ticker: null, limit: null }
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data) }
      recorder.onstop = async () => {
        clearInterval(session.ticker)
        clearTimeout(session.limit)
        stream.getTracks().forEach((track) => track.stop())
        if (recorderRef.current === session) recorderRef.current = null
        if (!mountedRef.current) {
          if (recognitionRef.current === session) recognitionRef.current = null
          return
        }
        setRecording(false)
        if (session.discard || !chunks.length) {
          if (recognitionRef.current === session) recognitionRef.current = null
          return
        }
        setTranscribing(true)
        try {
          const samples = trimToSeconds(await toSixteenKilohertzMono(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })), ASR_SAMPLE_RATE)
          if (session.cancelled || !mountedRef.current) return
          if (samples.length < ASR_SAMPLE_RATE * 0.25) throw new Error('The recording was too short. Hold the button a little longer.')
          if (peakLevel(samples) < 0.003) throw new Error('No sound was recorded. Check the microphone input and macOS microphone permission.')
          await transcribeWav(encodeWav16(samples, ASR_SAMPLE_RATE))
        } catch (failure) {
          if (mountedRef.current && !session.cancelled && !isCancellation(failure)) setError((current) => current || failure?.message || 'Could not process the recording.')
        } finally {
          if (recognitionRef.current === session) recognitionRef.current = null
          if (mountedRef.current) {
            setTranscribing(false)
            setCancelling(false)
          }
        }
      }
      recorderRef.current = session
      recognitionRef.current = session
      recorder.start(250)
      if (request.cancelled || !mountedRef.current) {
        session.discard = true
        session.cancelled = true
        try { recorder.state !== 'inactive' && recorder.stop() } catch {}
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      setRecording(true)
      setRecordSeconds(0)
      session.ticker = setInterval(() => { if (mountedRef.current && recorderRef.current === session) setRecordSeconds((performance.now() - startedAt) / 1000) }, 200)
      session.limit = setTimeout(() => { try { recorder.state !== 'inactive' && recorder.stop() } catch {} }, ASR_MAX_RECORD_SECONDS * 1000)
    } catch (failure) {
      stream?.getTracks().forEach((track) => track.stop())
      if (recorderRef.current?.stream === stream) recorderRef.current = null
      if (recognitionRef.current?.stream === stream) recognitionRef.current = null
      if (mountedRef.current && !request.cancelled) {
        setRecording(false)
        setError(failure?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access for Kanafish and try again.' : failure?.message || 'Could not start the microphone.')
      }
    } finally {
      if (startingRef.current === request) startingRef.current = null
      if (mountedRef.current) setStarting(false)
    }
  }, [transcribeWav, transcribing])

  const stopRecording = useCallback(() => {
    const session = recorderRef.current
    if (!session) return
    try { session.recorder.state !== 'inactive' && session.recorder.stop() } catch {}
  }, [])

  const cancelRecording = useCallback(() => {
    const session = recorderRef.current
    if (!session) return
    session.discard = true
    session.cancelled = true
    try { session.recorder.state !== 'inactive' && session.recorder.stop() } catch {}
  }, [])

  const cancelTranscription = useCallback(async () => {
    const session = recognitionRef.current
    if (session) session.cancelled = true
    if (mountedRef.current) setCancelling(true)
    try {
      return await window.kanafish?.cancelAsrTranscription?.()
    } catch (failure) {
      if (mountedRef.current) {
        setCancelling(false)
        setError(failure?.message || 'Could not cancel speech recognition.')
      }
      return { cancelled: false }
    }
  }, [])

  return {
    available,
    status,
    statusError,
    readiness: getAsrReadiness(status),
    progress,
    settingUp,
    setupError,
    downloading,
    downloadError,
    starting,
    recording,
    recordSeconds,
    transcribing,
    cancelling,
    result,
    error,
    refreshStatus,
    setupRuntime,
    cancelSetup,
    downloadModel,
    cancelDownload,
    removeModel,
    removeRuntime,
    startRecording,
    stopRecording,
    cancelRecording,
    cancelTranscription,
    clearResult: () => { setResult(null); setError('') }
  }
}
