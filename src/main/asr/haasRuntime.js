import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, chmod, lstat, mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { downloadVerifiedFile } from '../tts/modelStore.js'
import { HAAS_ASR_MODEL, SPEECH_CPP_RELEASE, getHaasModelUrl, getSpeechCppAsset, getSpeechCppAssetUrl } from './haasRegistry.js'
import { readZipEntry } from './zipEntry.js'
import { buildTranscribeLines, createSpeechWorkerClient, SpeechWorkerError } from './speechWorker.js'

export const ASR_MAX_SECONDS = 60
export const ASR_MIN_SECONDS = 0.2
export const ASR_MAX_WAV_BYTES = 44 + ASR_MAX_SECONDS * 48_000 * 2 + 4096
export const ASR_IDLE_STOP_MS = 5 * 60 * 1000
export const ASR_DISK_RESERVE_BYTES = 64 * 1024 * 1024
const COMMAND_OUTPUT_LIMIT = 16_000

export function parseSpeechVersion(output = '') {
  return String(output).match(/speech\.cpp\s+v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i)?.[1] || ''
}

// Reads a RIFF/WAVE file the renderer recorded and returns its 16-bit mono PCM samples. Kanafish sends 16 kHz mono
// PCM16, but any 8–48 kHz mono PCM16 file is accepted because speech.cpp resamples recognition audio itself.
export function parsePcm16Wav(input, { maxSeconds = ASR_MAX_SECONDS, minSeconds = ASR_MIN_SECONDS } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : input instanceof Uint8Array ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : Buffer.from(input || [])
  if (bytes.length > ASR_MAX_WAV_BYTES) throw new Error(`Recordings are limited to ${maxSeconds} seconds.`)
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('The recording is not a WAV file.')
  const riffEnd = Math.min(bytes.length, bytes.readUInt32LE(4) + 8)
  let format = null
  let data = null
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const available = Math.max(0, Math.min(size, riffEnd - start))
    if (id === 'fmt ' && available >= 16) {
      format = { tag: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), bitsPerSample: bytes.readUInt16LE(start + 14) }
    }
    if (id === 'data') data = bytes.subarray(start, start + available - (available % 2))
    const next = start + size + (size & 1)
    if (!Number.isSafeInteger(next) || next <= offset) break
    offset = next
  }
  if (!format || !data) throw new Error('The WAV file is missing its format or data.')
  if (format.tag !== 1 || format.bitsPerSample !== 16 || format.channels !== 1) throw new Error('Recordings must be mono 16-bit PCM WAV.')
  if (format.sampleRate < 8_000 || format.sampleRate > 48_000) throw new Error('Recordings must be 8–48 kHz.')
  const seconds = data.length / 2 / format.sampleRate
  if (seconds > maxSeconds + 0.05) throw new Error(`Recordings are limited to ${maxSeconds} seconds.`)
  if (seconds < minSeconds) throw new Error('The recording is too short to recognize.')
  let peak = 0
  for (let offset = 0; offset < data.length; offset += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(offset)))
  return { pcm: data, sampleRate: format.sampleRate, seconds, peak }
}

export function buildWorkerArgs(modelPath, { device = '', threads = 0, warmup = true } = {}) {
  if (typeof modelPath !== 'string' || !modelPath.endsWith('.gguf')) throw new Error('speech worker needs a local .gguf model path.')
  const args = ['worker', modelPath]
  if (device) args.push('--device', String(device))
  if (Number.isInteger(threads) && threads > 0) args.push('--threads', String(threads))
  if (!warmup) args.push('--no-warmup')
  return args
}

export function speechEnvironment(env = process.env) {
  // speech.cpp never checks for updates from a worker, but keep it quiet and colourless for every command we run.
  return { ...env, SPEECH_NO_UPDATE_CHECK: '1', NO_COLOR: '1' }
}

function fileSignature(info) {
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function statOrNull(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function runCommand(executable, args, { spawnImpl, env, cwd, timeoutMs = 15_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawnImpl(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      rejectPromise(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const timer = setTimeout(() => {
      try { child.kill?.('SIGTERM') } catch {}
      finish(new Error(`speech ${args[0] || ''} timed out.`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-COMMAND_OUTPUT_LIMIT) })
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-COMMAND_OUTPUT_LIMIT) })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => finish(null, { stdout, stderr, code, signal }))
  })
}

export function createHaasAsrRuntime({
  userDataDir,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  onProgress = () => {},
  release = SPEECH_CPP_RELEASE,
  model = HAAS_ASR_MODEL,
  downloadFile = downloadVerifiedFile,
  getFilesystemStats = statfs,
  workerFactory = createSpeechWorkerClient,
  idleStopMs = ASR_IDLE_STOP_MS,
  workerOptions = {}
} = {}) {
  if (!userDataDir) throw new Error('A Kanafish user-data directory is required for speech recognition.')
  const appData = resolve(userDataDir)
  const asset = getSpeechCppAsset(platform, arch, release)
  const runtimeBase = join(appData, 'native-runtimes', 'speech.cpp')
  const installRoot = join(runtimeBase, `v${release.version}`)
  const downloadsRoot = join(runtimeBase, 'downloads')
  const modelRoot = join(appData, 'asr-models', model.id, model.revision)
  const modelPath = join(modelRoot, model.file.path)
  const modelPartPath = `${modelPath}.part`
  const binaryPath = asset ? join(installRoot, asset.executable) : ''
  const runtimeEnv = speechEnvironment(env)

  let runtimeTask = null
  let runtimeController = null
  let modelTask = null
  let modelController = null
  let worker = null
  let workerStartTask = null
  let idleTimer = null
  let activeTranscription = null
  let activeTranscriptionState = null
  let requestCounter = 0
  let lastLoadSeconds = null
  const verifiedModelSignatures = new Map()
  const inspectedRuntime = new Map()

  async function probeBinary(path) {
    const result = await runCommand(path, ['--version'], { spawnImpl, env: runtimeEnv, cwd: dirname(path) })
    const version = parseSpeechVersion(`${result.stdout}\n${result.stderr}`)
    const ready = result.code === 0 && version === release.version
    return {
      runtimeFound: true,
      runtimeReady: ready,
      runtimeVersion: version,
      runtimeError: ready ? '' : `speech ${version || '(unknown version)'} does not match the pinned speech.cpp ${release.version}${result.code ? ` (exit ${result.code})` : ''}.`
    }
  }

  async function inspectRuntime() {
    if (!asset) return { runtimeFound: false, runtimeReady: false, runtimeVersion: '', runtimePath: '', runtimeError: `speech.cpp has no pinned release for ${platform}-${arch}.` }
    try {
      const info = await statOrNull(binaryPath)
      if (!info) return { runtimeFound: false, runtimeReady: false, runtimeVersion: '', runtimePath: binaryPath, runtimeError: '' }
      if (!info.isFile() || info.isSymbolicLink()) return { runtimeFound: false, runtimeReady: false, runtimeVersion: '', runtimePath: binaryPath, runtimeError: 'The speech.cpp runtime path is not a regular file.' }
      if (platform !== 'win32') await access(binaryPath, constants.X_OK)
      const signature = fileSignature(info)
      const cached = inspectedRuntime.get(binaryPath)
      if (cached?.signature === signature) return cached.result
      const result = { ...(await probeBinary(binaryPath)), runtimePath: binaryPath }
      inspectedRuntime.set(binaryPath, { signature, result })
      return result
    } catch (error) {
      return { runtimeFound: true, runtimeReady: false, runtimeVersion: '', runtimePath: binaryPath, runtimeError: error?.message || 'Could not run the app-managed speech.cpp runtime.' }
    }
  }

  async function modelMatches() {
    try {
      const info = await lstat(modelPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== model.file.size) return false
      const signature = fileSignature(info)
      if (verifiedModelSignatures.get(modelPath) === signature) return true
      if ((await hashFile(modelPath)) !== model.file.sha256) {
        verifiedModelSignatures.delete(modelPath)
        return false
      }
      verifiedModelSignatures.set(modelPath, signature)
      return true
    } catch {
      return false
    }
  }

  async function getStatus() {
    const [runtime, modelInstalled, partial] = await Promise.all([inspectRuntime(), modelMatches(), statOrNull(modelPartPath).catch(() => null)])
    const partialBytes = partial?.isFile() ? Math.min(partial.size, model.file.size) : 0
    return {
      id: model.id,
      name: model.name,
      language: model.language,
      modelRepo: model.repo,
      modelRevision: model.revision,
      upstreamRepo: model.upstreamRepo,
      modelFile: model.file.path,
      weightsLicense: model.license,
      runtimeName: release.name,
      runtimeRepo: release.repo,
      runtimeLicense: release.license,
      pinnedRuntimeVersion: release.version,
      runtimeBackend: asset?.backend || '',
      runtimeAssetBytes: asset?.size || 0,
      platformSupported: Boolean(asset),
      canSetupRuntime: Boolean(asset),
      totalBytes: model.file.size,
      downloadedBytes: modelInstalled ? model.file.size : partialBytes,
      modelInstalled,
      canDownload: Boolean(asset),
      cachePath: modelRoot,
      runtimeCachePath: installRoot,
      maxSeconds: ASR_MAX_SECONDS,
      settingUpRuntime: Boolean(runtimeTask),
      downloadingModel: Boolean(modelTask),
      workerRunning: Boolean(worker?.running),
      lastLoadSeconds,
      ...runtime
    }
  }

  async function installRuntime(signal) {
    const existing = await inspectRuntime()
    if (existing.runtimeReady) return getStatus()
    await stopWorker()
    await mkdir(downloadsRoot, { recursive: true })
    const archivePath = join(downloadsRoot, asset.name)
    const fileSpec = { path: asset.name, size: asset.size, sha256: asset.sha256 }
    const archiveInfo = await statOrNull(archivePath)
    if (!(archiveInfo?.isFile() && archiveInfo.size === asset.size && await hashFile(archivePath) === asset.sha256)) {
      await rm(archivePath, { force: true })
      onProgress({ kind: 'runtime', state: 'downloading-runtime', file: asset.name, downloadedBytes: 0, totalBytes: asset.size, message: `Downloading speech.cpp ${release.version} (${asset.platform})…` })
      await downloadFile({
        url: getSpeechCppAssetUrl(asset, release),
        file: fileSpec,
        path: archivePath,
        fetchImpl,
        signal,
        totalBytes: asset.size,
        onProgress: (progress) => onProgress({ kind: 'runtime', state: 'downloading-runtime', file: asset.name, downloadedBytes: progress.fileBytes ?? progress.downloadedBytes ?? 0, totalBytes: asset.size, message: `Downloading speech.cpp ${release.version} (${asset.platform})…` })
      })
    }
    if (signal?.aborted) throw signal.reason || new Error('speech.cpp setup cancelled.')
    onProgress({ kind: 'runtime', state: 'installing-runtime', message: 'Extracting the checksum-verified speech executable…' })
    const archive = await readFile(archivePath)
    const actual = createHash('sha256').update(archive).digest('hex')
    if (actual !== asset.sha256) throw new Error('The speech.cpp archive failed its pinned SHA-256 check.')
    const executable = readZipEntry(archive, asset.executable)
    const stage = join(runtimeBase, `.install-${process.pid}-${randomBytes(6).toString('hex')}`)
    await mkdir(stage, { recursive: true })
    try {
      const stagedBinary = join(stage, asset.executable)
      await writeFile(stagedBinary, executable, { mode: 0o755 })
      if (platform !== 'win32') await chmod(stagedBinary, 0o755)
      const probe = await probeBinary(stagedBinary)
      if (!probe.runtimeReady) throw new Error(probe.runtimeError)
      const backup = `${installRoot}.old-${randomBytes(5).toString('hex')}`
      let moved = false
      try {
        await rename(installRoot, backup)
        moved = true
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      try {
        await rename(stage, installRoot)
      } catch (error) {
        if (moved) await rename(backup, installRoot).catch(() => {})
        throw error
      }
      if (moved) await rm(backup, { recursive: true, force: true }).catch(() => {})
      await rm(archivePath, { force: true }).catch(() => {})
      inspectedRuntime.clear()
      onProgress({ kind: 'runtime', state: 'runtime-ready', message: `speech.cpp ${release.version} is ready.` })
      return getStatus()
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
    }
  }

  function setupRuntime() {
    if (runtimeTask) return runtimeTask
    if (!asset) return Promise.reject(new Error(`speech.cpp has no pinned release for ${platform}-${arch}.`))
    if (activeTranscription) return Promise.reject(new Error('Wait for recognition to finish before replacing the runtime.'))
    const controller = new AbortController()
    runtimeController = controller
    runtimeTask = installRuntime(controller.signal).catch((error) => {
      onProgress({ kind: 'runtime', state: controller.signal.aborted ? 'cancelled' : 'error', message: controller.signal.aborted ? 'speech.cpp setup cancelled. The partial download is kept and resumes next time.' : error?.message })
      throw error
    }).finally(() => {
      runtimeTask = null
      if (runtimeController === controller) runtimeController = null
    })
    return runtimeTask
  }

  function cancelRuntimeSetup() {
    if (!runtimeController) return { cancelled: false }
    runtimeController.abort(new Error('speech.cpp setup cancelled. The partial download is kept and resumes next time.'))
    return { cancelled: true }
  }

  async function fetchModel(signal) {
    if (await modelMatches()) return getStatus()
    await mkdir(modelRoot, { recursive: true })
    const partial = await statOrNull(modelPartPath)
    const pending = model.file.size - (partial?.isFile() ? Math.min(partial.size, model.file.size) : 0)
    try {
      const filesystem = await getFilesystemStats(modelRoot)
      const available = Number(filesystem.bavail) * Number(filesystem.bsize)
      if (Number.isFinite(available) && available < pending + ASR_DISK_RESERVE_BYTES) {
        throw new Error(`Not enough free disk space for Haas-ja-v1.0: need about ${((pending + ASR_DISK_RESERVE_BYTES) / 1024 ** 3).toFixed(2)} GiB, ${(available / 1024 ** 3).toFixed(2)} GiB available.`)
      }
    } catch (error) {
      if (/Not enough free disk space/.test(error?.message || '')) throw error
    }
    await rm(modelPath, { force: true })
    onProgress({ kind: 'model', state: 'downloading', file: model.file.path, downloadedBytes: model.file.size - pending, totalBytes: model.file.size, message: `Downloading ${model.file.path}…` })
    await downloadFile({
      url: getHaasModelUrl(model),
      file: model.file,
      path: modelPath,
      partPath: modelPartPath,
      fetchImpl,
      signal,
      modelId: model.id,
      totalBytes: model.file.size,
      completedFiles: 0,
      totalFiles: 1,
      onProgress: (progress) => onProgress({ kind: 'model', state: 'downloading', file: model.file.path, downloadedBytes: progress.fileBytes ?? progress.downloadedBytes ?? 0, totalBytes: model.file.size, message: `Downloading ${model.file.path}…` })
    })
    verifiedModelSignatures.clear()
    if (!(await modelMatches())) throw new Error('The downloaded Haas model failed its pinned SHA-256 check.')
    onProgress({ kind: 'model', state: 'complete', downloadedBytes: model.file.size, totalBytes: model.file.size, message: 'Haas-ja-v1.0 Q8_0 is checksum-verified.' })
    return getStatus()
  }

  function downloadModel() {
    if (modelTask) return modelTask
    if (!asset) return Promise.reject(new Error(`speech.cpp has no pinned release for ${platform}-${arch}.`))
    const controller = new AbortController()
    modelController = controller
    modelTask = fetchModel(controller.signal).catch((error) => {
      onProgress({ kind: 'model', state: controller.signal.aborted ? 'cancelled' : 'error', message: controller.signal.aborted ? 'Download cancelled. The partial file is kept and resumes next time.' : error?.message })
      throw error
    }).finally(() => {
      modelTask = null
      if (modelController === controller) modelController = null
    })
    return modelTask
  }

  function cancelModelDownload() {
    if (!modelController) return { cancelled: false }
    modelController.abort(new Error('Haas download cancelled. The partial file is kept and resumes next time.'))
    return { cancelled: true }
  }

  function scheduleIdleStop() {
    clearTimeout(idleTimer)
    if (!idleStopMs) return
    idleTimer = setTimeout(() => {
      if (!activeTranscription) void stopWorker()
    }, idleStopMs)
    idleTimer.unref?.()
  }

  async function ensureWorker() {
    if (worker?.running) return worker
    if (workerStartTask) return workerStartTask
    const current = workerFactory({
      spawnImpl,
      executable: binaryPath,
      args: buildWorkerArgs(modelPath, workerOptions),
      env: runtimeEnv,
      cwd: installRoot,
      expectedVersion: release.version,
      expectedProtocol: release.workerProtocol,
      onExit: () => { if (worker === current) worker = null }
    })
    worker = current
    const task = (async () => {
      onProgress({ kind: 'worker', state: 'loading', message: 'Loading Haas-ja-v1.0 into the local speech worker…' })
      const started = performance.now()
      try {
        await current.start()
      } catch (error) {
        if (worker === current) worker = null
        await current.stop().catch(() => {})
        throw error
      }
      lastLoadSeconds = (performance.now() - started) / 1000
      onProgress({ kind: 'worker', state: 'ready', message: `Speech worker ready in ${lastLoadSeconds.toFixed(1)} s.` })
      return current
    })()
    workerStartTask = task
    try {
      return await task
    } finally {
      if (workerStartTask === task) workerStartTask = null
    }
  }

  async function warmWorker() {
    if (activeTranscription) return { ready: Boolean(worker?.running), alreadyInUse: true, loadSeconds: 0 }
    clearTimeout(idleTimer)
    const runtime = await inspectRuntime()
    if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'Install the speech.cpp runtime in Voice Lab first.')
    if (!(await modelMatches())) throw new Error('Download the Haas-ja-v1.0 model in Voice Lab first.')
    const wasRunning = Boolean(worker?.running)
    const started = performance.now()
    await ensureWorker()
    scheduleIdleStop()
    return { ready: true, alreadyWarm: wasRunning, loadSeconds: wasRunning ? 0 : (performance.now() - started) / 1000 }
  }

  async function transcribe(audio, { timestamps = true } = {}) {
    if (activeTranscription) throw new Error('Speech recognition is already running. Wait for it to finish.')
    const wav = parsePcm16Wav(audio)
    if (wav.peak < 64) throw new Error('The recording is silent. Check the microphone and try again.')
    let finish
    const state = { cancelled: false, requestId: '' }
    activeTranscriptionState = state
    activeTranscription = new Promise((resolvePromise) => { finish = resolvePromise })
    clearTimeout(idleTimer)
    try {
      const runtime = await inspectRuntime()
      if (state.cancelled) throw new SpeechWorkerError('Recognition was cancelled.', { code: 'cancelled' })
      if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'Install the speech.cpp runtime in Voice Lab first.')
      if (!(await modelMatches())) throw new Error('Download the Haas-ja-v1.0 model in Voice Lab first.')
      if (state.cancelled) throw new SpeechWorkerError('Recognition was cancelled.', { code: 'cancelled' })
      const startedLoad = performance.now()
      const wasRunning = Boolean(worker?.running)
      const client = await ensureWorker()
      if (state.cancelled) throw new SpeechWorkerError('Recognition was cancelled.', { code: 'cancelled' })
      const loadSeconds = wasRunning ? 0 : (performance.now() - startedLoad) / 1000
      requestCounter += 1
      const id = `asr-${requestCounter}`
      state.requestId = id
      const started = performance.now()
      onProgress({ kind: 'transcribe', state: 'transcribing', message: 'Recognizing speech on this device…' })
      const end = await client.request(id, buildTranscribeLines(id, wav.pcm, wav.sampleRate, { timestamps }), {
        timeoutMs: 120_000,
        onProgress: (done) => onProgress({ kind: 'transcribe', state: 'transcribing', done, message: `Recognizing… ${Math.round(done * 100)}%` })
      })
      const recognitionSeconds = (performance.now() - started) / 1000
      onProgress({ kind: 'transcribe', state: 'complete', message: 'Recognition complete.' })
      return {
        text: typeof end.text === 'string' ? end.text : '',
        stop: end.stop || 'complete',
        segments: Array.isArray(end.segments) ? end.segments : [],
        tokens: Array.isArray(end.tokens) ? end.tokens : [],
        audioSeconds: wav.seconds,
        sampleRate: wav.sampleRate,
        recognitionSeconds,
        loadSeconds,
        rtfx: recognitionSeconds > 0 ? wav.seconds / recognitionSeconds : null,
        backend: `speech.cpp ${release.version} · ${asset?.backend || 'native'}`,
        modelId: model.id
      }
    } catch (error) {
      if (state.cancelled) throw new SpeechWorkerError('Recognition was cancelled.', { code: 'cancelled' })
      throw error
    } finally {
      activeTranscription = null
      activeTranscriptionState = null
      finish()
      scheduleIdleStop()
    }
  }

  function cancelTranscription() {
    const state = activeTranscriptionState
    if (!state) return { cancelled: false }
    state.cancelled = true
    if (state.requestId && worker?.running) worker.cancel(state.requestId)
    else if (worker?.running) void stopWorker()
    return { cancelled: true }
  }

  async function stopWorker() {
    clearTimeout(idleTimer)
    if (workerStartTask) await workerStartTask.catch(() => {})
    const current = worker
    worker = null
    if (current) await current.stop().catch(() => {})
  }

  async function removeModelCache() {
    if (modelTask) throw new Error('Wait for the Haas download to finish or cancel it first.')
    if (activeTranscription) throw new Error('Wait for recognition to finish before removing the model.')
    await stopWorker()
    await rm(join(appData, 'asr-models', model.id), { recursive: true, force: true })
    verifiedModelSignatures.clear()
    return getStatus()
  }

  async function removeRuntime() {
    if (runtimeTask) throw new Error('Wait for speech.cpp setup to finish or cancel it first.')
    if (activeTranscription) throw new Error('Wait for recognition to finish before removing the runtime.')
    await stopWorker()
    await rm(runtimeBase, { recursive: true, force: true })
    inspectedRuntime.clear()
    return getStatus()
  }

  async function stop() {
    cancelRuntimeSetup()
    cancelModelDownload()
    cancelTranscription()
    if (activeTranscription) await Promise.race([activeTranscription, new Promise((r) => setTimeout(r, 3000))])
    await stopWorker()
  }

  return Object.freeze({ getStatus, setupRuntime, cancelRuntimeSetup, downloadModel, cancelModelDownload, warmWorker, transcribe, cancelTranscription, removeModelCache, removeRuntime, stopWorker, stop })
}
