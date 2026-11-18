import {
  loadTextToSpeech,
  loadVoiceStyle,
  releaseTextToSpeech,
  setOrtRuntime,
  writeWavFile
} from './supertonic-web-helper.js'
import { isSupertonicVoice } from './supertonicVoices.js'

const MODEL_BASE_URL = 'kanafish-cache://supertonic-3'
const ONNX_BASE_URL = `${MODEL_BASE_URL}/onnx`
const TOTAL_STEPS = 8
let engine = null
let activeVoiceId = ''
let activeVoiceStyle = null
const queue = []
let processing = false

function post(data) {
  self.postMessage(data)
}

async function loadWithRuntime(importRuntime, provider, requestId) {
  const runtime = await importRuntime()
  if (provider === 'wasm' && runtime.env?.wasm) {
    const cores = Number(self.navigator?.hardwareConcurrency || 1)
    runtime.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, cores)) : 1
  }
  setOrtRuntime(runtime)
  const loaded = await loadTextToSpeech(ONNX_BASE_URL, {
    executionProviders: [provider],
    graphOptimizationLevel: 'all'
  }, (name, current, total) => post({ type: 'load-progress', id: requestId, name, current, total }))
  try {
    engine = { ...loaded, backend: provider === 'webgpu' ? 'WebGPU' : 'WebAssembly (CPU)' }
    post({ type: 'engine', backend: engine.backend })
    return engine
  } catch (error) {
    await releaseTextToSpeech(loaded.textToSpeech)
    throw error
  }
}

async function getVoiceStyle(voiceId) {
  if (activeVoiceId === voiceId && activeVoiceStyle) return activeVoiceStyle
  const style = await loadVoiceStyle([`${MODEL_BASE_URL}/voice_styles/${voiceId}.json`])
  activeVoiceId = voiceId
  activeVoiceStyle = style
  return style
}

async function getEngine(requestId) {
  if (engine) return engine
  let webGpuError
  if (self.navigator?.gpu) {
    try {
      const adapter = await self.navigator.gpu.requestAdapter()
      if (!adapter) throw new Error('No compatible WebGPU adapter was found')
      return await loadWithRuntime(() => import('onnxruntime-web/webgpu'), 'webgpu', requestId)
    } catch (error) {
      webGpuError = error
    }
  } else {
    webGpuError = new Error('WebGPU is unavailable in this runtime')
  }
  try {
    return await loadWithRuntime(() => import('onnxruntime-web/wasm'), 'wasm', requestId)
  } catch (error) {
    if (webGpuError) {
      throw new Error(
        `ONNX Runtime could not initialize either backend. WebGPU: ${webGpuError.message || webGpuError}; WASM CPU fallback: ${error?.message || error}. If either error mentions a missing module or WASM asset, repair or reinstall Kanafish so its bundled ONNX Runtime files are restored.`,
        { cause: error }
      )
    }
    throw error
  }
}

async function synthesize(request) {
  const { id, text, options = {} } = request
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize')
  const speed = Math.max(0.7, Math.min(1.3, Number.isFinite(options.speed) ? options.speed : 1.05))
  const voiceId = isSupertonicVoice(options.voice) ? options.voice : 'M1'
  const ttsEngine = await getEngine(id)
  const style = await getVoiceStyle(voiceId)
  const startedAt = performance.now()
  const { wav, duration } = await ttsEngine.textToSpeech.call(
    text.trim(), 'ja', style, TOTAL_STEPS, speed, 0.3,
    (step, total) => post({ type: 'synthesis-progress', id, step, total })
  )
  const generationSeconds = (performance.now() - startedAt) / 1000
  const audioSeconds = Number(duration[0]) || wav.length / ttsEngine.textToSpeech.sampleRate
  const audioBuffer = writeWavFile(wav, ttsEngine.textToSpeech.sampleRate)
  post({
    type: 'result',
    id,
    audioBuffer,
    backend: ttsEngine.backend,
    voiceId,
    sampleRate: ttsEngine.textToSpeech.sampleRate,
    audioSeconds,
    generationSeconds,
    realTimeFactor: audioSeconds > 0 ? generationSeconds / audioSeconds : null,
    speed,
    totalSteps: TOTAL_STEPS
  }, [audioBuffer])
}

async function warm(request) {
  const { id, options = {} } = request
  const voiceId = isSupertonicVoice(options.voice) ? options.voice : 'M1'
  const ttsEngine = await getEngine(id)
  await getVoiceStyle(voiceId)
  post({ type: 'warmed', id, backend: ttsEngine.backend, voiceId })
}

async function drainQueue() {
  if (processing) return
  processing = true
  try {
    while (queue.length) {
      const request = queue.shift()
      try {
        if (request.type === 'warm') await warm(request)
        else await synthesize(request)
      } catch (error) {
        post({ type: 'error', id: request.id, error: error?.message || String(error) })
      }
    }
  } finally {
    processing = false
  }
}

self.addEventListener('message', (event) => {
  if (!['synthesize', 'warm'].includes(event.data?.type)) return
  queue.push(event.data)
  void drainQueue()
})
