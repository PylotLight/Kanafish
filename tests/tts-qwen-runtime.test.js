import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  QWEN3_TTS_RUNTIME,
  createQwenRuntime,
  getCodecCppServerCandidates,
  isPathWithinDirectory,
  supportsCodecCppTtsServer,
  wavDurationSeconds
} from '../src/main/tts/qwenRuntime.js'

const TEST_HELP = `usage: tts-server --model CODEC.gguf --backbone LLAMA.gguf --host 127.0.0.1 --port 8080 --api-key KEY --n-threads N\nresponse formats in this build: wav pcm`
const tempDirs = []

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'kanafish-qwen-test-'))
  tempDirs.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function makeMonoWav(durationSeconds = 1, sampleRate = 24_000) {
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
  return wav
}

function createFakeChild({ output = '', onKill } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = (signal) => {
    onKill?.(signal)
    setImmediate(() => child.emit('exit', 0, null))
    return true
  }
  if (output) {
    setImmediate(() => child.stdout.end(output, () => child.emit('close', 2, null)))
  }
  return child
}

async function createRuntimeHarness({ platform = 'linux', onRequest = () => {} } = {}) {
  const userDataDir = await makeTempDir()
  const binDir = join(userDataDir, 'bin')
  await mkdir(binDir)
  const serverPath = join(binDir, platform === 'win32' ? 'tts-server.exe' : 'tts-server')
  await writeFile(serverPath, 'fake executable')
  await chmod(serverPath, 0o755)

  const modelFiles = [
    { role: 'backbone', name: 'backbone.gguf', bytes: Buffer.from('backbone-test') },
    { role: 'codec', name: 'codec.gguf', bytes: Buffer.from('codec-test') }
  ]
  const files = modelFiles.map(({ role, name, bytes }) => ({
    role,
    name,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }))
  const runtimeConfig = {
    ...QWEN3_TTS_RUNTIME,
    modelRepo: 'test/qwen-gguf',
    modelRevision: '0123456789abcdef0123456789abcdef01234567',
    runtimeCommit: 'test-commit',
    approximateBytes: files.reduce((sum, file) => sum + file.size, 0),
    files
  }
  let killSignal = ''
  const spawnCalls = []
  const spawnImpl = (_executable, args) => {
    spawnCalls.push(args)
    if (args.includes('--help')) return createFakeChild({ output: TEST_HELP })
    return createFakeChild({ onKill: (signal) => { killSignal = signal } })
  }
  const fetchImpl = async (input, options = {}) => {
    const url = String(input)
    onRequest(url, options)
    if (url.includes('/resolve/')) {
      const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1))
      const file = modelFiles.find((item) => item.name === name)
      return file ? new Response(file.bytes) : new Response('missing', { status: 404 })
    }
    if (url.endsWith('/health')) return new Response('ok')
    if (url.endsWith('/v1/audio/voices')) return Response.json({ voices: ['ono_anna'] })
    if (url.endsWith('/v1/audio/speech')) return new Response(makeMonoWav(1.25), { headers: { 'content-type': 'audio/wav' } })
    return new Response('not found', { status: 404 })
  }
  const runtime = createQwenRuntime({
    userDataDir,
    env: { PATH: binDir, KANAFISH_CODEC_CPP_TTS_SERVER_PATH: serverPath },
    home: userDataDir,
    platform,
    fetchImpl,
    spawnImpl,
    runtimeConfig
  })
  return { runtime, runtimeConfig, modelFiles, serverPath, spawnCalls, getKillSignal: () => killSignal }
}

describe('codec.cpp Qwen runtime helpers', () => {
  test('pins the approved CustomVoice pair, Japanese preset and separate licenses', () => {
    expect(QWEN3_TTS_RUNTIME.modelRepo).toBe('BricksDisplay/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF')
    expect(QWEN3_TTS_RUNTIME.modelRevision).toBe('22f3c6369919f6374f790a65c6fe3aed0ec5f86b')
    expect(QWEN3_TTS_RUNTIME.runtimeCommit).toBe('d5e385229ea5a0f48fff696fed4699a852aa43b7')
    expect(QWEN3_TTS_RUNTIME.files.map(({ size }) => size)).toEqual([639_442_656, 1_310_488_032])
    expect(QWEN3_TTS_RUNTIME.voices).toEqual(['ono_anna'])
    expect(QWEN3_TTS_RUNTIME.weightsLicense).toBe('Apache-2.0')
    expect(QWEN3_TTS_RUNTIME.runtimeLicense).toBe('MIT')
  })

  test('accepts only codec.cpp help that advertises required server flags and WAV output', () => {
    expect(supportsCodecCppTtsServer(TEST_HELP)).toBe(true)
    expect(supportsCodecCppTtsServer(TEST_HELP.replace('--api-key KEY ', ''))).toBe(false)
    expect(supportsCodecCppTtsServer(TEST_HELP.replace('wav pcm', 'pcm'))).toBe(false)
    expect(supportsCodecCppTtsServer('usage: unrelated --model --backbone --host --port --api-key --n-threads response formats wav')).toBe(false)
  })

  test('discovers explicit, per-user and PATH server locations without duplicates', () => {
    const candidates = getCodecCppServerCandidates({
      env: { KANAFISH_CODEC_CPP_TTS_SERVER_PATH: '/custom/tts-server', PATH: '/bin:/custom' },
      home: '/home/tester',
      platform: 'linux'
    })
    expect(candidates[0]).toBe('/custom/tts-server')
    expect(candidates).toContain('/home/tester/.local/share/kanafish/codec.cpp/build/tts-server')
    expect(candidates).toContain('/home/tester/.local/bin/tts-server')
    expect(candidates.filter((path) => path === '/custom/tts-server')).toHaveLength(1)
    expect(getCodecCppServerCandidates({ env: { LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' }, home: 'C:\\Users\\Tester', platform: 'win32' }).some((path) => path.includes('Kanafish') && path.includes('codec.cpp') && path.endsWith('tts-server.exe'))).toBe(true)
  })

  test('keeps local cache paths confined and parses regular and streamed WAV data', () => {
    expect(isPathWithinDirectory('/cache/qwen', '/cache/qwen/model.gguf')).toBe(true)
    expect(isPathWithinDirectory('/cache/qwen', '/cache/qwen-old/model.gguf')).toBe(false)
    expect(wavDurationSeconds(makeMonoWav(1.25))).toBeCloseTo(1.25, 5)
    const streamed = makeMonoWav(1)
    streamed.writeUInt32LE(0xffffffff, 40)
    expect(wavDurationSeconds(streamed)).toBeCloseTo(1, 5)
    expect(wavDurationSeconds(Buffer.from('not wav'))).toBeNull()
  })

  test('downloads checksum-pinned files, starts the loopback preset server, synthesizes WAV and stops it', async () => {
    const requests = []
    const harness = await createRuntimeHarness({ onRequest: (url, options) => requests.push({ url, options }) })
    const readyBeforeDownload = await harness.runtime.getStatus()
    expect(readyBeforeDownload.runtimeFound).toBe(true)
    expect(readyBeforeDownload.runtimeReady).toBe(true)
    expect(readyBeforeDownload.modelInstalled).toBe(false)

    const downloaded = await harness.runtime.downloadModel()
    expect(downloaded.modelInstalled).toBe(true)
    expect(downloaded.totalBytes).toBe(harness.runtimeConfig.approximateBytes)
    expect(requests.filter(({ url }) => url.includes('/resolve/'))).toHaveLength(2)
    expect(requests.every(({ url }) => !url.startsWith('http://'))).toBe(true)

    const result = await harness.runtime.synthesize('こんにちは。', { voice: 'ono_anna' })
    expect(result.audioSeconds).toBeCloseTo(1.25, 5)
    expect(result.sampleRate).toBe(24_000)
    expect(result.realTimeFactor).toBeGreaterThan(0)
    expect(result.backend).toBe('codec.cpp CPU')
    const request = requests.find(({ url }) => url.endsWith('/v1/audio/speech'))
    expect(request.options.headers.authorization).toMatch(/^Bearer [a-f0-9]{48}$/)
    expect(JSON.parse(request.options.body)).toMatchObject({ voice: 'ono_anna', response_format: 'wav', input: 'こんにちは。' })

    await harness.runtime.stop()
    expect(harness.getKillSignal()).toBe('SIGTERM')
    await expect(harness.runtime.synthesize('こんにちは。', { voice: 'aria' })).rejects.toThrow('ono_anna')
  })

  test('rechecks changed cached bytes and does not mark a corrupted model installed', async () => {
    const harness = await createRuntimeHarness()
    const downloaded = await harness.runtime.downloadModel()
    const backbone = downloaded.cachePath + '/backbone.gguf'
    const original = await readFile(backbone)
    const corrupted = Buffer.from(original)
    corrupted[0] ^= 0xff
    await writeFile(backbone, corrupted)

    const status = await harness.runtime.getStatus()
    expect(status.modelInstalled).toBe(false)
    await expect(harness.runtime.synthesize('テスト')).rejects.toThrow('Download the Qwen3-TTS CustomVoice model')
  })

  test('replaces a cached manifest through the Windows-compatible path', async () => {
    const harness = await createRuntimeHarness({ platform: 'win32' })
    const first = await harness.runtime.downloadModel()
    const oldManifest = await readFile(`${first.cachePath}/qwen3-tts-0.6b-customvoice-manifest.json`, 'utf8')
    const second = await harness.runtime.downloadModel()
    const newManifest = await readFile(`${second.cachePath}/qwen3-tts-0.6b-customvoice-manifest.json`, 'utf8')
    expect(second.modelInstalled).toBe(true)
    expect(JSON.parse(newManifest).files).toHaveLength(2)
    expect(oldManifest).toContain(harness.runtimeConfig.modelRevision)
  })
})
