import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const RELEASE_BASE = 'https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.54'
const MAX_TEXT_CHARS = 4000
const MAX_COMMAND_OUTPUT = 64_000
const VERSION = '0.8.54'

export const MIOTTS_TTS_RUNTIME = Object.freeze({
  id: 'miotts-0.6b',
  name: 'MioTTS-0.6B',
  modelRepo: 'cstr/miotts-0.6b-GGUF',
  modelRevision: 'fab3cdbef802fb5f1047708c27378c6e34ec230f',
  sourceModelRepo: 'Aratako/MioTTS-0.6B',
  codecModelRepo: 'Aratako/MioCodec-25Hz-44.1kHz-v2',
  runtimeRepo: 'CrispStrobe/CrispASR',
  runtimeVersion: VERSION,
  weightsLicense: 'Apache-2.0',
  codecLicense: 'MIT',
  runtimeLicense: 'MIT',
  voicePresetLicense: 'Non-commercial use only for outputs made with the upstream Japanese presets',
  defaultVoice: 'jp_female',
  voices: Object.freeze(['jp_female', 'jp_male']),
  sampleRate: 44_100,
  approximateBytes: 540_000_888,
  files: Object.freeze([
    Object.freeze({ role: 'model', name: 'miotts-0.6b-q4_k.gguf', size: 526_181_408, sha256: '65e3d4692d377e2483339f52da4ead8afdf6374749bc5cf5ba4b8a8b283d340d' }),
    Object.freeze({ role: 'tokenizer', name: 'tokenizer.json', size: 13_817_944, sha256: 'abcde038b87ccd029a4523b0c5cec1da6d84b4f3d68b351495df086d63033f1f' }),
    Object.freeze({ role: 'voice', voice: 'jp_female', name: 'jp_female.emb.gguf', size: 768, sha256: '1a99490f54aedefc98010ae53101f1cd49fd73a2cfc043e2009e3e2795a1ffdb' }),
    Object.freeze({ role: 'voice', voice: 'jp_male', name: 'jp_male.emb.gguf', size: 768, sha256: '6365e075530afba927e0158c7b834cef987e1a9757b2a5df5080f5022ca68ea6' })
  ])
})

export const MIOTTS_RUNTIME_ASSETS = Object.freeze({
  'linux-x64': Object.freeze({
    name: 'crispasr-linux-x86_64.tar.gz',
    size: 44_185_817,
    sha256: 'a5612bca2dbb096b81972f573ec024a5944d3a63fc18ccd2d9a8489758ddb6f1',
    archiveRoot: 'crispasr-linux-x86_64'
  }),
  'darwin-arm64': Object.freeze({
    name: 'crispasr-macos-arm64.tar.gz',
    size: 18_679_584,
    sha256: '7b04a0ad344293f360636985e26a02efb8ef7f84fa2def991eaa3f4237f105dc',
    archiveRoot: 'crispasr-macos-arm64'
  }),
  'darwin-x64': Object.freeze({
    name: 'crispasr-macos-x86_64.tar.gz',
    size: 19_275_032,
    sha256: 'b1f263696566de64f1a8d36ae4014acf8dcb2c6376431d0cb30a011d7bd7c5c6',
    archiveRoot: 'crispasr-macos-x86_64'
  })
})

function fileSignature(info) {
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`
}

function isPathWithinDirectory(root, target) {
  const base = resolve(root)
  const path = resolve(target)
  const rel = relative(base, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export function getMioRuntimeAsset(platform = process.platform, arch = process.arch, assets = MIOTTS_RUNTIME_ASSETS) {
  return assets[`${platform}-${arch}`] || null
}

export function getMioRuntimeAssetUrl(asset) {
  if (!asset || !Object.values(MIOTTS_RUNTIME_ASSETS).includes(asset) && !/^[a-z0-9][a-z0-9._-]*\.tar\.gz$/i.test(asset.name)) {
    throw new Error('Unknown CrispASR release asset.')
  }
  return `${RELEASE_BASE}/${encodeURIComponent(asset.name)}`
}

export function isSafeMioArchiveListing(listing, expectedRoot) {
  const entries = String(listing).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
  if (!entries.length || !expectedRoot) return false
  return entries.every((entry) => {
    const normalized = entry.replaceAll('\\', '/').replace(/\/+$/, '')
    if (posix.isAbsolute(normalized) || normalized.includes('\0')) return false
    const segments = normalized.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false
    return segments[0] === expectedRoot && posix.normalize(normalized) === normalized.replace(/\/$/, '')
  })
}

export function supportsMioCrispRuntime(versionOutput = '', backendOutput = '', expectedVersion = VERSION) {
  const version = String(versionOutput).match(/^\s*version\s*:\s*([^\s]+)\s*$/im)?.[1]
  if (version !== expectedVersion) return false
  try {
    const data = JSON.parse(String(backendOutput))
    return Array.isArray(data.backends) && data.backends.some((backend) => backend.name === 'miotts' && Array.isArray(backend.caps) && backend.caps.includes('tts'))
  } catch {
    return false
  }
}

export function validateMioWav(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('CrispASR returned an invalid or empty RIFF/WAVE file.')
  }
  const riffEnd = Math.min(bytes.length, bytes.readUInt32LE(4) + 8)
  let format = null
  let dataChunk = null
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const chunkSize = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const available = Math.max(0, Math.min(chunkSize, riffEnd - start))
    if (id === 'fmt ' && available >= 16) {
      format = {
        tag: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14)
      }
    }
    if (id === 'data') dataChunk = { start, size: available }
    const next = start + chunkSize + (chunkSize & 1)
    if (!Number.isSafeInteger(next) || next <= offset || next > riffEnd) break
    offset = next
  }
  if (!format || !dataChunk || format.tag !== 1 || format.channels !== 1 || format.sampleRate !== 44_100 || format.bitsPerSample !== 16 || dataChunk.size < 2) {
    throw new Error('CrispASR did not return the expected mono 44.1 kHz PCM16 MioCodec WAV.')
  }
  let peak = 0
  const sampleCount = Math.floor(dataChunk.size / 2)
  for (let index = 0; index < sampleCount; index += 1) peak = Math.max(peak, Math.abs(bytes.readInt16LE(dataChunk.start + index * 2)))
  if (peak === 0) throw new Error('CrispASR returned a silent WAV file.')
  return {
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    peak,
    audioSeconds: dataChunk.size / (format.sampleRate * format.channels * format.bitsPerSample / 8)
  }
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function safeFileStat(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function runCommand(executable, args, { spawnImpl, env, cwd, timeoutMs = 10_000, onChild = () => {} } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawnImpl(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      rejectPromise(error)
      return
    }
    onChild(child, true)
    let stdout = ''
    let stderr = ''
    let settled = false
    const append = (current, chunk) => `${current}${chunk.toString('utf8')}`.slice(-MAX_COMMAND_OUTPUT)
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onChild(child, false)
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const timer = setTimeout(() => {
      child.kill?.('SIGTERM')
      finish(new Error(`CrispASR command timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => finish(null, { stdout, stderr, code, signal }))
  })
}

async function fileMatches(path, spec, root, verifiedSignatures) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== spec.size) return false
    const [rootPath, filePath] = await Promise.all([realpath(root), realpath(path)])
    if (!isPathWithinDirectory(rootPath, filePath)) return false
    const signature = fileSignature(info)
    if (verifiedSignatures.get(filePath) !== signature) {
      if ((await hashFile(filePath)) !== spec.sha256) {
        verifiedSignatures.delete(filePath)
        return false
      }
      verifiedSignatures.set(filePath, signature)
    }
    return true
  } catch {
    return false
  }
}

function runtimeEnvironment(binaryPath, env, platform) {
  const runtimeEnv = { ...env }
  const libraryDir = dirname(binaryPath)
  if (platform === 'linux') runtimeEnv.LD_LIBRARY_PATH = [libraryDir, runtimeEnv.LD_LIBRARY_PATH].filter(Boolean).join(':')
  if (platform === 'darwin') runtimeEnv.DYLD_LIBRARY_PATH = [libraryDir, runtimeEnv.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
  return runtimeEnv
}

export function createMioRuntime({
  userDataDir,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  onProgress = () => {},
  runtimeConfig = MIOTTS_TTS_RUNTIME,
  runtimeAssets = MIOTTS_RUNTIME_ASSETS,
  runtimeVersion = VERSION
} = {}) {
  if (!userDataDir) throw new Error('A Kanafish user-data directory is required for the MioTTS cache.')
  if (typeof fetchImpl !== 'function') throw new Error('The local HTTP client is unavailable.')

  const appDataRoot = resolve(userDataDir)
  const cacheRoot = join(appDataRoot, 'tts-models', runtimeConfig.id)
  const runtimeBase = join(appDataRoot, 'native-runtimes', 'crispasr')
  const installRoot = join(runtimeBase, `v${runtimeVersion}`)
  const archiveRoot = join(runtimeBase, 'downloads')
  const asset = getMioRuntimeAsset(platform, arch, runtimeAssets)
  let modelDownloadPromise = null
  let runtimeSetupPromise = null
  let synthesisCount = 0
  const activeChildren = new Set()
  const trackChild = (child, active) => {
    if (active) activeChildren.add(child)
    else activeChildren.delete(child)
  }
  const verifiedModelSignatures = new Map()
  const inspectedRuntimeSignatures = new Map()

  function runtimeBinaryPath(root = installRoot) {
    return asset ? join(root, asset.archiveRoot, 'crispasr') : ''
  }

  async function inspectRuntimeAtPath(binaryPath) {
    if (!asset || !binaryPath) return { runtimeFound: false, runtimeReady: false, runtimePath: '', runtimeVersion: '', runtimeError: '' }
    try {
      const info = await lstat(binaryPath)
      if (!info.isFile() || info.isSymbolicLink()) return { runtimeFound: false, runtimeReady: false, runtimePath: binaryPath, runtimeVersion: '', runtimeError: '' }
      await access(binaryPath, constants.X_OK)
      const canonical = await realpath(binaryPath)
      if (!isPathWithinDirectory(await realpath(installRoot), canonical)) return { runtimeFound: false, runtimeReady: false, runtimePath: binaryPath, runtimeVersion: '', runtimeError: 'The CrispASR runtime path is outside its app-managed install directory.' }
      const signature = fileSignature(info)
      const cached = inspectedRuntimeSignatures.get(canonical)
      if (cached?.signature === signature) return cached.result

      const envForRuntime = runtimeEnvironment(binaryPath, env, platform)
      const [versionResult, backendsResult] = await Promise.all([
        runCommand(binaryPath, ['--version'], { spawnImpl, env: envForRuntime, cwd: dirname(binaryPath), onChild: trackChild }),
        runCommand(binaryPath, ['--list-backends-json'], { spawnImpl, env: envForRuntime, cwd: dirname(binaryPath), onChild: trackChild })
      ])
      const versionOutput = `${versionResult.stdout}\n${versionResult.stderr}`
      const backendOutput = `${backendsResult.stdout}\n${backendsResult.stderr}`
      const version = versionOutput.match(/^\s*version\s*:\s*([^\s]+)\s*$/im)?.[1] || ''
      const ready = versionResult.code === 0 && backendsResult.code === 0 && supportsMioCrispRuntime(versionOutput, backendOutput, runtimeVersion)
      const result = {
        runtimeFound: true,
        runtimeReady: ready,
        runtimePath: binaryPath,
        runtimeVersion: version,
        runtimeError: ready ? '' : `CrispASR ${version || 'unknown'} is missing the pinned ${runtimeVersion} MioTTS backend or its TTS capability.`
      }
      inspectedRuntimeSignatures.set(canonical, { signature, result })
      return result
    } catch (error) {
      return { runtimeFound: false, runtimeReady: false, runtimePath: binaryPath, runtimeVersion: '', runtimeError: error?.message || 'Could not inspect the app-managed CrispASR runtime.' }
    }
  }

  async function inspectRuntime() {
    if (!asset) return { runtimeFound: false, runtimeReady: false, runtimePath: '', runtimeVersion: '', runtimeError: `No pinned CrispASR release is available for ${platform}-${arch}.` }
    return inspectRuntimeAtPath(runtimeBinaryPath())
  }

  async function getStatus() {
    const [runtime, fileStatuses] = await Promise.all([
      inspectRuntime(),
      Promise.all(runtimeConfig.files.map(async (spec) => {
        const path = join(cacheRoot, spec.name)
        const downloaded = await fileMatches(path, spec, cacheRoot, verifiedModelSignatures)
        return { role: spec.role, voice: spec.voice || '', name: spec.name, size: spec.size, downloaded, downloadedBytes: downloaded ? spec.size : 0 }
      }))
    ])
    const totalBytes = runtimeConfig.files.reduce((sum, file) => sum + file.size, 0)
    const downloadedBytes = fileStatuses.reduce((sum, file) => sum + file.downloadedBytes, 0)
    return {
      id: runtimeConfig.id,
      name: runtimeConfig.name,
      modelRepo: runtimeConfig.modelRepo,
      modelRevision: runtimeConfig.modelRevision,
      runtimeRepo: runtimeConfig.runtimeRepo,
      runtimeVersion: runtime.runtimeVersion,
      runtimeLicense: runtimeConfig.runtimeLicense,
      weightsLicense: runtimeConfig.weightsLicense,
      codecLicense: runtimeConfig.codecLicense,
      voicePresetLicense: runtimeConfig.voicePresetLicense,
      defaultVoice: runtimeConfig.defaultVoice,
      voices: runtimeConfig.voices,
      sampleRate: runtimeConfig.sampleRate,
      totalBytes,
      downloadedBytes,
      approximateBytes: totalBytes,
      modelInstalled: fileStatuses.every((file) => file.downloaded),
      files: fileStatuses,
      cachePath: cacheRoot,
      runtimeCachePath: installRoot,
      runtimeAssetBytes: asset?.size || 0,
      platformSupported: Boolean(asset),
      canSetupRuntime: Boolean(asset),
      canDownload: Boolean(asset && runtime.runtimeReady),
      ...runtime
    }
  }

  async function downloadVerifiedFile(url, destination, spec, progressState, { timeoutMs = 30 * 60 * 1000 } = {}) {
    const partPath = `${destination}.${process.pid}.${randomBytes(6).toString('hex')}.part`
    let handle
    try {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok || !response.body) throw new Error(`Download failed for ${spec.name} (HTTP ${response.status}).`)
      handle = await open(partPath, 'wx')
      const hash = createHash('sha256')
      let fileBytes = 0
      let lastProgressAt = 0
      for await (const incoming of response.body) {
        const chunk = Buffer.from(incoming)
        if (fileBytes + chunk.length > spec.size) throw new Error(`Downloaded ${spec.name} exceeds its pinned size (${spec.size} bytes).`)
        hash.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const writeResult = await handle.write(chunk, offset, chunk.length - offset, null)
          if (!writeResult.bytesWritten) throw new Error(`Could not write all bytes for ${spec.name}.`)
          offset += writeResult.bytesWritten
        }
        fileBytes += chunk.length
        const now = Date.now()
        if (now - lastProgressAt >= 200 || fileBytes === spec.size) {
          progressState(fileBytes)
          lastProgressAt = now
        }
      }
      await handle.sync()
      await handle.close()
      handle = null
      const actualHash = hash.digest('hex')
      if (fileBytes !== spec.size) throw new Error(`Downloaded ${spec.name} has an unexpected size (${fileBytes}; expected ${spec.size}).`)
      if (actualHash !== spec.sha256) throw new Error(`Downloaded ${spec.name} failed its pinned SHA-256 integrity check.`)
      await rm(destination, { force: true })
      await rename(partPath, destination)
      return fileBytes
    } catch (error) {
      await handle?.close().catch(() => {})
      await rm(partPath, { force: true }).catch(() => {})
      throw error
    }
  }

  async function downloadModel() {
    if (modelDownloadPromise) return modelDownloadPromise
    modelDownloadPromise = (async () => {
      const runtime = await inspectRuntime()
      if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'Install the pinned CrispASR runtime before downloading MioTTS.')
      await mkdir(cacheRoot, { recursive: true })
      const initial = await Promise.all(runtimeConfig.files.map(async (spec) => ({ spec, downloaded: await fileMatches(join(cacheRoot, spec.name), spec, cacheRoot, verifiedModelSignatures) })))
      const totalBytes = runtimeConfig.files.reduce((sum, spec) => sum + spec.size, 0)
      let downloadedBytes = initial.reduce((sum, item) => sum + (item.downloaded ? item.spec.size : 0), 0)
      let completedFiles = initial.filter((item) => item.downloaded).length
      const totalFiles = runtimeConfig.files.length
      for (const { spec, downloaded } of initial) {
        if (downloaded) continue
        const destination = join(cacheRoot, spec.name)
        const url = `https://huggingface.co/${runtimeConfig.modelRepo}/resolve/${runtimeConfig.modelRevision}/${spec.name}?download=true`
        onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes, totalBytes, completedFiles, totalFiles, message: `Downloading pinned ${spec.name}…` })
        const bytes = await downloadVerifiedFile(url, destination, spec, (fileBytes) => {
          onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes: downloadedBytes + fileBytes, totalBytes, completedFiles, totalFiles, message: `Downloading ${spec.name}…` })
        })
        downloadedBytes += bytes
        completedFiles += 1
        const info = await lstat(destination)
        verifiedModelSignatures.set(await realpath(destination), fileSignature(info))
        onProgress({ modelId: runtimeConfig.id, state: 'downloading', file: spec.name, downloadedBytes, totalBytes, completedFiles, totalFiles, message: `Verified ${spec.name}.` })
      }
      onProgress({ modelId: runtimeConfig.id, state: 'complete', downloadedBytes: totalBytes, totalBytes, completedFiles: totalFiles, totalFiles, message: 'MioTTS-0.6B model and Japanese presets are checksum-verified.' })
      return getStatus()
    })().finally(() => { modelDownloadPromise = null })
    return modelDownloadPromise
  }

  async function downloadRuntimeArchive(runtimeAsset, archivePath) {
    await mkdir(dirname(archivePath), { recursive: true })
    const existing = await safeFileStat(archivePath)
    if (existing?.isFile() && existing.size === runtimeAsset.size && await hashFile(archivePath) === runtimeAsset.sha256) return
    await rm(archivePath, { force: true })
    const fileSpec = { name: runtimeAsset.name, size: runtimeAsset.size, sha256: runtimeAsset.sha256 }
    const totalBytes = runtimeAsset.size
    onProgress({ runtimeId: 'crispasr', state: 'downloading-runtime', downloadedBytes: 0, totalBytes, file: runtimeAsset.name, message: 'Downloading the pinned CrispASR native runtime…' })
    await downloadVerifiedFile(getMioRuntimeAssetUrl(runtimeAsset), archivePath, fileSpec, (fileBytes) => {
      onProgress({ runtimeId: 'crispasr', state: 'downloading-runtime', downloadedBytes: fileBytes, totalBytes, file: runtimeAsset.name, message: 'Downloading the pinned CrispASR native runtime…' })
    }, { timeoutMs: 10 * 60 * 1000 })
  }

  async function installRuntime() {
    if (!asset) throw new Error(`The pinned CrispASR runtime is not available for ${platform}-${arch}.`)
    if (modelDownloadPromise) throw new Error('Wait for the MioTTS model download to finish before replacing its runtime.')
    if (synthesisCount > 0) throw new Error('Wait for MioTTS synthesis to finish before replacing its runtime.')
    const existing = await inspectRuntime()
    if (existing.runtimeReady) return getStatus()

    await mkdir(runtimeBase, { recursive: true })
    const archivePath = join(archiveRoot, asset.name)
    await downloadRuntimeArchive(asset, archivePath)
    const stagePath = join(runtimeBase, `.install-${process.pid}-${randomBytes(6).toString('hex')}`)
    await mkdir(stagePath, { recursive: true })
    try {
      const listResult = await runCommand('tar', ['-tzf', archivePath], { spawnImpl, env, cwd: runtimeBase, timeoutMs: 30_000, onChild: trackChild })
      if (listResult.code !== 0 || !isSafeMioArchiveListing(listResult.stdout, asset.archiveRoot)) {
        throw new Error('The pinned CrispASR archive contains unexpected paths and was not extracted.')
      }
      onProgress({ runtimeId: 'crispasr', state: 'installing-runtime', message: 'Extracting the verified CrispASR runtime into Kanafish app data…' })
      const extractResult = await runCommand('tar', ['-xzf', archivePath, '-C', stagePath], { spawnImpl, env, cwd: runtimeBase, timeoutMs: 120_000, onChild: trackChild })
      if (extractResult.code !== 0) throw new Error(`Could not extract the verified CrispASR runtime: ${(extractResult.stderr || extractResult.stdout).slice(-1200)}`)
      const stagedBinary = runtimeBinaryPath(stagePath)
      const info = await lstat(stagedBinary).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink()) throw new Error('The verified CrispASR release did not contain the expected native binary.')
      if (platform !== 'win32') await chmod(stagedBinary, 0o755)
      const probe = await inspectRuntimeAtPathForInstall(stagedBinary, stagePath)
      if (!probe.runtimeReady) throw new Error(probe.runtimeError || 'The downloaded CrispASR runtime did not pass the MioTTS capability check.')
      await replaceDirectory(stagePath, installRoot)
      await rm(archivePath, { force: true })
      inspectedRuntimeSignatures.clear()
      onProgress({ runtimeId: 'crispasr', state: 'runtime-ready', message: `CrispASR ${runtimeVersion} with its MioTTS backend is ready.` })
      return getStatus()
    } catch (error) {
      await rm(stagePath, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async function inspectRuntimeAtPathForInstall(binaryPath, rootPath) {
    try {
      const envForRuntime = runtimeEnvironment(binaryPath, env, platform)
      const [versionResult, backendsResult] = await Promise.all([
        runCommand(binaryPath, ['--version'], { spawnImpl, env: envForRuntime, cwd: dirname(binaryPath), onChild: trackChild }),
        runCommand(binaryPath, ['--list-backends-json'], { spawnImpl, env: envForRuntime, cwd: dirname(binaryPath), onChild: trackChild })
      ])
      const versionOutput = `${versionResult.stdout}\n${versionResult.stderr}`
      const backendOutput = `${backendsResult.stdout}\n${backendsResult.stderr}`
      const version = versionOutput.match(/^\s*version\s*:\s*([^\s]+)\s*$/im)?.[1] || ''
      const ready = versionResult.code === 0 && backendsResult.code === 0 && supportsMioCrispRuntime(versionOutput, backendOutput, runtimeVersion)
      return { runtimeFound: true, runtimeReady: ready, runtimePath: binaryPath, runtimeVersion: version, runtimeError: ready ? '' : `CrispASR ${version || 'unknown'} does not advertise the pinned MioTTS backend.`, rootPath }
    } catch (error) {
      return { runtimeFound: false, runtimeReady: false, runtimePath: binaryPath, runtimeVersion: '', runtimeError: error?.message || 'Could not inspect the staged CrispASR runtime.' }
    }
  }

  async function replaceDirectory(source, destination) {
    const backup = `${destination}.old-${randomBytes(5).toString('hex')}`
    let hadDestination = false
    try {
      await rename(destination, backup)
      hadDestination = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      await rename(source, destination)
      if (hadDestination) await rm(backup, { recursive: true, force: true })
    } catch (error) {
      if (hadDestination) await rename(backup, destination).catch(() => {})
      throw error
    }
  }

  async function getModelManifest() {
    const files = await Promise.all(runtimeConfig.files.map(async (spec) => {
      const path = join(cacheRoot, spec.name)
      return await fileMatches(path, spec, cacheRoot, verifiedModelSignatures) ? { ...spec, path: await realpath(path) } : null
    }))
    if (files.some((file) => !file)) return null
    return files
  }

  async function synthesize(text, { voice = runtimeConfig.defaultVoice } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Enter Japanese text to synthesize.')
    if (text.length > MAX_TEXT_CHARS) throw new Error(`MioTTS text is limited to ${MAX_TEXT_CHARS} characters per synthesis.`)
    if (!runtimeConfig.voices.includes(voice)) throw new Error(`MioTTS supports the Japanese preset voices: ${runtimeConfig.voices.join(', ')}.`)
    const runtime = await inspectRuntime()
    if (!runtime.runtimeReady) throw new Error(runtime.runtimeError || 'Install the pinned CrispASR runtime before using MioTTS.')
    const modelFiles = await getModelManifest()
    if (!modelFiles) throw new Error('Download the pinned MioTTS-0.6B model and Japanese preset in Voice Lab before generating speech.')
    const modelPath = modelFiles.find((file) => file.role === 'model')?.path
    const voicePath = modelFiles.find((file) => file.role === 'voice' && file.voice === voice)?.path
    if (!modelPath || !voicePath || !modelFiles.some((file) => file.role === 'tokenizer')) throw new Error('The MioTTS cache is missing a model, tokenizer or selected Japanese voice preset.')
    const binaryPath = runtime.runtimePath
    const outputDirectory = join(appDataRoot, 'tmp')
    await mkdir(outputDirectory, { recursive: true })
    const outputDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(outputDirectory, 'miotts-')))
    const outputPath = join(outputDir, 'synthesis.wav')
    const args = [
      '--backend', 'miotts',
      '-m', modelPath,
      '--voice', voicePath,
      '--tts', text.trim(),
      '--tts-output', outputPath,
      '--gpu-backend', 'cpu',
      '--speaker-identity', 'synthetic'
    ]
    synthesisCount += 1
    const started = performance.now()
    onProgress({ modelId: runtimeConfig.id, state: 'synthesizing', message: 'Generating Japanese speech with the local CrispASR CPU backend…' })
    try {
      const result = await runCommand(binaryPath, args, {
        spawnImpl,
        env: runtimeEnvironment(binaryPath, env, platform),
        cwd: dirname(binaryPath),
        timeoutMs: 10 * 60 * 1000,
        onChild: trackChild
      })
      if (result.code !== 0) throw new Error(`CrispASR MioTTS synthesis failed${result.signal ? ` (${result.signal})` : ` (exit ${result.code})`}: ${(result.stderr || result.stdout).slice(-1800).trim()}`)
      const audioBuffer = await readFile(outputPath).catch(() => null)
      if (!audioBuffer) throw new Error('CrispASR completed without writing the requested WAV file.')
      const wav = validateMioWav(audioBuffer)
      const generationSeconds = (performance.now() - started) / 1000
      onProgress({ modelId: runtimeConfig.id, state: 'synthesis-complete', message: 'MioTTS generated a validated Japanese WAV.' })
      return {
        audioBuffer: Uint8Array.from(audioBuffer),
        backend: `CrispASR ${runtimeVersion} MioTTS · CPU`,
        voice,
        sampleRate: wav.sampleRate,
        channels: wav.channels,
        audioSeconds: wav.audioSeconds,
        generationSeconds,
        realTimeFactor: generationSeconds / wav.audioSeconds,
        peak: wav.peak,
        modelId: runtimeConfig.id
      }
    } finally {
      synthesisCount = Math.max(0, synthesisCount - 1)
      await rm(outputDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function removeModelCache() {
    if (modelDownloadPromise) throw new Error('Wait for the MioTTS model download to finish before clearing its cache.')
    if (synthesisCount > 0) throw new Error('Wait for MioTTS synthesis to finish before clearing its cache.')
    await rm(cacheRoot, { recursive: true, force: true })
    verifiedModelSignatures.clear()
    return getStatus()
  }

  async function removeRuntime() {
    if (runtimeSetupPromise) throw new Error('Wait for CrispASR runtime setup to finish before removing it.')
    if (modelDownloadPromise) throw new Error('Wait for the MioTTS model download to finish before removing its runtime.')
    if (synthesisCount > 0) throw new Error('Wait for MioTTS synthesis to finish before removing its runtime.')
    await rm(installRoot, { recursive: true, force: true })
    await rm(archiveRoot, { recursive: true, force: true })
    inspectedRuntimeSignatures.clear()
    return getStatus()
  }

  async function stop() {
    const children = [...activeChildren]
    await Promise.all(children.map((child) => new Promise((resolvePromise) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise()
      }
      const timer = setTimeout(() => {
        try { child.kill?.('SIGKILL') } catch {}
        finish()
      }, 3000)
      timer.unref?.()
      child.once('close', finish)
      try { child.kill?.('SIGTERM') } catch { finish() }
    })))
  }

  function setupRuntime() {
    if (runtimeSetupPromise) return runtimeSetupPromise
    runtimeSetupPromise = installRuntime().finally(() => { runtimeSetupPromise = null })
    return runtimeSetupPromise
  }

  return Object.freeze({ getStatus, setupRuntime, downloadModel, synthesize, removeModelCache, removeRuntime, stop })
}
