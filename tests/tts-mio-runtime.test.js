import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  MIOTTS_RUNTIME_ASSETS,
  MIOTTS_TTS_RUNTIME,
  createMioRuntime,
  getMioRuntimeAsset,
  getMioRuntimeAssetUrl,
  isSafeMioArchiveListing,
  supportsMioCrispRuntime,
  validateMioWav
} from '../src/main/tts/mioRuntime.js'

const tempDirs = []
const fakeVersion = '=== build info ===\n  version       : 0.8.54\n  git sha       : test\n'
const fakeBackends = JSON.stringify({ backends: [{ name: 'miotts', caps: ['temperature', 'tts'] }] })

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'kanafish-mio-test-'))
  tempDirs.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function makeMonoWav(durationSeconds = 0.2, sampleRate = 44_100) {
  const dataBytes = durationSeconds * sampleRate * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)
  for (let offset = 44; offset + 1 < wav.length; offset += 2) wav.writeInt16LE(offset % 4 ? 1300 : -1300, offset)
  return wav
}

function createFakeChild({ stdout = '', stderr = '', code = 0, beforeClose } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  setImmediate(async () => {
    await beforeClose?.()
    child.stdout.end(stdout)
    child.stderr.end(stderr)
    child.emit('close', code, null)
  })
  return child
}

function fakeRuntimeSpawn({ wavBytes, installedBinaries = [], holdSynthesis = false, onSynthesisStarted = () => {} } = {}) {
  const calls = []
  const spawnImpl = (executable, args) => {
    calls.push({ executable, args })
    if (args[0] === '-tzf') return createFakeChild({ stdout: 'crispasr-linux-x86_64/\ncrispasr-linux-x86_64/crispasr\n' })
    if (args[0] === '-xzf') {
      const stagePath = args[args.indexOf('-C') + 1]
      const binaryPath = join(stagePath, 'crispasr-linux-x86_64', 'crispasr')
      return createFakeChild({ beforeClose: async () => {
        await mkdir(join(stagePath, 'crispasr-linux-x86_64'), { recursive: true })
        await writeFile(binaryPath, 'fake CrispASR runtime')
        await chmod(binaryPath, 0o755)
        installedBinaries.push(binaryPath)
      } })
    }
    if (args.includes('--version')) return createFakeChild({ stdout: fakeVersion })
    if (args.includes('--list-backends-json')) return createFakeChild({ stdout: fakeBackends })
    if (args.includes('--tts')) {
      const outputPath = args[args.indexOf('--tts-output') + 1]
      if (holdSynthesis) {
        const child = new EventEmitter()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.kill = (signal) => { setImmediate(() => child.emit('close', null, signal)); return true }
        onSynthesisStarted(child)
        return child
      }
      return createFakeChild({ beforeClose: async () => writeFile(outputPath, wavBytes || makeMonoWav()) })
    }
    return createFakeChild({ stderr: `Unexpected command ${executable} ${args.join(' ')}`, code: 1 })
  }
  return { spawnImpl, calls }
}

function makeTestModelConfig() {
  const modelFiles = [
    { role: 'model', name: 'model.gguf', voice: '', bytes: Buffer.from('model payload') },
    { role: 'tokenizer', name: 'tokenizer.json', voice: '', bytes: Buffer.from('{"test":true}') },
    { role: 'voice', name: 'jp_female.emb.gguf', voice: 'jp_female', bytes: Buffer.from('female preset') },
    { role: 'voice', name: 'jp_male.emb.gguf', voice: 'jp_male', bytes: Buffer.from('male preset') }
  ]
  const runtimeConfig = {
    ...MIOTTS_TTS_RUNTIME,
    modelRepo: 'test/miotts',
    modelRevision: '0123456789abcdef0123456789abcdef01234567',
    files: modelFiles.map(({ role, name, voice, bytes }) => ({ role, name, voice, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })),
    approximateBytes: modelFiles.reduce((sum, file) => sum + file.bytes.length, 0)
  }
  return { modelFiles, runtimeConfig }
}

async function makeInstalledRuntime(userDataDir) {
  const root = join(userDataDir, 'native-runtimes', 'crispasr', 'v0.8.54', 'crispasr-linux-x86_64')
  await mkdir(root, { recursive: true })
  const binary = join(root, 'crispasr')
  await writeFile(binary, 'fake CrispASR binary')
  await chmod(binary, 0o755)
}

describe('MioTTS no-Python runtime', () => {
  test('pins MioTTS-0.6B separately from 0.1B and documents model, codec and preset terms', () => {
    expect(MIOTTS_TTS_RUNTIME.id).toBe('miotts-0.6b')
    expect(MIOTTS_TTS_RUNTIME.modelRepo).toBe('cstr/miotts-0.6b-GGUF')
    expect(MIOTTS_TTS_RUNTIME.modelRevision).toBe('fab3cdbef802fb5f1047708c27378c6e34ec230f')
    expect(MIOTTS_TTS_RUNTIME.files.map(({ size }) => size)).toEqual([526_181_408, 13_817_944, 768, 768])
    expect(MIOTTS_TTS_RUNTIME.approximateBytes).toBe(540_000_888)
    expect(MIOTTS_TTS_RUNTIME.weightsLicense).toBe('Apache-2.0')
    expect(MIOTTS_TTS_RUNTIME.codecLicense).toBe('MIT')
    expect(MIOTTS_TTS_RUNTIME.runtimeLicense).toBe('MIT')
    expect(MIOTTS_TTS_RUNTIME.voicePresetLicense).toContain('Non-commercial')
  })

  test('pins native runtime archives for Linux x64 and both Mac CPU architectures', () => {
    expect(getMioRuntimeAsset('linux', 'x64')).toEqual(MIOTTS_RUNTIME_ASSETS['linux-x64'])
    expect(getMioRuntimeAsset('darwin', 'arm64')).toEqual(MIOTTS_RUNTIME_ASSETS['darwin-arm64'])
    expect(getMioRuntimeAsset('darwin', 'x64')).toEqual(MIOTTS_RUNTIME_ASSETS['darwin-x64'])
    expect(getMioRuntimeAsset('win32', 'x64')).toBeNull()
    expect(MIOTTS_RUNTIME_ASSETS['linux-x64'].sha256).toBe('a5612bca2dbb096b81972f573ec024a5944d3a63fc18ccd2d9a8489758ddb6f1')
    expect(getMioRuntimeAssetUrl(MIOTTS_RUNTIME_ASSETS['darwin-arm64'])).toContain('/v0.8.54/crispasr-macos-arm64.tar.gz')
  })

  test('rejects unsafe archive paths and requires the exact pinned TTS runtime capability', () => {
    expect(isSafeMioArchiveListing('crispasr-linux-x86_64/\ncrispasr-linux-x86_64/crispasr\n', 'crispasr-linux-x86_64')).toBe(true)
    expect(isSafeMioArchiveListing('../outside\ncrispasr-linux-x86_64/crispasr', 'crispasr-linux-x86_64')).toBe(false)
    expect(isSafeMioArchiveListing('/tmp/crispasr\n', 'crispasr-linux-x86_64')).toBe(false)
    expect(isSafeMioArchiveListing('wrong-root/crispasr\n', 'crispasr-linux-x86_64')).toBe(false)
    expect(supportsMioCrispRuntime(fakeVersion, fakeBackends)).toBe(true)
    expect(supportsMioCrispRuntime(fakeVersion.replace('0.8.54', '0.1.0'), fakeBackends)).toBe(false)
    expect(supportsMioCrispRuntime(fakeVersion, JSON.stringify({ backends: [{ name: 'miotts', caps: ['asr'] }] }))).toBe(false)
  })

  test('validates non-silent mono 44.1 kHz PCM16 WAVs and rejects silence or wrong format', () => {
    expect(validateMioWav(makeMonoWav())).toMatchObject({ sampleRate: 44_100, channels: 1, bitsPerSample: 16, peak: 1300 })
    expect(validateMioWav(makeMonoWav()).audioSeconds).toBeCloseTo(0.2, 3)
    const silent = makeMonoWav()
    silent.fill(0, 44)
    expect(() => validateMioWav(silent)).toThrow('silent')
    expect(() => validateMioWav(makeMonoWav(0.2, 24_000))).toThrow('44.1 kHz')
    expect(() => validateMioWav(Buffer.from('not a WAV'))).toThrow('RIFF/WAVE')
  })

  test('installs the verified native runtime, downloads pinned files, and synthesizes through the MioTTS CLI adapter', async () => {
    const userDataDir = await makeTempDir()
    const { modelFiles, runtimeConfig } = makeTestModelConfig()
    const wavBytes = makeMonoWav(0.3)
    const runtimeArchive = Buffer.from('pinned release archive test bytes')
    const runtimeAsset = {
      name: 'crispasr-linux-test.tar.gz',
      size: runtimeArchive.length,
      sha256: createHash('sha256').update(runtimeArchive).digest('hex'),
      archiveRoot: 'crispasr-linux-x86_64'
    }
    const runtimeAssets = { 'linux-x64': runtimeAsset }
    const { spawnImpl, calls } = fakeRuntimeSpawn({ wavBytes })
    const requestedUrls = []
    const progress = []
    const fetchImpl = async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.endsWith(runtimeAsset.name)) return new Response(runtimeArchive)
      const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1))
      const file = modelFiles.find((candidate) => candidate.name === name)
      return file ? new Response(file.bytes) : new Response('not found', { status: 404 })
    }
    const runtime = createMioRuntime({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      fetchImpl,
      spawnImpl,
      onProgress: (event) => progress.push(event),
      runtimeConfig,
      runtimeAssets
    })

    const initialStatus = await runtime.getStatus()
    expect(initialStatus.platformSupported).toBe(true)
    expect(initialStatus.runtimeReady).toBe(false)
    expect(initialStatus.modelInstalled).toBe(false)

    const runtimeStatus = await runtime.setupRuntime()
    expect(runtimeStatus.runtimeReady).toBe(true)
    expect(runtimeStatus.runtimeVersion).toBe('0.8.54')
    expect(runtimeStatus.runtimePath).toContain('native-runtimes/crispasr/v0.8.54')
    expect(requestedUrls.some((url) => url.includes(runtimeAsset.name))).toBe(true)

    const downloaded = await runtime.downloadModel()
    expect(downloaded.modelInstalled).toBe(true)
    expect(downloaded.totalBytes).toBe(runtimeConfig.approximateBytes)
    expect(requestedUrls.filter((url) => url.includes('/resolve/'))).toHaveLength(runtimeConfig.files.length)

    const result = await runtime.synthesize('こんにちは。', { voice: 'jp_male' })
    expect(result.voice).toBe('jp_male')
    expect(result.sampleRate).toBe(44_100)
    expect(result.channels).toBe(1)
    expect(result.audioSeconds).toBeCloseTo(0.3, 3)
    expect(result.backend).toBe('CrispASR 0.8.54 MioTTS · CPU')
    expect(Buffer.from(result.audioBuffer)).toEqual(wavBytes)
    const ttsCall = calls.find(({ args }) => args.includes('--tts'))
    expect(ttsCall.args).toContain('miotts')
    expect(ttsCall.args).toContain('--speaker-identity')
    expect(ttsCall.args).toContain('synthetic')
    expect(ttsCall.args).toContain('--gpu-backend')
    expect(ttsCall.args).toContain('cpu')
    expect(progress.some((event) => event.runtimeId === 'crispasr' && event.state === 'runtime-ready')).toBe(true)
    expect(progress.some((event) => event.modelId === 'miotts-0.6b' && event.state === 'complete')).toBe(true)

    const clearedModel = await runtime.removeModelCache()
    expect(clearedModel.modelInstalled).toBe(false)
    expect(clearedModel.runtimeReady).toBe(true)
    const clearedRuntime = await runtime.removeRuntime()
    expect(clearedRuntime.runtimeReady).toBe(false)
    expect(clearedRuntime.platformSupported).toBe(true)
  })

  test('does not remove the native runtime while a model download depends on it', async () => {
    const userDataDir = await makeTempDir()
    const { modelFiles, runtimeConfig } = makeTestModelConfig()
    await makeInstalledRuntime(userDataDir)
    const { spawnImpl } = fakeRuntimeSpawn()
    let releaseFirstResponse
    const firstResponse = new Promise((resolve) => { releaseFirstResponse = resolve })
    let requestCount = 0
    const runtime = createMioRuntime({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      spawnImpl,
      runtimeConfig,
      fetchImpl: async (input) => {
        if (requestCount++ === 0) return firstResponse
        const name = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1))
        const file = modelFiles.find((candidate) => candidate.name === name)
        return file ? new Response(file.bytes) : new Response('not found', { status: 404 })
      }
    })
    const download = runtime.downloadModel()
    await expect(runtime.removeRuntime()).rejects.toThrow('model download to finish')
    releaseFirstResponse(new Response(modelFiles[0].bytes))
    expect((await download).modelInstalled).toBe(true)
    expect((await runtime.getStatus()).runtimeReady).toBe(true)
  })

  test('detects a wrong native runtime version and a corrupted model cache instead of reporting ready', async () => {
    const userDataDir = await makeTempDir()
    const { modelFiles, runtimeConfig } = makeTestModelConfig()
    await makeInstalledRuntime(userDataDir)
    const { spawnImpl: validSpawn } = fakeRuntimeSpawn()
    const invalidSpawn = (executable, args) => {
      if (args.includes('--version')) return createFakeChild({ stdout: fakeVersion.replace('0.8.54', '0.8.53') })
      return validSpawn(executable, args)
    }
    const runtime = createMioRuntime({ userDataDir, platform: 'linux', arch: 'x64', spawnImpl: invalidSpawn, runtimeConfig })
    const status = await runtime.getStatus()
    expect(status.runtimeFound).toBe(true)
    expect(status.runtimeReady).toBe(false)
    expect(status.canDownload).toBe(false)

    // A separate runtime verifies the cache integrity check after a good download.
    const goodRuntime = createMioRuntime({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      spawnImpl: validSpawn,
      runtimeConfig,
      fetchImpl: async (input) => {
        const name = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1))
        const file = modelFiles.find((candidate) => candidate.name === name)
        return file ? new Response(file.bytes) : new Response('not found', { status: 404 })
      }
    })
    expect((await goodRuntime.downloadModel()).modelInstalled).toBe(true)
    const corruptedFile = join(userDataDir, 'tts-models', runtimeConfig.id, runtimeConfig.files[0].name)
    const corrupted = await readFile(corruptedFile)
    corrupted[0] ^= 0xff
    await writeFile(corruptedFile, corrupted)
    expect((await goodRuntime.getStatus()).modelInstalled).toBe(false)
  })

  test('rejects oversized model responses and cleans their partial cache files', async () => {
    const userDataDir = await makeTempDir()
    const { modelFiles, runtimeConfig } = makeTestModelConfig()
    await makeInstalledRuntime(userDataDir)
    const { spawnImpl } = fakeRuntimeSpawn()
    const runtime = createMioRuntime({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      spawnImpl,
      runtimeConfig,
      fetchImpl: async (input) => {
        const name = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1))
        const file = modelFiles.find((candidate) => candidate.name === name)
        return file ? new Response(Buffer.concat([file.bytes, Buffer.from('x')])) : new Response('not found', { status: 404 })
      }
    })
    await expect(runtime.downloadModel()).rejects.toThrow('exceeds its pinned size')
    expect(await readFile(join(userDataDir, 'tts-models', runtimeConfig.id, runtimeConfig.files[0].name)).catch(() => null)).toBeNull()
    expect((await runtime.getStatus()).modelInstalled).toBe(false)
  })

  test('terminates an in-flight synthesis process during app shutdown', async () => {
    const userDataDir = await makeTempDir()
    const { modelFiles, runtimeConfig } = makeTestModelConfig()
    await makeInstalledRuntime(userDataDir)
    let synthesisChild
    let resolveStarted
    const started = new Promise((resolve) => { resolveStarted = resolve })
    const { spawnImpl } = fakeRuntimeSpawn({ holdSynthesis: true, onSynthesisStarted: (child) => { synthesisChild = child; resolveStarted() } })
    const runtime = createMioRuntime({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      spawnImpl,
      runtimeConfig,
      fetchImpl: async (input) => {
        const name = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1))
        const file = modelFiles.find((candidate) => candidate.name === name)
        return file ? new Response(file.bytes) : new Response('not found', { status: 404 })
      }
    })
    await runtime.downloadModel()
    const synthesis = runtime.synthesize('こんにちは。')
    let startupTimer
    await Promise.race([
      started,
      synthesis.then(() => { throw new Error('Synthesis completed before the shutdown test could stop it.') }),
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('The Mio synthesis process did not start.')), 1000) })
    ])
    clearTimeout(startupTimer)
    expect(synthesisChild).toBeTruthy()
    await runtime.stop()
    await expect(synthesis).rejects.toThrow('SIGTERM')
  })

  test('reports unsupported platform instead of searching for an unrelated runtime', async () => {
    const runtime = createMioRuntime({ userDataDir: await makeTempDir(), platform: 'win32', arch: 'x64' })
    const status = await runtime.getStatus()
    expect(status.platformSupported).toBe(false)
    expect(status.canSetupRuntime).toBe(false)
    expect(status.runtimeReady).toBe(false)
    expect(status.runtimeError).toContain('win32-x64')
  })
})
