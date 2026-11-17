import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { performance } from 'node:perf_hooks'
import { NATIVE_RUNTIME_PLANS } from './nativeRuntimeSetup.js'

export const MAGPIE_RUNTIME = Object.freeze({
  id: 'magpie-v2607',
  name: 'NVIDIA Magpie Multilingual v2607',
  runtimeVersion: '0.3.0',
  weightsLicense: 'NVIDIA Open Model License',
  modelRepo: 'nvidia/magpie_tts_multilingual_357m',
  codecRepo: 'nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps',
  modelRevision: '19806879b16d3f2ccf28fb112b1bcd16a3c7923e',
  codecRevision: 'fc00890b604aa2de298d2641ffc6c5f6caf8c4d7',
  approximateBytes: 668_084_511,
  voices: Object.freeze(['Aria', 'Jason', 'John', 'Leo', 'Sofia'])
})

const REQUIRED_FEATURES = ['http', 'tts', 'tts_japanese']
const MANIFEST_NAME = 'magpie-v2607-manifest.json'
const MAX_TEXT_CHARS = 4000

function withinDirectory(root, target) {
  const base = resolve(root)
  const path = resolve(target)
  const rel = relative(base, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export function parseNemoFeatures(output = '') {
  const match = String(output).match(/^Features:\s*(.*)$/m)
  return match ? match[1].trim().split(/\s+/).filter(Boolean) : []
}

export function parseNemoVersion(output = '') {
  const match = String(output).match(/nemo-speech\s+(\d+)\.(\d+)\.(\d+)/i)
  return match ? match.slice(1).map(Number) : null
}

export function supportsJapaneseHttpTts(versionOutput = '', doctorOutput = '') {
  const version = parseNemoVersion(versionOutput)
  if (!version || compareVersions(version, [0, 3, 0]) < 0) return false
  const features = new Set(parseNemoFeatures(doctorOutput))
  return REQUIRED_FEATURES.every((feature) => features.has(feature))
}

function compareVersions(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0)
    if (difference) return difference
  }
  return 0
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
      dataSize = Math.min(size, Math.max(0, bytes.length - start))
      break
    }
    offset = start + size + (size & 1)
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null
}

export function normalizeMagpieError(error) {
  const message = error?.message || String(error)
  if (/native Magpie tokenizer is not available for language_code ['"]?ja/i.test(message) || /Japanese.*(frontend|tokenizer).*(not available|disabled)/i.test(message)) {
    return 'This NeMo-Speech.cpp build does not include Japanese TTS support. Rebuild it with NEMO_SPEECH_TTS_WITH_JA=ON and HTTP enabled.'
  }
  return message
}

export function getNemoSpeechCandidates({ env = process.env, home = homedir(), platform = process.platform, userDataDir = '' } = {}) {
  const candidates = []
  if (env.KANAFISH_NEMO_SPEECH_PATH) candidates.push(env.KANAFISH_NEMO_SPEECH_PATH)
  const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  if (platform === 'win32') {
    candidates.push(join(localAppData, 'NeMo-Speech', 'bin', 'nemo-speech.exe'))
  } else {
    candidates.push(join(home, '.local', 'bin', 'nemo-speech'))
    candidates.push(join(home, '.local', 'share', 'nemo-speech', 'bin', 'nemo-speech'))
    if (platform === 'darwin') candidates.push(join(home, 'Library', 'Application Support', 'NeMo-Speech', 'bin', 'nemo-speech'))
    candidates.push('/usr/local/bin/nemo-speech', '/opt/homebrew/bin/nemo-speech')
  }
  if (userDataDir) candidates.push(join(userDataDir, 'native-runtimes', 'nemo-speech', NATIVE_RUNTIME_PLANS.nemoSpeech.revision, 'install', 'bin', platform === 'win32' ? 'nemo-speech.exe' : 'nemo-speech'))
  if (env.PATH) {
    for (const entry of env.PATH.split(delimiter)) {
      candidates.push(join(entry, platform === 'win32' ? 'nemo-speech.exe' : 'nemo-speech'))
    }
  }
  return [...new Set(candidates.filter(Boolean))]
}

async function commandExists(path, platform = process.platform) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function runCommand(executable, args, { env, timeoutMs = 120_000, maxOutput = 2_000_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      rejectPromise(error)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const append = (current, chunk) => `${current}${chunk.toString('utf8')}`.slice(-maxOutput)
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      const error = new Error(`NeMo-Speech command timed out after ${Math.round(timeoutMs / 1000)} seconds`)
      error.stdout = stdout
      error.stderr = stderr
      finish(error)
    }, timeoutMs)
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => {
      if (code === 0) finish(null, { stdout, stderr })
      else {
        const error = new Error(`NeMo-Speech exited with ${signal || `code ${code}`}${stderr ? `: ${stderr.trim().slice(-2000)}` : ''}`)
        error.exitCode = code
        error.stdout = stdout
        error.stderr = stderr
        finish(error)
      }
    })
  })
}

function parsePullManifest(stdout) {
  const first = stdout.indexOf('{')
  const last = stdout.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('NeMo-Speech did not return a model-cache manifest.')
  const result = JSON.parse(stdout.slice(first, last + 1))
  if (!Array.isArray(result.artifacts)) throw new Error('NeMo-Speech returned an invalid model-cache manifest.')
  return result.artifacts
}

async function measurePath(path) {
  const info = await stat(path)
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  const entries = await readdir(path, { withFileTypes: true })
  let total = 0
  for (const entry of entries) total += await measurePath(join(path, entry.name))
  return total
}

export function isPinnedMagpieArtifactPath(role, path) {
  if (typeof path !== 'string') return false
  const revision = role === 'codec'
    ? MAGPIE_RUNTIME.codecRevision
    : role === 'tts' || role === 'tokenizer' ? MAGPIE_RUNTIME.modelRevision : null
  return Boolean(revision && path.split(/[\\/]/).includes(revision))
}

async function validateArtifacts(cacheRoot, artifacts) {
  const expected = new Set(['tts', 'tokenizer', 'codec'])
  const safeArtifacts = []
  for (const role of expected) {
    const artifact = artifacts.find((item) => item.role === role)
    if (!artifact || typeof artifact.path !== 'string' || !isAbsolute(artifact.path)) throw new Error(`NeMo-Speech pull did not include the required ${role} artifact.`)
    const expectedRepo = role === 'codec' ? MAGPIE_RUNTIME.codecRepo : MAGPIE_RUNTIME.modelRepo
    if (artifact.repo && artifact.repo !== expectedRepo) throw new Error(`NeMo-Speech returned an unexpected ${role} model repository.`)
    const canonical = await realpath(artifact.path)
    const canonicalRoot = await realpath(cacheRoot)
    if (!withinDirectory(canonicalRoot, canonical)) throw new Error('NeMo-Speech returned an artifact outside Kanafish’s Magpie cache.')
    if (!isPinnedMagpieArtifactPath(role, canonical)) {
      const expectedRevision = role === 'codec' ? MAGPIE_RUNTIME.codecRevision : MAGPIE_RUNTIME.modelRevision
      throw new Error(`The NeMo-Speech model index returned an unpinned ${role} artifact; expected revision ${expectedRevision}. Use a runtime whose Magpie index resolves to Kanafish’s pinned revisions.`)
    }
    const info = await stat(canonical)
    if ((role === 'tokenizer' && !info.isDirectory()) || (role !== 'tokenizer' && !info.isFile())) throw new Error(`The cached Magpie ${role} artifact has an unexpected type.`)
    if (role === 'tokenizer' && (await measurePath(canonical)) === 0) throw new Error('The cached Magpie tokenizer directory is empty.')
    if (role !== 'tokenizer' && info.size === 0) throw new Error(`The cached Magpie ${role} file is empty.`)
    safeArtifacts.push({ role, path: canonical, bytes: await measurePath(canonical), repo: String(artifact.repo || '') })
  }
  return safeArtifacts
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

export function createMagpieRuntime({
  userDataDir,
  env = process.env,
  home = homedir(),
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  onProgress = () => {},
  nativeRuntimeSetup = null
} = {}) {
  if (!userDataDir) throw new Error('A Kanafish user-data directory is required for the Magpie cache.')
  if (typeof fetchImpl !== 'function') throw new Error('The local HTTP client is unavailable.')
  const cacheRoot = join(resolve(userDataDir), 'tts-models', 'nemo-speech')
  const manifestPath = join(cacheRoot, MANIFEST_NAME)
  const runtimeEnv = { ...env, NEMO_SPEECH_MODEL_DIR: cacheRoot }
  let downloadPromise = null
  let serverPromise = null
  let serverProcess = null
  let serverRunning = false
  let serverUrl = null
  let serverToken = null
  let serverLog = ''
  let serverLoadSeconds = null

  async function findCommand() {
    for (const candidate of getNemoSpeechCandidates({ env, home, platform, userDataDir })) {
      if (await commandExists(candidate, platform)) return candidate
    }
    return null
  }

  async function readManifest() {
    try {
      const content = JSON.parse(await readFile(manifestPath, 'utf8'))
      const artifacts = await validateArtifacts(cacheRoot, content.artifacts || [])
      return { ...content, artifacts }
    } catch {
      return null
    }
  }

  async function inspectRuntime() {
    const path = await findCommand()
    if (!path) return { runtimeFound: false, runtimeReady: false, canDownload: false, runtimeVersion: '', features: [], runtimePath: '' }
    try {
      const [{ stdout: versionOutput, stderr: versionError }, { stdout: doctorOutput, stderr: doctorError }] = await Promise.all([
        runCommand(path, ['--version'], { env: runtimeEnv, timeoutMs: 10_000 }),
        runCommand(path, ['doctor'], { env: runtimeEnv, timeoutMs: 20_000 })
      ])
      const version = parseNemoVersion(versionOutput || versionError)
      const features = parseNemoFeatures(doctorOutput || doctorError)
      const runtimeReady = supportsJapaneseHttpTts(versionOutput || versionError, doctorOutput || doctorError)
      return {
        runtimeFound: true,
        runtimeReady,
        canDownload: runtimeReady && features.includes('model_pull'),
        runtimeVersion: version ? version.join('.') : '',
        features,
        runtimePath: path
      }
    } catch (error) {
      return { runtimeFound: true, runtimeReady: false, canDownload: false, runtimeVersion: '', features: [], runtimePath: path, runtimeError: normalizeMagpieError(error) }
    }
  }

  async function getStatus() {
    const [runtime, manifest, nativeSetup] = await Promise.all([
      inspectRuntime(),
      readManifest(),
      nativeRuntimeSetup?.getStatus ? nativeRuntimeSetup.getStatus('nemoSpeech') : Promise.resolve(null)
    ])
    const totalBytes = manifest?.artifacts?.reduce((sum, item) => sum + item.bytes, 0) || 0
    return {
      id: MAGPIE_RUNTIME.id,
      name: MAGPIE_RUNTIME.name,
      weightsLicense: MAGPIE_RUNTIME.weightsLicense,
      approximateBytes: MAGPIE_RUNTIME.approximateBytes,
      totalBytes,
      modelInstalled: Boolean(manifest),
      modelRevision: MAGPIE_RUNTIME.modelRevision,
      cachePath: cacheRoot,
      voices: MAGPIE_RUNTIME.voices,
      nativeSetup,
      ...runtime
    }
  }

  async function setupRuntime() {
    if (!nativeRuntimeSetup?.setup) throw new Error('In-app NeMo-Speech.cpp setup is unavailable in this Kanafish build.')
    if (downloadPromise) throw new Error('Wait for the Magpie model download to finish before building its runtime.')
    if (serverProcess) await stopServer()
    await nativeRuntimeSetup.setup('nemoSpeech', async (executable, runCheck) => {
      const [version, doctor] = await Promise.all([
        runCheck(executable, ['--version']),
        runCheck(executable, ['doctor'])
      ])
      const versionOutput = version.stdout || version.stderr
      const doctorOutput = doctor.stdout || doctor.stderr
      if (!supportsJapaneseHttpTts(versionOutput, doctorOutput)) throw new Error('The built NeMo runtime did not report version 0.3.0+ with HTTP, TTS, and Japanese TTS enabled.')
      if (!parseNemoFeatures(doctorOutput).includes('model_pull')) throw new Error('This NeMo build cannot download Magpie model files; model_pull support is required.')
    })
    const status = await getStatus()
    if (!status.runtimeReady || !status.canDownload) throw new Error(status.runtimeError || 'The built NeMo runtime did not pass Kanafish’s Magpie readiness check.')
    return status
  }

  async function cancelRuntimeSetup() {
    return nativeRuntimeSetup?.cancel ? nativeRuntimeSetup.cancel('nemoSpeech') : { cancelled: false }
  }

  async function downloadModel() {
    if (downloadPromise) return downloadPromise
    downloadPromise = (async () => {
      const runtime = await inspectRuntime()
      if (!runtime.runtimeFound) throw new Error('NeMo-Speech.cpp was not found. Install the native runtime and restart Kanafish.')
      if (!runtime.runtimeReady) throw new Error('Magpie requires NeMo-Speech.cpp 0.3.0 or newer with HTTP, TTS, and tts_japanese build features.')
      if (!runtime.canDownload) throw new Error('This NeMo-Speech.cpp build cannot download models. Install a build that includes model_pull.')
      await mkdir(cacheRoot, { recursive: true })
      onProgress({ modelId: MAGPIE_RUNTIME.id, state: 'downloading', message: 'Downloading Magpie, its Japanese tokenizer and NanoCodec (about 637 MiB)…' })
      const result = await runCommand(runtime.runtimePath, ['--json', 'pull', 'magpie'], { env: runtimeEnv, timeoutMs: 30 * 60 * 1000, maxOutput: 4_000_000 })
      const artifacts = await validateArtifacts(cacheRoot, parsePullManifest(result.stdout))
      const manifest = {
        id: MAGPIE_RUNTIME.id,
        runtimeVersion: runtime.runtimeVersion,
        modelRevision: MAGPIE_RUNTIME.modelRevision,
        codecRevision: MAGPIE_RUNTIME.codecRevision,
        downloadedAt: new Date().toISOString(),
        artifacts
      }
      const temporary = `${manifestPath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await rename(temporary, manifestPath)
      onProgress({ modelId: MAGPIE_RUNTIME.id, state: 'complete', message: 'Magpie model stack is cached locally.' })
      return getStatus()
    })().finally(() => { downloadPromise = null })
    return downloadPromise
  }

  async function startServer(manifest, runtime) {
    if (serverProcess && serverUrl && serverRunning) return serverUrl
    if (serverPromise) return serverPromise
    serverPromise = (async () => {
      const rolePath = (role) => manifest.artifacts.find((artifact) => artifact.role === role)?.path
      const ttsPath = rolePath('tts')
      const codecPath = rolePath('codec')
      const tokenizerPath = rolePath('tokenizer')
      if (!ttsPath || !codecPath || !tokenizerPath) throw new Error('The Magpie cache is missing a model, tokenizer, or codec file.')
      const port = await choosePort()
      serverUrl = `http://127.0.0.1:${port}`
      serverToken = randomBytes(24).toString('hex')
      const args = [
        'serve', '--host', '127.0.0.1', '--port', String(port), '--no-ui',
        '--tts-model', ttsPath, '--codec-model', codecPath, '--tokenizer-dir', tokenizerPath,
        '--device', 'auto', '--tts.language-code', 'ja', '--tts.voice-name', 'Aria', '--api-key', serverToken
      ]
      onProgress({ modelId: MAGPIE_RUNTIME.id, state: 'starting', message: 'Starting the local Japanese speech service. The first model load can take a little while…' })
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
        if (code === 0) return
        processError = new Error(`NeMo-Speech server exited with ${signal || `code ${code}`}${serverLog ? `: ${serverLog.slice(-1800).trim()}` : ''}`)
      })
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        if (processError) throw processError
        try {
          const response = await fetchImpl(`${serverUrl}/ready`, { signal: AbortSignal.timeout(2_000) })
          if (response.ok) {
            const ready = await response.json()
            if (ready.ready && ready.capabilities?.some((capability) => capability === 'tts' || capability === 'speech')) {
              serverLoadSeconds = (performance.now() - started) / 1000
              onProgress({ modelId: MAGPIE_RUNTIME.id, state: 'ready', message: 'Local Magpie service is ready.' })
              return serverUrl
            }
          }
        } catch (error) {
          if (processError) throw processError
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
      }
      throw new Error(`Timed out waiting for the Magpie service to load${serverLog ? `: ${serverLog.slice(-1800).trim()}` : ''}`)
    })().catch(async (error) => {
      await stopServer()
      throw error
    }).finally(() => { serverPromise = null })
    return serverPromise
  }

  async function stopServer() {
    const child = serverProcess
    serverProcess = null
    serverUrl = null
    serverToken = null
    const wasRunning = serverRunning
    serverRunning = false
    if (child && wasRunning) {
      child.kill('SIGTERM')
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL')
          resolvePromise()
        }, 3_000)
        child.once('exit', () => { clearTimeout(timeout); resolvePromise() })
      })
    }
  }

  async function synthesize(text, { voice = 'Aria' } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize.')
    if (text.length > MAX_TEXT_CHARS) throw new Error(`Magpie text is limited to ${MAX_TEXT_CHARS} characters per synthesis.`)
    const normalizedVoice = MAGPIE_RUNTIME.voices.find((item) => item.toLowerCase() === String(voice).toLowerCase())
    if (!normalizedVoice) throw new Error(`Choose one of the supported Magpie voices: ${MAGPIE_RUNTIME.voices.join(', ')}.`)
    const [runtime, manifest] = await Promise.all([inspectRuntime(), readManifest()])
    if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'A NeMo-Speech.cpp build with Japanese TTS and HTTP support is required.')
    if (!manifest) throw new Error('Download the Magpie model stack in Voice Lab before generating speech.')
    await startServer(manifest, runtime)
    const started = performance.now()
    try {
      const response = await fetchImpl(`${serverUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${serverToken}` },
        body: JSON.stringify({ input: text.trim(), language: 'ja', voice: normalizedVoice, response_format: 'wav' }),
        signal: AbortSignal.timeout(300_000)
      })
      if (!response.ok) {
        let body = ''
        try { body = await response.text() } catch {}
        let detail = body
        try { detail = JSON.parse(body)?.error?.message || body } catch {}
        throw new Error(detail || `Magpie synthesis failed with HTTP ${response.status}.`)
      }
      const audioBuffer = Buffer.from(await response.arrayBuffer())
      const audioSeconds = wavDurationSeconds(audioBuffer)
      if (!audioSeconds) throw new Error('Magpie returned an invalid or empty WAV file.')
      const generationSeconds = (performance.now() - started) / 1000
      return {
        audioBuffer: Uint8Array.from(audioBuffer),
        backend: 'NeMo-Speech.cpp local native runtime',
        voice: normalizedVoice,
        sampleRate: 22_050,
        audioSeconds,
        generationSeconds,
        realTimeFactor: generationSeconds / audioSeconds,
        serverLoadSeconds,
        modelId: MAGPIE_RUNTIME.id
      }
    } catch (error) {
      throw new Error(normalizeMagpieError(error))
    }
  }

  return Object.freeze({ getStatus, downloadModel, setupRuntime, cancelRuntimeSetup, synthesize, stop: stopServer })
}

export { withinDirectory as isPathWithinDirectory }
