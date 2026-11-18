import { useCallback, useEffect, useRef, useState } from 'react'
import { ASR_MAX_RECORD_SECONDS, ASR_SAMPLE_RATE, createPcm16FrameAccumulator, downmixToMono, encodeWav16, peakLevel, resampleLinear, trimToSeconds } from './audio.js'
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

const PCM_WORKLET_SOURCE = `class KanafishAsrCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.port.onmessage = (event) => { if (event.data === 'kanafish-flush') this.port.postMessage('kanafish-flushed') }
  }
  process(inputs, outputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(channel.slice())
    for (const output of outputs[0] || []) output.fill(0)
    return true
  }
}
registerProcessor('kanafish-asr-capture', KanafishAsrCapture)`

const MAX_PENDING_LIVE_PCM_BYTES = 512 * 1024

function enqueueLiveFrame(session, pcm) {
  if (session.streamError) return
  if (session.sendQueueBytes + pcm.byteLength > MAX_PENDING_LIVE_PCM_BYTES) {
    session.streamError = new Error('Live recognition is falling behind; switching to buffered local recognition.')
    return
  }
  session.sendQueueBytes += pcm.byteLength
  session.sendChain = session.sendChain
    .then(() => session.streamError ? undefined : window.kanafish.sendAsrStreamFrame({ sessionId: session.streamSessionId, pcm }))
    .catch((failure) => { session.streamError = failure })
    .finally(() => { session.sendQueueBytes -= pcm.byteLength })
}

async function createAudioWorkletCapture(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass || typeof AudioWorkletNode !== 'function') throw new Error('This audio system cannot stream microphone samples to local recognition.')
  let context
  try { context = new AudioContextClass({ sampleRate: ASR_SAMPLE_RATE, latencyHint: 'interactive' }) } catch { context = new AudioContextClass({ latencyHint: 'interactive' }) }
  try {
    if (!context.audioWorklet?.addModule) throw new Error('AudioWorklet is not available; using buffered recognition instead.')
    const sourceUrl = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'text/javascript' }))
    try { await context.audioWorklet.addModule(sourceUrl) } finally { URL.revokeObjectURL(sourceUrl) }
    const source = context.createMediaStreamSource(stream)
    const processor = new AudioWorkletNode(context, 'kanafish-asr-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' })
    const silentGain = context.createGain()
    silentGain.gain.value = 0
    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(context.destination)
    return { context, source, processor, silentGain, sampleRate: context.sampleRate }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}

export function useAsr() {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [progress, setProgress] = useState(null)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [vadDownloading, setVadDownloading] = useState(false)
  const [vadDownloadError, setVadDownloadError] = useState('')
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [warming, setWarming] = useState(false)
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
    const stopStreamEvents = window.kanafish?.onAsrStreamEvent?.((update) => {
      const current = recognitionRef.current || recorderRef.current
      if (!current || current.streamSessionId !== update?.sessionId) return
      if (update.kind === 'error') current.streamError = new Error(update.message || 'Live recognition failed.')
      if (mountedRef.current && typeof update.text === 'string') setLiveText(update.text)
    })
    void refreshStatus()
    return () => {
      mountedRef.current = false
      stopProgress?.()
      stopStreamEvents?.()
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
        if (current.live) {
          current.processor.port.onmessage = null
          void current.context.close().catch(() => {})
        }
        current.stream.getTracks().forEach((track) => track.stop())
      }
      if (recognitionRef.current) recognitionRef.current.cancelled = true
      if (recognitionRef.current?.streamSessionId) {
        if (recognitionRef.current.live && recognitionRef.current !== current) {
          recognitionRef.current.processor.port.onmessage = null
          void recognitionRef.current.context.close().catch(() => {})
        }
        try { void window.kanafish?.cancelAsrStream?.({ sessionId: recognitionRef.current.streamSessionId }).catch(() => {}) } catch {}
      }
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

  const downloadVadModel = useCallback(async () => {
    setVadDownloading(true)
    setVadDownloadError('')
    setProgress({ kind: 'vad', state: 'downloading', downloadedBytes: status?.vadDownloadedBytes || 0, totalBytes: status?.vadTotalBytes || 0, message: 'Preparing the small VAD model download…' })
    try {
      const next = await window.kanafish.downloadAsrVadModel()
      setStatus(next)
      return next
    } catch (failure) {
      setVadDownloadError(failure?.message || 'Could not download the VAD model.')
      await refreshStatus()
      throw failure
    } finally {
      setVadDownloading(false)
    }
  }, [refreshStatus, status?.vadDownloadedBytes, status?.vadTotalBytes])

  const cancelSetup = useCallback(() => window.kanafish?.cancelAsrRuntimeSetup?.(), [])
  const cancelDownload = useCallback(() => window.kanafish?.cancelAsrModelDownload?.(), [])
  const cancelVadDownload = useCallback(() => window.kanafish?.cancelAsrVadDownload?.(), [])

  const warmWorker = useCallback(async () => {
    if (!window.kanafish?.warmAsr) throw new Error('Fast local recognition is available in the Kanafish desktop app.')
    setError('')
    setWarming(true)
    setProgress({ kind: 'worker', state: 'loading', message: 'Warming the cached Japanese speech model…' })
    try {
      return await window.kanafish.warmAsr()
    } catch (failure) {
      if (mountedRef.current) setError(failure?.message || 'Could not warm local speech recognition.')
      throw failure
    } finally {
      if (mountedRef.current) setWarming(false)
    }
  }, [])

  const removeModel = useCallback(async () => {
    const next = await window.kanafish.removeAsrModel()
    setStatus(next)
    setProgress(null)
    return next
  }, [])

  const removeVadModel = useCallback(async () => {
    const next = await window.kanafish.removeAsrVadModel()
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

  const endLiveRecording = useCallback(async (session, discard = false) => {
    if (session.ending) return session.ending
    session.ending = (async () => {
      session.discard ||= discard
      clearInterval(session.ticker)
      clearTimeout(session.limit)
      session.stream.getTracks().forEach((track) => track.stop())
      await new Promise((resolvePromise) => {
        let done = false
        const finish = () => { if (!done) { done = true; clearTimeout(timer); resolvePromise() } }
        session.flushResolve = finish
        const timer = setTimeout(finish, 500)
        try { session.processor.port.postMessage('kanafish-flush') } catch { finish() }
      })
      session.captureDone = true
      session.processor.port.onmessage = null
      try { session.source.disconnect() } catch {}
      try { session.processor.disconnect() } catch {}
      try { session.silentGain.disconnect() } catch {}
      await session.context.close().catch(() => {})
      if (recorderRef.current === session) recorderRef.current = null
      if (mountedRef.current) {
        setRecording(false)
        setStreaming(false)
      }
      if (session.discard || session.cancelled || !mountedRef.current) {
        if (session.streamSessionId) await window.kanafish?.cancelAsrStream?.({ sessionId: session.streamSessionId }).catch(() => {})
        if (recognitionRef.current === session) recognitionRef.current = null
        return null
      }
      if (mountedRef.current) setTranscribing(true)
      try {
        const tail = session.accumulator.flush()
        if (tail?.length) enqueueLiveFrame(session, tail)
        await session.sendChain
        let liveResult = null
        if (!session.streamError) {
          try { liveResult = await window.kanafish.finishAsrStream({ sessionId: session.streamSessionId }) } catch (failure) { session.streamError = failure }
        } else {
          await window.kanafish?.cancelAsrStream?.({ sessionId: session.streamSessionId }).catch(() => {})
        }
        if (session.cancelled || !mountedRef.current) return null
        if (liveResult?.final && liveResult.text?.trim()) {
          setResult(liveResult)
          setLiveText(liveResult.text)
          return liveResult
        }
        const length = session.pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const samples = new Float32Array(length)
        let offset = 0
        for (const chunk of session.pcmChunks) { samples.set(chunk, offset); offset += chunk.length }
        if (samples.length < session.sampleRate * 0.25) throw new Error('The recording was too short. Hold the button a little longer.')
        if (peakLevel(samples) < 0.003) throw new Error('No sound was recorded. Check the microphone input and macOS microphone permission.')
        return await transcribeWav(encodeWav16(trimToSeconds(samples, session.sampleRate), session.sampleRate))
      } catch (failure) {
        if (mountedRef.current && !session.cancelled && !isCancellation(failure)) setError((current) => current || failure?.message || 'Could not process the recording.')
        return null
      } finally {
        if (recognitionRef.current === session) recognitionRef.current = null
        if (mountedRef.current) {
          setTranscribing(false)
          setCancelling(false)
        }
      }
    })()
    return session.ending
  }, [transcribeWav])

  const startRecording = useCallback(async () => {
    if (!mountedRef.current || recorderRef.current || startingRef.current || transcribing) return
    setError('')
    setResult(null)
    setLiveText('')
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
      const startedAt = performance.now()
      let capture = null
      let streamStart = null
      if (status?.vadInstalled && window.kanafish?.startAsrStream && window.kanafish?.sendAsrStreamFrame) {
        try {
          capture = await createAudioWorkletCapture(stream)
          streamStart = await window.kanafish.startAsrStream({ sampleRate: capture.sampleRate })
        } catch {
          await capture?.context.close().catch(() => {})
          capture = null
          streamStart = null
        }
      }
      if (request.cancelled || !mountedRef.current) {
        if (streamStart?.sessionId) await window.kanafish?.cancelAsrStream?.({ sessionId: streamStart.sessionId }).catch(() => {})
        await capture?.context.close().catch(() => {})
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      if (capture && streamStart?.sessionId) {
        const session = {
          live: true,
          stream,
          streamSessionId: streamStart.sessionId,
          sampleRate: capture.sampleRate,
          context: capture.context,
          source: capture.source,
          processor: capture.processor,
          silentGain: capture.silentGain,
          accumulator: createPcm16FrameAccumulator(Math.max(1, Math.round(capture.sampleRate / 10))),
          pcmChunks: [],
          sendChain: Promise.resolve(),
          sendQueueBytes: 0,
          streamError: null,
          discard: false,
          cancelled: false,
          ticker: null,
          limit: null
        }
        session.processor.port.onmessage = (event) => {
          if (event.data === 'kanafish-flushed') { session.flushResolve?.(); return }
          if (session.cancelled || session.captureDone) return
          const samples = Float32Array.from(event.data || [])
          if (!samples.length) return
          session.pcmChunks.push(samples)
          for (const pcm of session.accumulator.push(samples)) enqueueLiveFrame(session, pcm)
        }
        recorderRef.current = session
        recognitionRef.current = session
        setStreaming(true)
        setProgress({ kind: 'stream', state: 'listening', message: 'Listening locally; partial text may change.' })
        setRecordSeconds(0)
        session.ticker = setInterval(() => { if (mountedRef.current && recorderRef.current === session) setRecordSeconds((performance.now() - startedAt) / 1000) }, 200)
        session.limit = setTimeout(() => { void endLiveRecording(session) }, ASR_MAX_RECORD_SECONDS * 1000)
        await session.context.resume()
        if (request.cancelled || session.cancelled || !mountedRef.current) {
          await endLiveRecording(session, true)
          return
        }
      } else {
        const recorder = new MediaRecorder(stream)
        const chunks = []
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
        setRecordSeconds(0)
        session.ticker = setInterval(() => { if (mountedRef.current && recorderRef.current === session) setRecordSeconds((performance.now() - startedAt) / 1000) }, 200)
        session.limit = setTimeout(() => { try { recorder.state !== 'inactive' && recorder.stop() } catch {} }, ASR_MAX_RECORD_SECONDS * 1000)
      }
      setRecording(true)
    } catch (failure) {
      const failedSession = recognitionRef.current?.stream === stream ? recognitionRef.current : null
      if (failedSession?.live) {
        failedSession.cancelled = true
        await endLiveRecording(failedSession, true)
      } else {
        clearInterval(failedSession?.ticker)
        clearTimeout(failedSession?.limit)
        if (failedSession?.streamSessionId) await window.kanafish?.cancelAsrStream?.({ sessionId: failedSession.streamSessionId }).catch(() => {})
        if (failedSession?.context) await failedSession.context.close().catch(() => {})
        stream?.getTracks().forEach((track) => track.stop())
        if (recorderRef.current?.stream === stream) recorderRef.current = null
        if (recognitionRef.current?.stream === stream) recognitionRef.current = null
      }
      if (mountedRef.current && !request.cancelled) {
        setRecording(false)
        setError(failure?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access for Kanafish and try again.' : failure?.message || 'Could not start the microphone.')
      }
    } finally {
      if (startingRef.current === request) startingRef.current = null
      if (mountedRef.current) setStarting(false)
    }
  }, [endLiveRecording, status?.vadInstalled, transcribeWav, transcribing])

  const stopRecording = useCallback(() => {
    const session = recorderRef.current
    if (!session) return
    if (session.live) { void endLiveRecording(session); return }
    try { session.recorder.state !== 'inactive' && session.recorder.stop() } catch {}
  }, [endLiveRecording])

  const cancelRecording = useCallback(() => {
    const session = recorderRef.current
    if (!session) return
    session.discard = true
    session.cancelled = true
    if (session.live) { void endLiveRecording(session, true); return }
    try { session.recorder.state !== 'inactive' && session.recorder.stop() } catch {}
  }, [endLiveRecording])

  const cancelTranscription = useCallback(async () => {
    const session = recognitionRef.current
    if (session) session.cancelled = true
    if (mountedRef.current) setCancelling(true)
    try {
      if (session?.streamSessionId) await window.kanafish?.cancelAsrStream?.({ sessionId: session.streamSessionId })
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
    vadDownloading,
    vadDownloadError,
    starting,
    recording,
    streaming,
    liveText,
    recordSeconds,
    transcribing,
    warming,
    cancelling,
    result,
    error,
    refreshStatus,
    setupRuntime,
    cancelSetup,
    downloadModel,
    cancelDownload,
    downloadVadModel,
    cancelVadDownload,
    warmWorker,
    removeModel,
    removeVadModel,
    removeRuntime,
    startRecording,
    stopRecording,
    cancelRecording,
    cancelTranscription,
    clearResult: () => { setResult(null); setLiveText(''); setError('') }
  }
}
