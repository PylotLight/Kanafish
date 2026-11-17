import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, lstat, mkdir, open, readFile, realpath, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { availableParallelism, cpus, homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

export const IRODORI_TTS_RUNTIME = Object.freeze({
  id: 'irodori-v4.1-small',
  name: 'Irodori-TTS v4.1-Small',
  modelRepo: 'Aratako/Irodori-TTS-v4.1-Small',
  modelRevision: '2b28324dc263ed5e6638b3cf3dd94c82ead07b4b',
  sourceRepo: 'Aratako/Irodori-TTS',
  sourceCommit: '382205679ebc32295b7d1bfb329327d04c8f4eed',
  codecRepo: 'Aratako/Semantic-DACVAE-Japanese-32dim',
  codecRevision: '47376ee24834d7a05a48ebabfe3cde29b3c5e214',
  weightsLicense: 'MIT',
  codeLicense: 'MIT',
  codecLicense: 'MIT',
  approximateBytes: 3_500_634_824,
  sampleRate: 48_000,
  files: Object.freeze([
    Object.freeze({ role: 'checkpoint', name: 'model.safetensors', repo: 'Aratako/Irodori-TTS-v4.1-Small', revision: '2b28324dc263ed5e6638b3cf3dd94c82ead07b4b', size: 3_064_295_596, sha256: 'c85de88c01700cb53538e706f128ebcb1b8513ad21d7d0e75f58bc82cdbf89f6' }),
    Object.freeze({ role: 'tokenizer', name: 'tokenizer/tokenizer.json', repo: 'Aratako/Irodori-TTS-v4.1-Small', revision: '2b28324dc263ed5e6638b3cf3dd94c82ead07b4b', size: 6_718_495, sha256: '6a0734cf21c802169defaffe719bc2ef12bb9d0be37e54b61ed27aa89394723d' }),
    Object.freeze({ role: 'tokenizer-config', name: 'tokenizer/tokenizer_config.json', repo: 'Aratako/Irodori-TTS-v4.1-Small', revision: '2b28324dc263ed5e6638b3cf3dd94c82ead07b4b', size: 668, sha256: 'd229a271c64de1a7939d20d3665498e873fa91d5ee2edf135d73ec752cb9c9d3' }),
    Object.freeze({ role: 'codec', name: 'codec/weights.pth', repo: 'Aratako/Semantic-DACVAE-Japanese-32dim', revision: '47376ee24834d7a05a48ebabfe3cde29b3c5e214', size: 429_620_065, sha256: 'db120339c5ee7eca1912cdf29bc612b947a0808e69c3cebfb4936b45a762c1d5' })
  ])
})

const MANIFEST_NAME = 'irodori-v4.1-small-manifest.json'
const MAX_TEXT_CHARS = 1200
const MAX_RESPONSE_LINE_BYTES = 15 * 1024 * 1024
const MAX_COMMAND_OUTPUT = 64_000
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000
const PYTHON_VERSION_CHECK = 'import json,sys; print(json.dumps({"version": list(sys.version_info[:3])}))'
const PYTHON_RUNTIME_CHECK = 'import json,sys,torch,torchaudio,transformers,safetensors,soundfile; from irodori_tts.inference_runtime import InferenceRuntime; print(json.dumps({"version": list(sys.version_info[:3]), "torch": torch.__version__, "runtime": InferenceRuntime.__name__, "mps": bool(getattr(getattr(torch,"backends",None),"mps",None) and torch.backends.mps.is_available())}))'

function isPathWithinDirectory(root, target) {
  const base = resolve(root)
  const path = resolve(target)
  const rel = relative(base, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function fileSignature(info) {
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`
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

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function commandExists(path, platform) {
  return stat(path).then(async (info) => {
    if (!info.isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  }).catch(() => false)
}

function runCommand(executable, args, { spawnImpl, env, timeoutMs = 15_000, onOutput = () => {} } = {}) {
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
    let lastProgress = 0
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
      finish(new Error(`Python runtime command timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, chunk)
      const now = Date.now()
      if (now - lastProgress > 700) { onOutput(chunk.toString('utf8').trim().slice(-300)); lastProgress = now }
    })
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, chunk)
      const now = Date.now()
      if (now - lastProgress > 700) { onOutput(chunk.toString('utf8').trim().slice(-300)); lastProgress = now }
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => finish(null, { stdout, stderr, code, signal }))
  })
}

function getPythonCommandCandidates({ env, home, platform }) {
  const candidates = []
  const override = env.KANAFISH_IRODORI_PYTHON
  if (override) candidates.push(override)
  const pathValue = env.PATH || env.Path || ''
  const names = platform === 'win32' ? ['python.exe', 'python3.exe', 'python'] : ['python3', 'python']
  for (const name of names) {
    for (const folder of pathValue.split(delimiter).filter(Boolean)) candidates.push(join(folder, name))
  }
  if (platform === 'darwin') candidates.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3')
  if (platform !== 'win32') candidates.push(join(home, '.local', 'bin', 'python3'))
  return [...new Set(candidates.filter(Boolean))]
}

function getPythonEnvExecutable(venvRoot, platform) {
  return platform === 'win32' ? join(venvRoot, 'Scripts', 'python.exe') : join(venvRoot, 'bin', 'python')
}

async function getCompatiblePython({ env, home, platform, spawnImpl }) {
  for (const candidate of getPythonCommandCandidates({ env, home, platform })) {
    if (!(await commandExists(candidate, platform))) continue
    try {
      const result = await runCommand(candidate, ['-c', PYTHON_VERSION_CHECK], { spawnImpl, env, timeoutMs: 5000 })
      if (result.code !== 0) continue
      const info = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
      const [major, minor] = info.version || []
      if (major === 3 && minor >= 10 && minor <= 13) return { path: candidate, version: info.version.join('.') }
    } catch {}
  }
  return null
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

async function fileStatOrNull(path) {
  try { return await lstat(path) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function relativeCachePath(spec) {
  return spec.name.split('/').join(sep)
}

function assetRootDefault() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  return moduleDirectory.endsWith(`${sep}tts`) ? moduleDirectory : join(moduleDirectory, 'tts')
}

export function createIrodoriRuntime({
  userDataDir,
  env = process.env,
  home = homedir(),
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  onProgress = () => {},
  runtimeConfig = IRODORI_TTS_RUNTIME,
  assetRoot = assetRootDefault(),
  pythonEnvRoot: pythonEnvRootOverride,
  pythonExecutable: pythonExecutableOverride
} = {}) {
  if (!userDataDir) throw new Error('A Kanafish user-data directory is required for the Irodori cache.')
  if (typeof fetchImpl !== 'function') throw new Error('The local HTTP client is unavailable.')
  const cacheRoot = join(resolve(userDataDir), 'tts-models', runtimeConfig.id)
  const manifestPath = join(cacheRoot, MANIFEST_NAME)
  const pythonEnvRoot = pythonEnvRootOverride || join(resolve(userDataDir), 'tts-runtimes', runtimeConfig.id, 'venv')
  const pythonEnvExecutable = pythonExecutableOverride || getPythonEnvExecutable(pythonEnvRoot, platform)
  const sidecarPath = join(assetRoot, 'irodori_sidecar.py')
  const vendorPath = join(assetRoot, 'vendor')
  const requirementsPath = join(assetRoot, 'irodori-requirements.txt')
  const appEnv = { ...env }
  let downloadPromise = null
  let setupPromise = null
  let sidecarStartPromise = null
  let sidecarProcess = null
  let sidecarReady = false
  let sidecarReadyData = null
  let sidecarBackend = ''
  let sidecarLoadSeconds = null
  let sidecarLog = ''
  let stdoutBuffer = ''
  let requestSequence = 0
  let pendingRequests = new Map()
  let verifiedFileSignatures = new Map()

  async function inspectPythonRuntime() {
    const runtimeExists = await commandExists(pythonEnvExecutable, platform)
    if (runtimeExists) {
      try {
        const pythonPathValue = appEnv.PYTHONPATH ? `${vendorPath}${delimiter}${appEnv.PYTHONPATH}` : vendorPath
        const result = await runCommand(pythonEnvExecutable, ['-c', PYTHON_RUNTIME_CHECK], { spawnImpl, env: { ...appEnv, PYTHONPATH: pythonPathValue }, timeoutMs: 30_000 })
        if (result.code === 0) {
          const details = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
          const [major, minor] = details.version || []
          const compatible = major === 3 && minor >= 10 && minor <= 13
          return {
            pythonFound: true,
            pythonEnvironmentExists: true,
            pythonVersion: details.version?.join('.') || '',
            pythonEnvironmentPath: pythonEnvRoot,
            runtimeReady: compatible,
            mpsAvailable: Boolean(details.mps),
            runtimeError: compatible ? '' : 'The isolated environment needs Python 3.10–3.13.'
          }
        }
        return { pythonFound: true, pythonEnvironmentExists: true, pythonVersion: '', pythonEnvironmentPath: pythonEnvRoot, runtimeReady: false, mpsAvailable: false, runtimeError: (result.stderr || result.stdout || 'Required Irodori packages are missing.').slice(-1800) }
      } catch (error) {
        return { pythonFound: true, pythonEnvironmentExists: true, pythonVersion: '', pythonEnvironmentPath: pythonEnvRoot, runtimeReady: false, mpsAvailable: false, runtimeError: error?.message || 'Could not inspect the isolated Irodori environment.' }
      }
    }
    const bootstrap = await getCompatiblePython({ env, home, platform, spawnImpl })
    return {
      pythonFound: Boolean(bootstrap),
      pythonEnvironmentExists: false,
      pythonVersion: bootstrap?.version || '',
      pythonEnvironmentPath: pythonEnvRoot,
      runtimeReady: false,
      mpsAvailable: false,
      pythonSetupAvailable: Boolean(bootstrap),
      runtimeError: bootstrap ? 'Irodori’s isolated Python environment has not been set up yet.' : 'Install Python 3.10–3.13 to set up this optional Irodori runtime. Python is not required for the other Kanafish speech engines.'
    }
  }

  async function readManifest() {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest.id !== runtimeConfig.id || manifest.modelRevision !== runtimeConfig.modelRevision || manifest.codecRevision !== runtimeConfig.codecRevision || !Array.isArray(manifest.files)) return null
      const rootPath = await realpath(cacheRoot)
      const files = []
      for (const spec of runtimeConfig.files) {
        const record = manifest.files.find((item) => item.name === spec.name)
        if (!record || record.size !== spec.size || record.sha256 !== spec.sha256) return null
        const path = join(cacheRoot, relativeCachePath(spec))
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
        files.push({ role: spec.role, name: spec.name, path: canonical, size: info.size, sha256: spec.sha256 })
      }
      return { ...manifest, files }
    } catch {
      return null
    }
  }

  async function getStatus() {
    const [python, manifest] = await Promise.all([inspectPythonRuntime(), readManifest()])
    const totalBytes = runtimeConfig.files.reduce((sum, file) => sum + file.size, 0)
    const installed = Boolean(manifest)
    const files = await Promise.all(runtimeConfig.files.map(async (spec) => {
      const path = join(cacheRoot, relativeCachePath(spec))
      const record = manifest?.files.find((item) => item.name === spec.name)
      if (record) return { role: spec.role, name: spec.name, size: spec.size, sha256: spec.sha256, downloaded: true, downloadedBytes: record.size }
      const downloaded = await verifyPinnedFile(path, spec, cacheRoot)
      if (!downloaded) return { role: spec.role, name: spec.name, size: spec.size, sha256: spec.sha256, downloaded: false, downloadedBytes: 0 }
      const info = await lstat(path)
      verifiedFileSignatures.set(await realpath(path), fileSignature(info))
      return { role: spec.role, name: spec.name, size: spec.size, sha256: spec.sha256, downloaded: true, downloadedBytes: info.size }
    }))
    return {
      id: runtimeConfig.id,
      name: runtimeConfig.name,
      modelRepo: runtimeConfig.modelRepo,
      modelRevision: runtimeConfig.modelRevision,
      sourceRepo: runtimeConfig.sourceRepo,
      sourceCommit: runtimeConfig.sourceCommit,
      codecRepo: runtimeConfig.codecRepo,
      codecRevision: runtimeConfig.codecRevision,
      weightsLicense: runtimeConfig.weightsLicense,
      codeLicense: runtimeConfig.codeLicense,
      codecLicense: runtimeConfig.codecLicense,
      approximateBytes: totalBytes,
      totalBytes: installed ? totalBytes : 0,
      downloadedBytes: files.reduce((sum, file) => sum + file.downloadedBytes, 0),
      files,
      modelInstalled: installed,
      downloadedAt: manifest?.downloadedAt || '',
      cachePath: cacheRoot,
      pythonEnvironmentPath: pythonEnvRoot,
      pythonSetupAvailable: Boolean(python.pythonSetupAvailable || python.runtimeReady),
      pythonEnvironmentExists: Boolean(python.pythonEnvironmentExists),
      pythonFound: python.pythonFound,
      pythonVersion: python.pythonVersion,
      runtimeReady: python.runtimeReady,
      runtimeError: python.runtimeError,
      mpsAvailable: python.mpsAvailable,
      sidecarRunning: sidecarReady,
      sidecarBackend,
      sidecarLoadSeconds
    }
  }

  async function ensureSpaceForDownload(bytesNeeded) {
    let info
    try { info = await statfs(cacheRoot) } catch {
      await mkdir(cacheRoot, { recursive: true })
      info = await statfs(cacheRoot)
    }
    const availableBytes = Number(info.bavail) * Number(info.bsize)
    if (availableBytes < bytesNeeded + 128 * 1024 * 1024) {
      throw new Error(`Not enough free disk space for Irodori. At least ${Math.ceil((bytesNeeded + 128 * 1024 * 1024) / 1_000_000_000)} GB is needed including a temporary safety margin.`)
    }
  }

  async function downloadModel() {
    if (downloadPromise) return downloadPromise
    downloadPromise = (async () => {
      await mkdir(cacheRoot, { recursive: true })
      const initialManifest = await readManifest()
      const alreadyPresent = new Set(initialManifest?.files.map((file) => file.name) || [])
      for (const spec of runtimeConfig.files) {
        if (alreadyPresent.has(spec.name)) continue
        const path = join(cacheRoot, relativeCachePath(spec))
        if (await verifyPinnedFile(path, spec, cacheRoot)) {
          alreadyPresent.add(spec.name)
          const info = await lstat(path)
          verifiedFileSignatures.set(await realpath(path), fileSignature(info))
        } else {
          await rm(path, { force: true }).catch(() => {})
        }
      }
      const missing = runtimeConfig.files.filter((file) => !alreadyPresent.has(file.name))
      const missingBytes = missing.reduce((sum, file) => sum + file.size, 0)
      if (missingBytes > 0) await ensureSpaceForDownload(missingBytes)
      let downloadedBytes = alreadyPresent.size ? runtimeConfig.files.filter((file) => alreadyPresent.has(file.name)).reduce((sum, file) => sum + file.size, 0) : 0
      let completedFiles = alreadyPresent.size
      const totalBytes = runtimeConfig.files.reduce((sum, file) => sum + file.size, 0)
      const totalFiles = runtimeConfig.files.length
      onProgress({ modelId: runtimeConfig.id, state: 'downloading', downloadedBytes, totalBytes, completedFiles, totalFiles, message: 'Preparing the pinned Irodori model, tokenizer and codec cache…' })
      for (const spec of runtimeConfig.files) {
        if (alreadyPresent.has(spec.name)) continue
        const destination = join(cacheRoot, relativeCachePath(spec))
        await mkdir(dirname(destination), { recursive: true })
        const temporary = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.part`
        const url = `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${spec.name}?download=true`
        onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes, totalBytes, completedFiles, totalFiles, message: `Downloading pinned ${spec.name}…` })
        let handle
        try {
          const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(45 * 60 * 1000) })
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
          if (fileBytes !== spec.size) throw new Error(`Downloaded size mismatch for ${spec.name}: expected ${spec.size}, got ${fileBytes}.`)
          if (hash.digest('hex') !== spec.sha256) throw new Error(`SHA-256 verification failed for ${spec.name}.`)
          await rm(destination, { force: true })
          await rename(temporary, destination)
          const info = await lstat(destination)
          verifiedFileSignatures.set(await realpath(destination), fileSignature(info))
          downloadedBytes += fileBytes
          completedFiles += 1
        } catch (error) {
          await handle?.close().catch(() => {})
          await rm(temporary, { force: true }).catch(() => {})
          throw error
        }
      }
      const manifest = {
        id: runtimeConfig.id,
        modelRepo: runtimeConfig.modelRepo,
        modelRevision: runtimeConfig.modelRevision,
        sourceRepo: runtimeConfig.sourceRepo,
        sourceCommit: runtimeConfig.sourceCommit,
        codecRepo: runtimeConfig.codecRepo,
        codecRevision: runtimeConfig.codecRevision,
        downloadedAt: new Date().toISOString(),
        files: runtimeConfig.files.map(({ role, name, size, sha256 }) => ({ role, name, size, sha256 }))
      }
      const temporaryManifest = `${manifestPath}.${process.pid}.tmp`
      await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      if (platform === 'win32') await rm(manifestPath, { force: true })
      await rename(temporaryManifest, manifestPath)
      onProgress({ modelId: runtimeConfig.id, state: 'complete', downloadedBytes: totalBytes, totalBytes, completedFiles: totalFiles, totalFiles, message: 'Irodori v4.1 model, tokenizer and codec are cached and checksum-verified.' })
      return getStatus()
    })().finally(() => { downloadPromise = null })
    return downloadPromise
  }

  function emitProgress(state, message) {
    onProgress({ modelId: runtimeConfig.id, state, message })
  }

  async function setupPythonRuntime() {
    if (setupPromise) return setupPromise
    setupPromise = (async () => {
      await stopSidecar()
      const bootstrap = await getCompatiblePython({ env, home, platform, spawnImpl })
      if (!bootstrap) throw new Error('Python 3.10–3.13 was not found. Install a supported Python version, then select Set up Python runtime again. This setup is optional; other Kanafish engines do not need Python.')
      const requirementsInfo = await stat(requirementsPath).catch(() => null)
      const sidecarInfo = await stat(sidecarPath).catch(() => null)
      if (!requirementsInfo?.isFile() || !sidecarInfo?.isFile()) throw new Error('Kanafish could not find the packaged Irodori sidecar resources.')
      await mkdir(dirname(pythonEnvRoot), { recursive: true })
      if (!(await commandExists(pythonEnvExecutable, platform))) {
        emitProgress('setting-up', `Creating an isolated Python ${bootstrap.version} environment…`)
        const created = await runCommand(bootstrap.path, ['-m', 'venv', pythonEnvRoot], { spawnImpl, env: appEnv, timeoutMs: 120_000 })
        if (created.code !== 0) throw new Error((created.stderr || created.stdout || 'Could not create the isolated Python environment.').slice(-2000))
      }
      const pipPrefix = ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off']
      const torchPackages = platform === 'darwin'
        ? ['torch==2.10.0', 'torchaudio==2.10.0']
        : ['torch==2.10.0+cpu', 'torchaudio==2.10.0+cpu']
      const torchArgs = [...pipPrefix]
      if (platform === 'darwin') torchArgs.push('--index-url', 'https://pypi.org/simple')
      else torchArgs.push('--index-url', 'https://download.pytorch.org/whl/cpu', '--extra-index-url', 'https://pypi.org/simple')
      torchArgs.push(...torchPackages)
      emitProgress('setting-up', 'Installing the pinned PyTorch CPU/MPS backend; this may take several minutes…')
      const installedTorch = await runCommand(pythonEnvExecutable, torchArgs, {
        spawnImpl,
        env: appEnv,
        timeoutMs: COMMAND_TIMEOUT_MS,
        onOutput: (detail) => emitProgress('setting-up', detail || 'Installing PyTorch…')
      })
      if (installedTorch.code !== 0) throw new Error((installedTorch.stderr || installedTorch.stdout || 'Could not install the pinned PyTorch backend.').slice(-2500))
      emitProgress('setting-up', 'Installing Irodori’s pinned inference dependencies…')
      const installedRuntime = await runCommand(pythonEnvExecutable, [...pipPrefix, '-r', requirementsPath], {
        spawnImpl,
        env: appEnv,
        timeoutMs: COMMAND_TIMEOUT_MS,
        onOutput: (detail) => emitProgress('setting-up', detail || 'Installing Irodori dependencies…')
      })
      if (installedRuntime.code !== 0) throw new Error((installedRuntime.stderr || installedRuntime.stdout || 'Could not install Irodori dependencies.').slice(-2500))
      const status = await getStatus()
      if (!status.runtimeReady) throw new Error(status.runtimeError || 'Irodori’s isolated Python environment failed its import check.')
      emitProgress('setup-complete', `Irodori Python runtime is ready (PyTorch ${status.mpsAvailable ? 'MPS available' : 'CPU backend'}).`)
      return status
    })().finally(() => { setupPromise = null })
    return setupPromise
  }

  function rejectPending(error) {
    for (const pending of pendingRequests.values()) pending.reject(error)
    pendingRequests = new Map()
  }

  function handleSidecarMessage(line, child, readyResolve, readyReject) {
    let message
    try { message = JSON.parse(line) } catch {
      const error = new Error('The Irodori sidecar returned invalid JSON.')
      readyReject(error)
      rejectPending(error)
      child.kill('SIGTERM')
      return
    }
    if (message.type === 'progress') {
      emitProgress(message.state || 'running', message.message || 'Irodori sidecar is running…')
      return
    }
    if (message.type === 'ready') {
      sidecarReady = true
      sidecarReadyData = message
      sidecarBackend = message.backend || `Irodori v4.1 · PyTorch ${String(message.device || 'cpu').toUpperCase()}`
      sidecarLoadSeconds = Number(message.loadSeconds) || null
      readyResolve(message)
      return
    }
    if (message.type === 'fatal') {
      const error = new Error(message.error || 'The Irodori sidecar could not start.')
      readyReject(error)
      rejectPending(error)
      child.kill('SIGTERM')
      return
    }
    if (message.type === 'bye') return
    if (message.type === 'result' || message.type === 'error') {
      const pending = pendingRequests.get(message.id)
      if (!pending) return
      pendingRequests.delete(message.id)
      if (message.type === 'error') pending.reject(new Error(message.error || 'Irodori synthesis failed.'))
      else pending.resolve(message)
    }
  }

  async function startSidecar(manifest) {
    if (sidecarProcess && sidecarReady) return sidecarReadyData
    if (sidecarStartPromise) return sidecarStartPromise
    sidecarStartPromise = (async () => {
      const pythonStatus = await inspectPythonRuntime()
      if (!pythonStatus.runtimeReady) throw new Error(pythonStatus.runtimeError || 'Set up the Irodori Python runtime in Voice Lab first.')
      const modelFile = manifest.files.find((file) => file.role === 'checkpoint')?.path
      const codecFile = manifest.files.find((file) => file.role === 'codec')?.path
      if (!modelFile || !codecFile) throw new Error('The Irodori cache is missing its checkpoint or DACVAE codec.')
      const [sidecarStat, vendorStat] = await Promise.all([stat(sidecarPath).catch(() => null), stat(join(vendorPath, 'irodori_tts', 'inference_runtime.py')).catch(() => null)])
      if (!sidecarStat?.isFile() || !vendorStat?.isFile()) throw new Error('The Irodori Python sidecar or pinned upstream runtime source is missing.')
      const currentRuntime = pythonExecutableOverride || pythonEnvExecutable
      const pythonPathValue = appEnv.PYTHONPATH ? `${vendorPath}${delimiter}${appEnv.PYTHONPATH}` : vendorPath
      const childEnv = { ...appEnv, PYTHONPATH: pythonPathValue, TOKENIZERS_PARALLELISM: 'false' }
      emitProgress('starting', 'Starting the private Irodori Python sidecar…')
      const startTime = performance.now()
      let child
      try {
        child = spawnImpl(currentRuntime, [sidecarPath, '--model', modelFile, '--codec', codecFile, '--device', 'auto', '--threads', String(Math.min(8, availableParallelism?.() || cpus().length || 1))], {
          cwd: cacheRoot,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
      } catch (error) {
        throw new Error(`Could not start the Irodori Python sidecar: ${error?.message || error}`)
      }
      sidecarProcess = child
      sidecarReady = false
      sidecarReadyData = null
      sidecarLog = ''
      stdoutBuffer = ''
      const decoder = new StringDecoder('utf8')
      let readyResolve
      let readyReject
      const readyPromise = new Promise((resolvePromise, rejectPromise) => { readyResolve = resolvePromise; readyReject = rejectPromise })
      child.stdout?.on('data', (chunk) => {
        stdoutBuffer += decoder.write(chunk)
        if (Buffer.byteLength(stdoutBuffer) > MAX_RESPONSE_LINE_BYTES && !stdoutBuffer.includes('\n')) {
          const error = new Error('The Irodori sidecar response exceeded the size limit.')
          readyReject(error)
          rejectPending(error)
          child.kill('SIGTERM')
          return
        }
        let newline
        while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
          const line = stdoutBuffer.slice(0, newline)
          stdoutBuffer = stdoutBuffer.slice(newline + 1)
          if (Buffer.byteLength(line) > MAX_RESPONSE_LINE_BYTES) {
            const error = new Error('The Irodori sidecar response exceeded the size limit.')
            readyReject(error)
            rejectPending(error)
            child.kill('SIGTERM')
            return
          }
          if (line) handleSidecarMessage(line, child, readyResolve, readyReject)
        }
      })
      child.stderr?.on('data', (chunk) => { sidecarLog = `${sidecarLog}${chunk.toString('utf8')}`.slice(-16_000) })
      child.on('error', (error) => {
        readyReject(error)
        rejectPending(new Error(`Irodori sidecar process failed: ${error.message}`))
      })
      child.on('exit', (code, signal) => {
        if (sidecarProcess === child) {
          sidecarProcess = null
          sidecarReady = false
          sidecarReadyData = null
        }
        const message = new Error(`Irodori sidecar stopped${signal ? ` with ${signal}` : ` with code ${code}`}${sidecarLog ? `: ${sidecarLog.slice(-1600).trim()}` : ''}`)
        if (!sidecarReady) readyReject(message)
        rejectPending(message)
      })
      const timeout = setTimeout(() => readyReject(new Error('Timed out while loading Irodori v4.1. The local model is large; retry after closing memory-heavy apps.')), 6 * 60 * 1000)
      try {
        const ready = await readyPromise
        clearTimeout(timeout)
        sidecarLoadSeconds = Number(ready.loadSeconds) || (performance.now() - startTime) / 1000
        emitProgress('ready', `Irodori v4.1 is ready on ${String(ready.device || 'CPU').toUpperCase()}.`)
        return ready
      } catch (error) {
        clearTimeout(timeout)
        await stopSidecar()
        throw error
      }
    })().finally(() => { sidecarStartPromise = null })
    return sidecarStartPromise
  }

  async function synthesize(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize.')
    if (text.length > MAX_TEXT_CHARS) throw new Error(`Irodori text is limited to ${MAX_TEXT_CHARS} characters per synthesis.`)
    const manifest = await readManifest()
    if (!manifest) throw new Error('Download the pinned Irodori model and codec in Voice Lab before generating speech.')
    await startSidecar(manifest)
    const id = ++requestSequence
    const response = await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        rejectPromise(new Error('Irodori synthesis timed out after 10 minutes.'))
      }, 10 * 60 * 1000)
      pendingRequests.set(id, {
        resolve: (value) => { clearTimeout(timer); resolvePromise(value) },
        reject: (error) => { clearTimeout(timer); rejectPromise(error) }
      })
      try {
        const line = JSON.stringify({ type: 'synthesize', id, text })
        if (Buffer.byteLength(line) > 16 * 1024) throw new Error('Irodori request exceeds the sidecar message limit.')
        sidecarProcess.stdin.write(`${line}\n`, (error) => {
          if (error) {
            pendingRequests.delete(id)
            clearTimeout(timer)
            rejectPromise(error)
          }
        })
      } catch (error) {
        pendingRequests.delete(id)
        clearTimeout(timer)
        rejectPromise(error)
      }
    })
    if (typeof response.wavBase64 !== 'string' || response.wavBase64.length > MAX_RESPONSE_LINE_BYTES) throw new Error('Irodori sidecar returned a malformed or oversized audio result.')
    const audioBuffer = Buffer.from(response.wavBase64, 'base64')
    const audioSeconds = wavDurationSeconds(audioBuffer)
    if (!audioSeconds) throw new Error('Irodori sidecar returned an invalid or empty WAV file.')
    const sampleRate = Number(response.sampleRate)
    if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) throw new Error('Irodori sidecar returned an unsupported WAV sample rate.')
    return {
      audioBuffer: Uint8Array.from(audioBuffer),
      backend: response.backend || sidecarBackend || 'Irodori v4.1 · PyTorch CPU',
      sampleRate,
      audioSeconds,
      generationSeconds: Number(response.generationSeconds) || 0,
      realTimeFactor: Number.isFinite(Number(response.realTimeFactor)) ? Number(response.realTimeFactor) : null,
      serverLoadSeconds: sidecarLoadSeconds,
      modelId: runtimeConfig.id
    }
  }

  async function stopSidecar() {
    const child = sidecarProcess
    sidecarProcess = null
    sidecarReady = false
    sidecarReadyData = null
    if (!child) return
    try { child.stdin?.write('{"type":"shutdown"}\n') } catch {}
    const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise))
    const timer = new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 2500))
    const result = await Promise.race([exited, timer])
    if (result === 'timeout') {
      child.kill('SIGTERM')
      const killed = await Promise.race([exited, new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 2500))])
      if (killed === 'timeout') child.kill('SIGKILL')
    }
    rejectPending(new Error('Irodori sidecar stopped.'))
    sidecarBackend = ''
    sidecarLoadSeconds = null
  }

  async function removeModelCache() {
    await stopSidecar()
    await rm(cacheRoot, { recursive: true, force: true })
    verifiedFileSignatures.clear()
    return getStatus()
  }

  async function removePythonRuntime() {
    await stopSidecar()
    await rm(dirname(pythonEnvRoot), { recursive: true, force: true })
    return getStatus()
  }

  return Object.freeze({
    getStatus,
    downloadModel,
    setupPythonRuntime,
    synthesize,
    removeModelCache,
    removePythonRuntime,
    stop: stopSidecar
  })
}

export { isPathWithinDirectory }
