import {
  loadTextToSpeech,
  loadVoiceStyle,
  releaseTextToSpeech,
  setOrtRuntime,
  writeWavFile
} from './supertonic-web-helper.js'

const MODEL_BASE_URL = 'kanafish-cache://supertonic-3'
const ONNX_BASE_URL = `${MODEL_BASE_URL}/onnx`
const VOICE_STYLE_URL = `${MODEL_BASE_URL}/voice_styles/M1.json`
const TOTAL_STEPS = 8
let engine = null
const queue = []
let processing = false

function post(data) {
  self.postMessage(data)
}

async function loadWithRuntime(runtimeName, provider, requestId) {
  const runtime = await import(runtimeName)
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
    const style = await loadVoiceStyle([VOICE_STYLE_URL])
    engine = { ...loaded, style, backend: provider === 'webgpu' ? 'WebGPU' : 'WebAssembly (CPU)' }
    post({ type: 'engine', backend: engine.backend })
    return engine
  } catch (error) {
    await releaseTextToSpeech(loaded.textToSpeech)
    throw error
  }
}

async function getEngine(requestId) {
  if (engine) return engine
  let webGpuError
  if (self.navigator?.gpu) {
    try {
      const adapter = await self.navigator.gpu.requestAdapter()
      if (!adapter) throw new Error('No compatible WebGPU adapter was found')
      return await loadWithRuntime('onnxruntime-web/webgpu', 'webgpu', requestId)
    } catch (error) {
      webGpuError = error
    }
  } else {
    webGpuError = new Error('WebGPU is unavailable in this runtime')
  }
  try {
    return await loadWithRuntime('onnxruntime-web', 'wasm', requestId)
  } catch (error) {
    if (webGpuError) error.message = `WebGPU failed (${webGpuError.message}); WASM fallback failed (${error.message})`
    throw error
  }
}

async function synthesize(request) {
  const { id, text, options = {} } = request
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize')
  const speed = Math.max(0.7, Math.min(1.3, Number.isFinite(options.speed) ? options.speed : 1.05))
  const ttsEngine = await getEngine(id)
  const startedAt = performance.now()
  const { wav, duration } = await ttsEngine.textToSpeech.call(
    text.trim(), 'ja', ttsEngine.style, TOTAL_STEPS, speed, 0.3,
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
    sampleRate: ttsEngine.textToSpeech.sampleRate,
    audioSeconds,
    generationSeconds,
    realTimeFactor: audioSeconds > 0 ? generationSeconds / audioSeconds : null,
    speed,
    totalSteps: TOTAL_STEPS
  }, [audioBuffer])
}

async function drainQueue() {
  if (processing) return
  processing = true
  try {
    while (queue.length) {
      const request = queue.shift()
      try {
        await synthesize(request)
      } catch (error) {
        post({ type: 'error', id: request.id, error: error?.message || String(error) })
      }
    }
  } finally {
    processing = false
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'synthesize') return
  queue.push(event.data)
  void drainQueue()
})
