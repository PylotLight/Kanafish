import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, lstat, mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus, homedir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { performance } from 'node:perf_hooks'
import { getNativeRuntimeInstallPaths } from './nativeRuntimeSetup.js'

export const QWEN3_TTS_RUNTIME = Object.freeze({
  id: 'qwen3-tts-0.6b-customvoice',
  name: 'Qwen3-TTS 0.6B CustomVoice',
  modelId: 'qwen3-tts-0.6b-customvoice-q8_0',
  modelRepo: 'BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF',
  modelRevision: '22f3c6369919f6374f790a65c6fe3aed0ec5f86b',
  sourceModelRepo: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
  runtimeRepo: 'mybigday/codec.cpp',
  runtimeCommit: 'd5e385229ea5a0f48fff696fed4699a852aa43b7',
  minimumRuntimeDate: '2026-10-20',
  weightsLicense: 'Apache-2.0',
  runtimeLicense: 'MIT',
  voice: 'ono_anna',
  voices: Object.freeze(['ono_anna']),
  sampleRate: 24_000,
  approximateBytes: 1_949_930_688,
  files: Object.freeze([
    Object.freeze({
      role: 'backbone',
      name: 'qwen3-tts-0.6b-customvoice-q8_0.gguf',
      size: 639_442_656,
      sha256: 'a2a621131e578cce546be74efa741eb5fc68d73be90a24ebef8c9f3f1c4cb4a8'
    }),
    Object.freeze({
      role: 'codec',
      name: 'codec-q8_0.gguf',
      size: 1_310_488_032,
      sha256: '959a179d9254c3da23ba4118129ac1f5c556fad8b2764841dd2cedba61ac8c72'
    })
  ])
})

const MANIFEST_NAME = 'qwen3-tts-0.6b-customvoice-manifest.json'
const MAX_TEXT_CHARS = 4000
const MAX_COMMAND_OUTPUT = 256_000

function isPathWithinDirectory(root, target) {
  const base = resolve(root)
  const path = resolve(target)
  const rel = relative(base, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function fileSignature(info) {
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`
}

export function getCodecCppServerCandidates({ env = process.env, home = homedir(), platform = process.platform, userDataDir = '' } = {}) {
  const executable = platform === 'win32' ? 'tts-server.exe' : 'tts-server'
  const candidates = []
  if (env.KANAFISH_CODEC_CPP_TTS_SERVER_PATH) candidates.push(env.KANAFISH_CODEC_CPP_TTS_SERVER_PATH)
  if (userDataDir) candidates.push(getNativeRuntimeInstallPaths(userDataDir, 'codecCpp', undefined, platform).executablePath)
  const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  if (platform === 'win32') {
    candidates.push(join(localAppData, 'Kanafish', 'codec.cpp', 'build', executable))
    candidates.push(join(localAppData, 'codec.cpp', 'bin', executable))
  } else {
    candidates.push(join(home, '.local', 'share', 'kanafish', 'codec.cpp', 'build', executable))
    candidates.push(join(home, '.local', 'bin', executable))
    candidates.push(join(home, 'Library', 'Application Support', 'Kanafish', 'codec.cpp', 'build', executable))
    candidates.push('/usr/local/bin/tts-server', '/opt/homebrew/bin/tts-server')
  }
  if (env.PATH) {
    for (const entry of env.PATH.split(delimiter)) candidates.push(join(entry, executable))
  }
  return [...new Set(candidates.filter(Boolean))]
}

export function supportsCodecCppTtsServer(helpOutput = '') {
  const output = String(helpOutput)
  return /usage:\s+.*tts-server/i.test(output) &&
    ['--model', '--backbone', '--host', '--port', '--api-key', '--n-threads'].every((flag) => output.includes(flag)) &&
    /response formats[^\n]*\bwav\b/i.test(output)
}

export function wavDurationSeconds(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null
  let byteRate = 0
  let dataSize = 0
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ' && size >= 16 && start + 16 <= bytes.length) byteRate = bytes.readUInt32LE(start + 8)
    if (id === 'data') {
      // tts-server streams WAV and may leave the RIFF data length at 0xffffffff.
      dataSize = Math.min(size, Math.max(0, bytes.length - start))
      break
    }
    offset = start + size + (size & 1)
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null
}

function commandExists(path, platform = process.platform) {
  return stat(path).then(async (info) => {
    if (!info.isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  }).catch(() => false)
}

function runCommand(executable, args, { spawnImpl, env, timeoutMs = 10_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawnImpl(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      rejectPromise(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const append = (current, chunk) => `${current}${chunk.toString('utf8')}`.slice(-MAX_COMMAND_OUTPUT)
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`codec.cpp tts-server inspection timed out after ${Math.round(timeoutMs / 1000)} seconds`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => finish(null, { stdout, stderr, code, signal }))
  })
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyPinnedFile(path, spec, root) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== spec.size) return false
    const [rootPath, filePath] = await Promise.all([realpath(root), realpath(path)])
    if (!isPathWithinDirectory(rootPath, filePath)) return false
    return (await hashFile(filePath)) === spec.sha256
  } catch {
    return false
  }
}

async function choosePort() {
  const probe = createServer()
  await new Promise((resolvePromise, rejectPromise) => {
    probe.once('error', rejectPromise)
    probe.listen(0, '127.0.0.1', resolvePromise)
  })
  const { port } = probe.address()
  await new Promise((resolvePromise, rejectPromise) => probe.close((error) => error ? rejectPromise(error) : resolvePromise()))
  return port
}

function getThreadCount(env) {
  const requested = Number.parseInt(env.KANAFISH_CODEC_CPP_THREADS || '', 10)
  if (Number.isInteger(requested) && requested > 0) return Math.min(32, requested)
  const available = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length
  return Math.max(1, Math.min(8, available || 1))
}

function responseError(body, fallback) {
  try {
    return JSON.parse(body)?.error?.message || JSON.parse(body)?.error || body || fallback
  } catch {
    return body || fallback
  }
}

export function createQwenRuntime({
  userDataDir,
  env = process.env,
  home = homedir(),
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  onProgress = () => {},
  runtimeConfig = QWEN3_TTS_RUNTIME,
  nativeRuntimeSetup = null,
  serverStartupTimeoutMs = 180_000,
  serverStartupPollIntervalMs = 300
} = {}) {
  if (!userDataDir) throw new Error('A Kanafish user-data directory is required for the Qwen TTS cache.')
  if (typeof fetchImpl !== 'function') throw new Error('The local HTTP client is unavailable.')
  const cacheRoot = join(resolve(userDataDir), 'tts-models', runtimeConfig.id)
  const manifestPath = join(cacheRoot, MANIFEST_NAME)
  const runtimeEnv = { ...env }
  let downloadPromise = null
  let serverPromise = null
  let serverProcess = null
  let serverRunning = false
  let serverUrl = null
  let serverToken = null
  let serverLog = ''
  let serverLoadSeconds = null
  let serverBackend = ''
  const verifiedFileSignatures = new Map()

  async function findCommand() {
    for (const candidate of getCodecCppServerCandidates({ env, home, platform, userDataDir })) {
      if (await commandExists(candidate, platform)) return candidate
    }
    return null
  }

  async function inspectRuntime() {
    const path = await findCommand()
    if (!path) return { runtimeFound: false, runtimeReady: false, canDownload: false, runtimePath: '', runtimeError: '' }
    try {
      const { stdout, stderr, code, signal } = await runCommand(path, ['--help'], { spawnImpl, env: runtimeEnv })
      if (code !== 0 || signal) {
        return {
          runtimeFound: true,
          runtimeReady: false,
          canDownload: false,
          runtimePath: path,
          runtimeError: `codec.cpp tts-server --help exited with ${signal || `code ${code}`}.`
        }
      }
      const helpOutput = `${stdout}\n${stderr}`
      const runtimeReady = supportsCodecCppTtsServer(helpOutput)
      return {
        runtimeFound: true,
        runtimeReady,
        canDownload: runtimeReady,
        runtimePath: path,
        runtimeError: runtimeReady ? '' : 'This tts-server build is incompatible. Build codec.cpp from the pinned Kanafish instructions with its OpenAI-compatible WAV server enabled.'
      }
    } catch (error) {
      return { runtimeFound: true, runtimeReady: false, canDownload: false, runtimePath: path, runtimeError: error?.message || 'Could not inspect codec.cpp tts-server.' }
    }
  }

  async function setupRuntime() {
    if (!nativeRuntimeSetup?.setup) throw new Error('In-app codec.cpp setup is unavailable in this Kanafish build.')
    if (downloadPromise) throw new Error('Wait for the Qwen model download to finish before building its runtime.')
    if (serverProcess) await stopServer()
    await nativeRuntimeSetup.setup('codecCpp', async (executable, runCheck) => {
      const { stdout, stderr } = await runCheck(executable, ['--help'])
      if (!supportsCodecCppTtsServer(`${stdout}\n${stderr}`)) throw new Error('The built codec.cpp server did not advertise the required OpenAI-compatible WAV features.')
    })
    const status = await getStatus()
    if (!status.runtimeReady) throw new Error(status.runtimeError || 'The built codec.cpp runtime did not pass Kanafish’s readiness check.')
    return status
  }

  async function cancelRuntimeSetup() {
    return nativeRuntimeSetup?.cancel ? nativeRuntimeSetup.cancel('codecCpp') : { cancelled: false }
  }

  async function readManifest() {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest.id !== runtimeConfig.id || manifest.modelRevision !== runtimeConfig.modelRevision || !Array.isArray(manifest.files)) return null
      const rootPath = await realpath(cacheRoot)
      const files = []
      for (const spec of runtimeConfig.files) {
        const record = manifest.files.find((item) => item.name === spec.name)
        if (!record || record.size !== spec.size || record.sha256 !== spec.sha256) return null
        const path = join(cacheRoot, spec.name)
        const info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size !== spec.size) return null
        const canonical = await realpath(path)
        if (!isPathWithinDirectory(rootPath, canonical)) return null
        const signature = fileSignature(info)
        if (verifiedFileSignatures.get(canonical) !== signature) {
          if ((await hashFile(canonical)) !== spec.sha256) {
            verifiedFileSignatures.delete(canonical)
            return null
          }
          verifiedFileSignatures.set(canonical, signature)
        }
        files.push({ role: spec.role, name: spec.name, path: canonical, bytes: info.size })
      }
      return { ...manifest, files }
    } catch {
      return null
    }
  }

  async function getStatus() {
    const [runtime, manifest, nativeSetup] = await Promise.all([
      inspectRuntime(),
      readManifest(),
      nativeRuntimeSetup?.getStatus ? nativeRuntimeSetup.getStatus('codecCpp') : Promise.resolve(null)
    ])
    return {
      id: runtimeConfig.id,
      name: runtimeConfig.name,
      modelId: runtimeConfig.modelId,
      modelRepo: runtimeConfig.modelRepo,
      modelRevision: runtimeConfig.modelRevision,
      runtimeRepo: runtimeConfig.runtimeRepo,
      runtimeCommitRequired: runtimeConfig.runtimeCommit,
      minimumRuntimeDate: runtimeConfig.minimumRuntimeDate,
      weightsLicense: runtimeConfig.weightsLicense,
      runtimeLicense: runtimeConfig.runtimeLicense,
      approximateBytes: runtimeConfig.approximateBytes,
      totalBytes: manifest?.files.reduce((sum, file) => sum + file.bytes, 0) || 0,
      modelInstalled: Boolean(manifest),
      downloadedAt: manifest?.downloadedAt || '',
      cachePath: cacheRoot,
      voices: runtimeConfig.voices,
      sampleRate: runtimeConfig.sampleRate,
      serverLoadSeconds,
      serverBackend,
      nativeSetup,
      ...runtime
    }
  }

  async function downloadModel() {
    if (downloadPromise) return downloadPromise
    downloadPromise = (async () => {
      const runtime = await inspectRuntime()
      if (!runtime.runtimeFound) throw new Error('codec.cpp tts-server was not found. Build the pinned optional native runtime and restart Kanafish.')
      if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'A compatible codec.cpp tts-server is required before downloading Qwen.')
      await mkdir(cacheRoot, { recursive: true })
      const totalBytes = runtimeConfig.files.reduce((sum, file) => sum + file.size, 0)
      let downloadedBytes = 0
      let completedFiles = 0
      const totalFiles = runtimeConfig.files.length
      for (const spec of runtimeConfig.files) {
        const destination = join(cacheRoot, spec.name)
        if (await verifyPinnedFile(destination, spec, cacheRoot)) {
          downloadedBytes += spec.size
          completedFiles += 1
          onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes, totalBytes, completedFiles, totalFiles, message: `Using verified cached ${spec.name}` })
          continue
        }
        const temporary = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.part`
        const url = `https://huggingface.co/${runtimeConfig.modelRepo}/resolve/${runtimeConfig.modelRevision}/${spec.name}?download=true`
        onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes, totalBytes, completedFiles, totalFiles, message: `Downloading ${spec.name} from the pinned Hugging Face revision…` })
        let handle
        try {
          const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) })
          if (!response.ok || !response.body) throw new Error(`Hugging Face download failed for ${spec.name} (HTTP ${response.status}).`)
          handle = await open(temporary, 'wx')
          const hash = createHash('sha256')
          let fileBytes = 0
          let lastProgress = 0
          for await (const incoming of response.body) {
            const chunk = Buffer.from(incoming)
            hash.update(chunk)
            let offset = 0
            while (offset < chunk.length) {
              const result = await handle.write(chunk, offset, chunk.length - offset, null)
              if (!result.bytesWritten) throw new Error(`Could not write all bytes for ${spec.name}.`)
              offset += result.bytesWritten
            }
            fileBytes += chunk.length
            const now = Date.now()
            if (now - lastProgress >= 250 || fileBytes === spec.size) {
              onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes: downloadedBytes + fileBytes, totalBytes, completedFiles, totalFiles, message: `Downloading ${spec.name}…` })
              lastProgress = now
            }
          }
          await handle.sync()
          await handle.close()
          handle = null
          const sha256 = hash.digest('hex')
          if (fileBytes !== spec.size) throw new Error(`The downloaded ${spec.name} has an unexpected size (${fileBytes} bytes; expected ${spec.size}).`)
          if (sha256 !== spec.sha256) throw new Error(`The downloaded ${spec.name} failed its SHA-256 integrity check.`)
          await unlink(destination).catch(() => {})
          await rename(temporary, destination)
          const verifiedInfo = await lstat(destination)
          verifiedFileSignatures.set(await realpath(destination), fileSignature(verifiedInfo))
          downloadedBytes += fileBytes
          completedFiles += 1
        } catch (error) {
          await handle?.close().catch(() => {})
          await unlink(temporary).catch(() => {})
          throw error
        }
      }
      const manifest = {
        id: runtimeConfig.id,
        modelRepo: runtimeConfig.modelRepo,
        modelRevision: runtimeConfig.modelRevision,
        runtimeRepo: runtimeConfig.runtimeRepo,
        runtimeCommitRequired: runtimeConfig.runtimeCommit,
        downloadedAt: new Date().toISOString(),
        files: runtimeConfig.files.map((file) => ({ role: file.role, name: file.name, size: file.size, sha256: file.sha256 }))
      }
      const temporaryManifest = `${manifestPath}.${process.pid}.tmp`
      await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      if (platform === 'win32') {
        try {
          await unlink(manifestPath)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
      await rename(temporaryManifest, manifestPath)
      onProgress({ modelId: runtimeConfig.id, state: 'complete', file: '', downloadedBytes: totalBytes, totalBytes, completedFiles: totalFiles, totalFiles, message: 'Qwen3-TTS CustomVoice is cached and checksum-verified.' })
      return getStatus()
    })().finally(() => { downloadPromise = null })
    return downloadPromise
  }

  async function launchServer(manifest, runtime, useGpu) {
    const codecPath = manifest.files.find((file) => file.role === 'codec')?.path
    const backbonePath = manifest.files.find((file) => file.role === 'backbone')?.path
    if (!codecPath || !backbonePath) throw new Error('The Qwen cache is missing its codec or backbone GGUF.')
    const port = await choosePort()
    serverUrl = `http://127.0.0.1:${port}`
    serverToken = randomBytes(24).toString('hex')
    serverLog = ''
    const args = ['--model', codecPath, '--backbone', backbonePath, '--host', '127.0.0.1', '--port', String(port), '--api-key', serverToken, '--n-threads', String(getThreadCount(env))]
    if (useGpu) args.push('--gpu')
    onProgress({ modelId: runtimeConfig.id, state: 'starting', message: useGpu ? 'Starting codec.cpp with the macOS GPU backend…' : 'Starting the local codec.cpp CPU service…' })
    const started = performance.now()
    try {
      serverProcess = spawnImpl(runtime.runtimePath, args, { env: runtimeEnv, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      serverRunning = true
    } catch (error) {
      serverProcess = null
      serverRunning = false
      throw error
    }
    const child = serverProcess
    child.stderr?.on('data', (chunk) => { serverLog = `${serverLog}${chunk.toString('utf8')}`.slice(-24_000) })
    let processError = null
    child.on('error', (error) => { processError = error })
    child.on('exit', (code, signal) => {
      serverRunning = false
      if (serverProcess === child) {
        serverProcess = null
        serverUrl = null
        serverToken = null
      }
      if (code !== 0 && code !== null) processError = new Error(`codec.cpp tts-server exited with ${signal || `code ${code}`}${serverLog ? `: ${serverLog.slice(-1800).trim()}` : ''}`)
      else if (code === null && signal) processError = new Error(`codec.cpp tts-server stopped with ${signal}${serverLog ? `: ${serverLog.slice(-1800).trim()}` : ''}`)
    })
    const deadline = Date.now() + serverStartupTimeoutMs
    while (Date.now() < deadline) {
      if (processError) throw processError
      if (!serverRunning) throw new Error(`codec.cpp tts-server exited before becoming ready${serverLog ? `: ${serverLog.slice(-1800).trim()}` : ''}`)
      try {
        const health = await fetchImpl(`${serverUrl}/health`, { signal: AbortSignal.timeout(1500) })
        if (health.ok) {
          const voicesResponse = await fetchImpl(`${serverUrl}/v1/audio/voices`, { headers: { authorization: `Bearer ${serverToken}` }, signal: AbortSignal.timeout(2000) })
          if (!voicesResponse.ok) throw new Error(`codec.cpp voice-list request failed with HTTP ${voicesResponse.status}.`)
          const voiceData = await voicesResponse.json()
          if (!Array.isArray(voiceData.voices) || !voiceData.voices.includes(runtimeConfig.voice)) throw new Error(`This codec.cpp build does not expose the required Japanese preset ${runtimeConfig.voice}. Use the pinned build instructions.`)
          serverLoadSeconds = (performance.now() - started) / 1000
          serverBackend = useGpu ? (platform === 'darwin' ? 'codec.cpp Metal (requested)' : 'codec.cpp GPU') : 'codec.cpp CPU'
          onProgress({ modelId: runtimeConfig.id, state: 'ready', message: 'The local Qwen3-TTS Japanese service is ready.' })
          return serverUrl
        }
      } catch (error) {
        if (error?.message?.includes('required Japanese preset') || error?.message?.includes('voice-list request failed')) throw error
        if (processError) throw processError
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, serverStartupPollIntervalMs))
    }
    throw new Error(`Timed out waiting for codec.cpp to load the Qwen model${serverLog ? `: ${serverLog.slice(-1800).trim()}` : ''}`)
  }

  async function startServer(manifest, runtime) {
    if (serverProcess && serverUrl && serverRunning) return serverUrl
    if (serverPromise) return serverPromise
    serverPromise = (async () => {
      const wantsMetal = platform === 'darwin' && env.KANAFISH_CODEC_CPP_DEVICE !== 'cpu'
      const attempts = wantsMetal ? [true, false] : [false]
      let lastError
      for (const useGpu of attempts) {
        try {
          return await launchServer(manifest, runtime, useGpu)
        } catch (error) {
          lastError = error
          await stopServer()
          if (!useGpu) throw error
          onProgress({ modelId: runtimeConfig.id, state: 'fallback', message: 'The Metal service did not start; retrying with the CPU backend.' })
        }
      }
      throw lastError || new Error('Could not start codec.cpp tts-server.')
    })().finally(() => { serverPromise = null })
    return serverPromise
  }

  async function stopServer() {
    const child = serverProcess
    serverProcess = null
    serverUrl = null
    serverToken = null
    const wasRunning = serverRunning
    serverRunning = false
    if (!child || !wasRunning) return
    child.kill('SIGTERM')
    await new Promise((resolvePromise) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); resolvePromise() }, 3000)
      child.once('exit', () => { clearTimeout(timeout); resolvePromise() })
    })
  }

  async function synthesize(text, { voice = runtimeConfig.voice } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize.')
    if (text.length > MAX_TEXT_CHARS) throw new Error(`Qwen text is limited to ${MAX_TEXT_CHARS} characters per synthesis.`)
    if (String(voice).toLowerCase() !== runtimeConfig.voice) throw new Error(`Qwen CustomVoice supports the Japanese preset ${runtimeConfig.voice}.`)
    const [runtime, manifest] = await Promise.all([inspectRuntime(), readManifest()])
    if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'A compatible codec.cpp tts-server is required for Qwen synthesis.')
    if (!manifest) throw new Error('Download the Qwen3-TTS CustomVoice model in Voice Lab before generating speech.')
    await startServer(manifest, runtime)
    const started = performance.now()
    const response = await fetchImpl(`${serverUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${serverToken}` },
      body: JSON.stringify({ model: runtimeConfig.modelId, input: text.trim(), voice: runtimeConfig.voice, response_format: 'wav' }),
      signal: AbortSignal.timeout(10 * 60 * 1000)
    })
    if (!response.ok) {
      let body = ''
      try { body = await response.text() } catch {}
      throw new Error(responseError(body, `Qwen synthesis failed with HTTP ${response.status}.`))
    }
    const audioBuffer = Buffer.from(await response.arrayBuffer())
    const audioSeconds = wavDurationSeconds(audioBuffer)
    if (!audioSeconds) throw new Error('codec.cpp returned an invalid or empty WAV file.')
    const generationSeconds = (performance.now() - started) / 1000
    return {
      audioBuffer: Uint8Array.from(audioBuffer),
      backend: serverBackend || 'codec.cpp local native runtime',
      voice: runtimeConfig.voice,
      sampleRate: runtimeConfig.sampleRate,
      audioSeconds,
      generationSeconds,
      realTimeFactor: generationSeconds / audioSeconds,
      serverLoadSeconds,
      modelId: runtimeConfig.id
    }
  }

  return Object.freeze({ getStatus, downloadModel, setupRuntime, cancelRuntimeSetup, synthesize, stop: stopServer })
}

export { isPathWithinDirectory }
