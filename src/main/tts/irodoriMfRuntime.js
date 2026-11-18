import * as ort from 'onnxruntime-web'
import { mkdir, rm, statfs } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { getHfHubCacheRoot, getModelSnapshotDirectory } from './modelRegistry.js'
import { downloadTtsModel, getTtsModelStatus } from './modelStore.js'
import { createIrodoriMfInference } from './irodoriMfInference.js'

export const IRODORI_MF_ONNX_MODEL_ID = 'irodori-v4.1-small-mf'
export const IRODORI_MF_DISK_RESERVE_BYTES = 128 * 1024 * 1024
export const IRODORI_MF_MAX_TEXT_CHARS = 500

export function getIrodoriMfRequiredFreeBytes(status) {
  const pendingBytes = status.files.reduce((total, file) => total + (file.downloaded ? 0 : file.size), 0)
  return pendingBytes + IRODORI_MF_DISK_RESERVE_BYTES
}

export function assertIrodoriMfFreeSpace(status, availableBytes) {
  const requiredBytes = getIrodoriMfRequiredFreeBytes(status)
  const requiredGiB = (requiredBytes / (1024 ** 3)).toFixed(2)
  const availableGiB = Number.isFinite(availableBytes) ? (availableBytes / (1024 ** 3)).toFixed(2) : 'unknown'
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
    throw new Error(`Not enough free disk space to download Irodori v4.1-Small-MF. Need at least ${requiredGiB} GiB (including a 128 MiB temporary-file reserve), but ${availableGiB} GiB is available. Free space and retry.`)
  }
}

export function validateIrodoriMfText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize.')
  const normalized = text.trim()
  const length = Array.from(normalized).length
  if (length > IRODORI_MF_MAX_TEXT_CHARS) throw new Error(`Irodori v4.1-Small-MF accepts up to ${IRODORI_MF_MAX_TEXT_CHARS} characters per request.`)
  return normalized
}

export function createIrodoriMfOnnxRuntime({
  env = process.env,
  cacheRoot = getHfHubCacheRoot(env),
  onProgress = () => {},
  inferenceFactory = createIrodoriMfInference,
  getModelStatus = getTtsModelStatus,
  downloadModelAssets = downloadTtsModel,
  makeDirectory = mkdir,
  getFilesystemStats = statfs,
  removeTree = rm
} = {}) {
  let inferencePromise = null
  let downloadPromise = null
  let activeSynthesis = null

  async function getStatus() {
    const status = await getModelStatus(IRODORI_MF_ONNX_MODEL_ID, cacheRoot)
    return { ...status, modelInstalled: status.installed, runtimeReady: true, pythonRequired: false }
  }

  async function downloadModel() {
    if (downloadPromise) return downloadPromise
    const task = (async () => {
      const status = await getModelStatus(IRODORI_MF_ONNX_MODEL_ID, cacheRoot)
      if (!status.installed) {
        await makeDirectory(cacheRoot, { recursive: true })
        const filesystem = await getFilesystemStats(cacheRoot)
        assertIrodoriMfFreeSpace(status, filesystem.bavail * filesystem.bsize)
      }
      return downloadModelAssets(IRODORI_MF_ONNX_MODEL_ID, { cacheRoot, onProgress })
    })()
    downloadPromise = task.finally(() => { downloadPromise = null })
    return downloadPromise
  }

  async function loadInference() {
    if (!inferencePromise) {
      inferencePromise = Promise.resolve(inferenceFactory({
        ort,
        modelsDir: getModelSnapshotDirectory(IRODORI_MF_ONNX_MODEL_ID, cacheRoot),
        onProgress
      })).catch((error) => {
        inferencePromise = null
        throw error
      })
    }
    return inferencePromise
  }

  async function synthesize(text) {
    const requestText = validateIrodoriMfText(text)
    if (activeSynthesis) throw new Error('Irodori MF synthesis is already running. Wait for it to finish before starting another request.')
    let finishSynthesis
    activeSynthesis = new Promise((resolve) => { finishSynthesis = resolve })
    try {
      const status = await getStatus()
      if (!status.installed) throw new Error('Download the Irodori v4.1-Small-MF ONNX pack before generating speech.')
      const runtime = await loadInference()
      const startedAt = performance.now()
      const result = await runtime.synthesize(requestText)
      const generationSeconds = (performance.now() - startedAt) / 1000
      const audioSeconds = result.durationSeconds
      return {
        audioBuffer: Uint8Array.from(result.audio),
        audioSeconds,
        sampleRate: result.sampleRate,
        inferenceMetrics: result.metrics,
        backend: 'ONNX Runtime WebAssembly (CPU) · Irodori v4.1-Small-MF',
        generationSeconds,
        realTimeFactor: Number.isFinite(audioSeconds) && audioSeconds > 0 ? generationSeconds / audioSeconds : null
      }
    } finally {
      activeSynthesis = null
      finishSynthesis()
    }
  }

  async function removeModel() {
    if (activeSynthesis) throw new Error('Wait for Irodori MF synthesis to finish before removing its model files.')
    if (downloadPromise) throw new Error('Wait for the Irodori MF model download to finish before removing its files.')
    await stop()
    await removeTree(getModelSnapshotDirectory(IRODORI_MF_ONNX_MODEL_ID, cacheRoot), { recursive: true, force: true })
    return getStatus()
  }

  async function stop() {
    if (activeSynthesis) await activeSynthesis
    const runtime = await inferencePromise?.catch(() => null)
    if (runtime?.dispose) await runtime.dispose()
    inferencePromise = null
  }

  return { getStatus, downloadModel, synthesize, removeModel, stop }
}
