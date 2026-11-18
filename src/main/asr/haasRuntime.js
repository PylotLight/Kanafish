import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, chmod, lstat, mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { downloadVerifiedFile } from '../tts/modelStore.js'
import { HAAS_ASR_MODEL, SILERO_VAD_MODEL, SPEECH_CPP_RELEASE, getHaasModelUrl, getVadModelUrl, getSpeechCppAsset, getSpeechCppAssetUrl } from './haasRegistry.js'
import { readZipEntry } from './zipEntry.js'
import { buildTranscribeLines, createSpeechWorkerClient, SpeechWorkerError } from './speechWorker.js'
import { buildStreamingAsrArgs, createSpeechStreamClient } from './speechStream.js'

export const ASR_MAX_SECONDS = 60
export const ASR_MIN_SECONDS = 0.2
export const ASR_MAX_WAV_BYTES = 44 + ASR_MAX_SECONDS * 48_000 * 2 + 4096
export const ASR_IDLE_STOP_MS = 5 * 60 * 1000
export const ASR_DISK_RESERVE_BYTES = 64 * 1024 * 1024
export const ASR_STREAM_MAX_SECONDS = ASR_MAX_SECONDS
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
  onStreamEvent = () => {},
  release = SPEECH_CPP_RELEASE,
  model = HAAS_ASR_MODEL,
  vadModel = SILERO_VAD_MODEL,
  downloadFile = downloadVerifiedFile,
  getFilesystemStats = statfs,
  workerFactory = createSpeechWorkerClient,
  streamFactory = createSpeechStreamClient,
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
  const vadRoot = join(appData, 'asr-models', vadModel.id, vadModel.revision)
  const vadPath = join(vadRoot, vadModel.file.path)
  const vadPartPath = `${vadPath}.part`
  const binaryPath = asset ? join(installRoot, asset.executable) : ''
  const runtimeEnv = speechEnvironment(env)

  let runtimeTask = null
  let runtimeController = null
  let modelTask = null
  let modelController = null
  let vadTask = null
  let vadController = null
  let worker = null
  let workerStartTask = null
  let streamClient = null
  let streamStartTask = null
  let streamStartInProgress = false
  let streamSampleRate = 0
  let activeStreamSession = null
  let idleTimer = null
  let activeTranscription = null
  let activeTranscriptionState = null
  let requestCounter = 0
  let streamRequestCounter = 0
  let lastLoadSeconds = null
  const verifiedModelSignatures = new Map()
  const verifiedVadSignatures = new Map()
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

  async function vadMatches() {
    try {
      const info = await lstat(vadPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== vadModel.file.size) return false
      const signature = fileSignature(info)
      if (verifiedVadSignatures.get(vadPath) === signature) return true
      if ((await hashFile(vadPath)) !== vadModel.file.sha256) {
        verifiedVadSignatures.delete(vadPath)
        return false
      }
      verifiedVadSignatures.set(vadPath, signature)
      return true
    } catch {
      return false
    }
  }

  async function getStatus() {
    const [runtime, modelInstalled, partial, vadInstalled, vadPartial] = await Promise.all([inspectRuntime(), modelMatches(), statOrNull(modelPartPath).catch(() => null), vadMatches(), statOrNull(vadPartPath).catch(() => null)])
    const partialBytes = partial?.isFile() ? Math.min(partial.size, model.file.size) : 0
    const vadPartialBytes = vadPartial?.isFile() ? Math.min(vadPartial.size, vadModel.file.size) : 0
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
      vadId: vadModel.id,
      vadName: vadModel.name,
      vadRepo: vadModel.repo,
      vadRevision: vadModel.revision,
      vadLicense: vadModel.license,
      vadFile: vadModel.file.path,
      vadTotalBytes: vadModel.file.size,
      vadDownloadedBytes: vadInstalled ? vadModel.file.size : vadPartialBytes,
      vadInstalled,
      vadDownloading: Boolean(vadTask),
      canDownloadVad: Boolean(asset),
      streamReady: Boolean(runtime.runtimeReady && modelInstalled && vadInstalled),
      canDownload: Boolean(asset),
      cachePath: modelRoot,
      runtimeCachePath: installRoot,
      maxSeconds: ASR_MAX_SECONDS,
      settingUpRuntime: Boolean(runtimeTask),
      downloadingModel: Boolean(modelTask),
      workerRunning: Boolean(worker?.running),
      streamProcessRunning: Boolean(streamClient?.running),
      streaming: Boolean(activeStreamSession),
      lastLoadSeconds,
      ...runtime
    }
  }

  async function installRuntime(signal) {
    const existing = await inspectRuntime()
    if (existing.runtimeReady) return getStatus()
    await stopWorker()
    await stopStreamingClient()
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
    if (activeTranscription || activeStreamSession) return Promise.reject(new Error('Wait for recognition to finish before replacing the runtime.'))
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
    await stopWorker()
    await stopStreamingClient()
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
    if (activeTranscription || activeStreamSession) return Promise.reject(new Error('Wait for recognition to finish before replacing the Haas model.'))
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

  async function fetchVadModel(signal) {
    if (await vadMatches()) return getStatus()
    if (activeStreamSession) throw new Error('Wait for live recognition to finish before replacing the VAD model.')
    if (streamClient?.running) await stopStreamingClient()
    await mkdir(vadRoot, { recursive: true })
    await rm(vadPath, { force: true })
    onProgress({ kind: 'vad', state: 'downloading', file: vadModel.file.path, downloadedBytes: 0, totalBytes: vadModel.file.size, message: `Downloading ${vadModel.name}…` })
    await downloadFile({
      url: getVadModelUrl(vadModel),
      file: vadModel.file,
      path: vadPath,
      partPath: vadPartPath,
      fetchImpl,
      signal,
      modelId: vadModel.id,
      totalBytes: vadModel.file.size,
      onProgress: (progress) => onProgress({ kind: 'vad', state: 'downloading', file: vadModel.file.path, downloadedBytes: progress.fileBytes ?? progress.downloadedBytes ?? 0, totalBytes: vadModel.file.size, message: `Downloading ${vadModel.name}…` })
    })
    verifiedVadSignatures.clear()
    if (!(await vadMatches())) throw new Error('The downloaded Silero VAD model failed its pinned SHA-256 check.')
    onProgress({ kind: 'vad', state: 'complete', downloadedBytes: vadModel.file.size, totalBytes: vadModel.file.size, message: `${vadModel.name} is checksum-verified.` })
    return getStatus()
  }

  function downloadVadModel() {
    if (vadTask) return vadTask
    if (!asset) return Promise.reject(new Error(`speech.cpp has no pinned release for ${platform}-${arch}.`))
    if (activeStreamSession) return Promise.reject(new Error('Wait for live recognition to finish before downloading the VAD model.'))
    const controller = new AbortController()
    vadController = controller
    vadTask = fetchVadModel(controller.signal).catch((error) => {
      onProgress({ kind: 'vad', state: controller.signal.aborted ? 'cancelled' : 'error', message: controller.signal.aborted ? 'VAD download cancelled. The partial file is kept and resumes next time.' : error?.message })
      throw error
    }).finally(() => {
      vadTask = null
      if (vadController === controller) vadController = null
    })
    return vadTask
  }

  function cancelVadDownload() {
    if (!vadController) return { cancelled: false }
    vadController.abort(new Error('Silero VAD download cancelled. The partial file is kept and resumes next time.'))
    return { cancelled: true }
  }

  function scheduleIdleStop() {
    clearTimeout(idleTimer)
    if (!idleStopMs) return
    idleTimer = setTimeout(() => {
      if (!activeTranscription && !activeStreamSession) void Promise.allSettled([stopWorker(), stopStreamingClient()])
    }, idleStopMs)
    idleTimer.unref?.()
  }

  async function ensureWorker() {
    if (activeStreamSession) throw new Error('Wait for live recognition to finish before starting buffered recognition.')
    await stopStreamingClient()
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
    if (activeStreamSession) return { ready: Boolean(streamClient?.running), alreadyInUse: true, loadSeconds: 0 }
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

  function notifyStreamSession(session) {
    const waiters = [...session.waiters]
    session.waiters.clear()
    for (const notify of waiters) notify()
  }

  function streamText(session) {
    return session.order.map((id) => {
      const item = session.items.get(id)
      return item?.final ?? item?.partial ?? ''
    }).join('')
  }

  function handleStreamEvent(event) {
    const session = activeStreamSession
    if (!session || session.cancelled) return
    session.lastEventAt = performance.now()
    const type = event.type
    const itemId = String(event.item_id || event.itemId || session.activeItemId || '')
    let kind = 'status'
    if (type === 'input_audio_buffer.speech_started') {
      session.hadSpeech = true
      session.activeItemId = itemId
      if (itemId && !session.items.has(itemId)) {
        session.items.set(itemId, { partial: '', final: null })
        session.order.push(itemId)
      }
      if (itemId) session.pendingItems.add(itemId)
      kind = 'speech-started'
    } else if (type === 'input_audio_buffer.speech_stopped') {
      session.hadSpeech = true
      if (itemId) session.pendingItems.add(itemId)
      kind = 'speech-stopped'
    } else if (type === 'conversation.item.input_audio_transcription.delta') {
      session.hadSpeech = true
      const id = itemId || `stream-item-${session.order.length + 1}`
      if (!session.items.has(id)) {
        session.items.set(id, { partial: '', final: null })
        session.order.push(id)
      }
      session.pendingItems.add(id)
      const delta = typeof event.delta === 'string' ? event.delta : typeof event.text === 'string' ? event.text : ''
      session.items.get(id).partial += delta
      session.activeItemId = id
      kind = 'partial'
    } else if (type === 'conversation.item.input_audio_transcription.completed') {
      const id = itemId || session.activeItemId || `stream-item-${session.order.length + 1}`
      if (!session.items.has(id)) {
        session.items.set(id, { partial: '', final: null })
        session.order.push(id)
      }
      session.items.get(id).final = typeof event.transcript === 'string' ? event.transcript : ''
      session.pendingItems.delete(id)
      if (session.activeItemId === id) session.activeItemId = ''
      session.completedCount += 1
      session.hadSpeech = true
      kind = 'final'
    } else if (type === 'failed') {
      const detail = event.error || event.message || 'Live recognition failed.'
      session.error = new Error(typeof detail === 'string' ? detail : detail.message || 'Live recognition failed.')
      kind = 'error'
    } else {
      return
    }
    session.text = streamText(session)
    const update = { sessionId: session.id, kind, text: session.text, itemId }
    if (kind === 'error') update.message = session.error.message
    try { onStreamEvent(update) } catch {}
    if (kind === 'error') onProgress({ kind: 'stream', state: 'error', message: session.error.message })
    notifyStreamSession(session)
  }

  function failActiveStream(error) {
    const session = activeStreamSession
    if (!session || session.error) return
    session.error = error instanceof Error ? error : new Error(String(error || 'Live recognition failed.'))
    try { onStreamEvent({ sessionId: session.id, kind: 'error', text: session.text || '', message: session.error.message }) } catch {}
    onProgress({ kind: 'stream', state: 'error', message: session.error.message })
    notifyStreamSession(session)
  }

  async function stopStreamingClient() {
    if (streamStartTask) await streamStartTask.catch(() => {})
    const current = streamClient
    streamClient = null
    streamSampleRate = 0
    if (current) await current.stop().catch(() => {})
  }

  async function ensureStreamingClient(sampleRate) {
    if (streamClient?.running && streamSampleRate === sampleRate) return streamClient
    if (streamClient) await stopStreamingClient()
    await stopWorker()
    const current = streamFactory({
      spawnImpl,
      executable: binaryPath,
      args: buildStreamingAsrArgs(modelPath, vadPath, sampleRate, workerOptions),
      env: runtimeEnv,
      cwd: installRoot,
      onEvent: handleStreamEvent,
      onError: (error) => {
        failActiveStream(error)
        if (streamClient === current) {
          streamClient = null
          streamSampleRate = 0
        }
      }
    })
    streamClient = current
    streamSampleRate = sampleRate
    const task = (async () => {
      onProgress({ kind: 'stream', state: 'loading', message: 'Starting local live recognition…' })
      try {
        await current.start()
        return current
      } catch (error) {
        if (streamClient === current) {
          streamClient = null
          streamSampleRate = 0
        }
        await current.stop().catch(() => {})
        throw error
      }
    })()
    streamStartTask = task
    try { return await task } finally { if (streamStartTask === task) streamStartTask = null }
  }

  async function startStream(sampleRate = 16_000) {
    if (activeTranscription) throw new Error('Speech recognition is already running. Wait for it to finish.')
    if (activeStreamSession) throw new Error('Live speech recognition is already running.')
    if (streamStartInProgress) throw new Error('Live speech recognition is already starting.')
    if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) throw new Error('The live audio sample rate must be 8–48 kHz.')
    streamStartInProgress = true
    streamRequestCounter += 1
    const session = {
      id: `asr-live-${streamRequestCounter}-${randomBytes(4).toString('hex')}`,
      sampleRate,
      startedAt: performance.now(),
      audioBytes: 0,
      items: new Map(),
      order: [],
      pendingItems: new Set(),
      activeItemId: '',
      completedCount: 0,
      hadSpeech: false,
      text: '',
      error: null,
      cancelled: false,
      waiters: new Set(),
      lastEventAt: 0
    }
    activeStreamSession = session
    clearTimeout(idleTimer)
    try {
      const runtime = await inspectRuntime()
      if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'Install the speech.cpp runtime in Voice Lab first.')
      if (!(await modelMatches())) throw new Error('Download the Haas-ja-v1.0 model in Voice Lab first.')
      if (!(await vadMatches())) throw new Error('Download the small Silero VAD model in Voice Lab to enable live recognition.')
      if (session.cancelled || activeStreamSession !== session) throw new Error('Live speech recognition was cancelled before startup completed.')
      await ensureStreamingClient(sampleRate)
      if (session.cancelled || activeStreamSession !== session) {
        await stopStreamingClient()
        throw new Error('Live speech recognition was cancelled before startup completed.')
      }
      onProgress({ kind: 'stream', state: 'listening', message: 'Live recognition is running on this device.' })
      return { sessionId: session.id, sampleRate }
    } catch (error) {
      if (activeStreamSession === session) activeStreamSession = null
      await stopStreamingClient()
      scheduleIdleStop()
      throw error
    } finally {
      streamStartInProgress = false
    }
  }

  async function pushStreamFrame(sessionId, input) {
    const session = activeStreamSession
    if (!session || session.id !== sessionId || session.cancelled) throw new Error('This live recognition session is no longer active.')
    if (session.error) throw session.error
    const pcm = Buffer.isBuffer(input) ? input : input instanceof Uint8Array ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : null
    if (!pcm || !pcm.length || pcm.length % 2 || pcm.length > 64 * 1024) throw new Error('Live audio frames must be non-empty, even-length PCM16LE and no larger than 64 KB.')
    if (session.audioBytes + pcm.length > ASR_STREAM_MAX_SECONDS * session.sampleRate * 2) throw new Error(`Live recordings are limited to ${ASR_STREAM_MAX_SECONDS} seconds.`)
    if (!streamClient?.running) throw session.error || new Error('The local live-ASR process is not running.')
    session.audioBytes += pcm.length
    try { await streamClient.write(pcm) } catch (error) { failActiveStream(error); throw error }
    return { acceptedBytes: pcm.length, audioSeconds: session.audioBytes / 2 / session.sampleRate }
  }

  function waitForStreamChange(session, milliseconds) {
    return new Promise((resolvePromise) => {
      const timer = setTimeout(done, milliseconds)
      function done() {
        clearTimeout(timer)
        session.waiters.delete(done)
        resolvePromise()
      }
      session.waiters.add(done)
    })
  }

  async function finishStream(sessionId) {
    const session = activeStreamSession
    if (!session || session.id !== sessionId) throw new Error('This live recognition session is no longer active.')
    if (session.finishPromise) return session.finishPromise
    session.finishPromise = finalizeStream(session)
    return session.finishPromise
  }

  async function finalizeStream(session) {
    const finishStarted = performance.now()
    const silence = Buffer.alloc(Math.floor(session.sampleRate / 10) * 2)
    try {
      for (let index = 0; index < 10; index += 1) {
        if (session.error) break
        await streamClient.write(silence)
      }
    } catch (error) {
      failActiveStream(error)
    }
    const quietDeadline = performance.now() + 2_500
    const speechDeadline = performance.now() + 20_000
    while (!session.error && !session.cancelled) {
      const settled = session.hadSpeech && session.pendingItems.size === 0 && session.completedCount > 0
      if (settled && performance.now() - Math.max(finishStarted, session.lastEventAt || 0) >= 1_000) break
      const deadline = session.hadSpeech ? speechDeadline : quietDeadline
      const remaining = deadline - performance.now()
      if (remaining <= 0) break
      await waitForStreamChange(session, Math.min(remaining, 250))
    }
    const needsFallback = Boolean(session.error || !session.text.trim() || session.pendingItems.size > 0 || session.completedCount === 0)
    if (session.error || session.pendingItems.size > 0) await stopStreamingClient()
    if (activeStreamSession === session) activeStreamSession = null
    const audioSeconds = session.audioBytes / 2 / session.sampleRate
    const recognitionSeconds = (performance.now() - finishStarted) / 1000
    const result = {
      text: session.text,
      final: !needsFallback,
      needsFallback,
      error: session.error?.message || '',
      hadSpeech: session.hadSpeech,
      audioSeconds,
      sampleRate: session.sampleRate,
      recognitionSeconds,
      loadSeconds: 0,
      rtfx: recognitionSeconds > 0 ? audioSeconds / recognitionSeconds : null,
      backend: `speech.cpp ${release.version} · ${asset?.backend || 'native'} · live VAD`,
      modelId: model.id
    }
    onProgress({ kind: 'stream', state: needsFallback ? 'fallback' : 'complete', message: needsFallback ? 'Using the buffered local-recognition fallback…' : 'Live recognition complete.' })
    try { onStreamEvent({ sessionId: session.id, kind: needsFallback ? 'fallback' : 'final', text: session.text, message: result.error }) } catch {}
    scheduleIdleStop()
    return result
  }

  async function cancelStream(sessionId) {
    const session = activeStreamSession
    if (!session || (sessionId && session.id !== sessionId)) return { cancelled: false }
    session.cancelled = true
    activeStreamSession = null
    notifyStreamSession(session)
    await stopStreamingClient()
    scheduleIdleStop()
    return { cancelled: true }
  }

  async function transcribe(audio, { timestamps = true } = {}) {
    if (activeStreamSession) throw new Error('Live speech recognition is already running. Wait for it to finish or cancel it.')
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
    if (activeTranscription || activeStreamSession) throw new Error('Wait for recognition to finish before removing the model.')
    await stopWorker()
    await stopStreamingClient()
    await rm(join(appData, 'asr-models', model.id), { recursive: true, force: true })
    verifiedModelSignatures.clear()
    return getStatus()
  }

  async function removeRuntime() {
    if (runtimeTask) throw new Error('Wait for speech.cpp setup to finish or cancel it first.')
    if (activeTranscription || activeStreamSession) throw new Error('Wait for recognition to finish before removing the runtime.')
    await stopWorker()
    await stopStreamingClient()
    await rm(runtimeBase, { recursive: true, force: true })
    inspectedRuntime.clear()
    return getStatus()
  }

  async function stop() {
    cancelRuntimeSetup()
    cancelModelDownload()
    cancelVadDownload()
    cancelTranscription()
    await cancelStream()
    if (activeTranscription) await Promise.race([activeTranscription, new Promise((r) => setTimeout(r, 3000))])
    await stopWorker()
    await stopStreamingClient()
  }

  async function removeVadModelCache() {
    if (vadTask) throw new Error('Wait for the VAD download to finish or cancel it first.')
    if (activeStreamSession) throw new Error('Wait for live recognition to finish before removing the VAD model.')
    await stopStreamingClient()
    await rm(join(appData, 'asr-models', vadModel.id), { recursive: true, force: true })
    verifiedVadSignatures.clear()
    return getStatus()
  }

  return Object.freeze({ getStatus, setupRuntime, cancelRuntimeSetup, downloadModel, cancelModelDownload, downloadVadModel, cancelVadDownload, removeVadModelCache, warmWorker, transcribe, cancelTranscription, startStream, pushStreamFrame, finishStream, cancelStream, removeModelCache, removeRuntime, stopWorker, stop })
}
