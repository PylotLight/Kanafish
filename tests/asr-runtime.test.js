import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test } from 'bun:test'
import { HAAS_ASR_MODEL, SPEECH_CPP_RELEASE } from '../src/main/asr/haasRegistry.js'
import { createHaasAsrRuntime } from '../src/main/asr/haasRuntime.js'
import { buildTranscribeLines, createJsonLineSplitter, parseWorkerLine } from '../src/main/asr/speechWorker.js'
import { encodeWav16 } from '../src/renderer/src/asr/audio.js'
import { makeZip } from './asr-helpers.js'

const tempDirs = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'kanafish-asr-test-'))
  tempDirs.push(path)
  return path
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function tone(seconds, rate = 16_000) {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, index) => 0.4 * Math.sin((2 * Math.PI * 220 * index) / rate))
}

function makeFixtures() {
  const binary = Buffer.from('fake speech executable\n'.repeat(20))
  const archive = makeZip([{ name: 'libspeech.so', data: 'libspeech.so.4', mode: 0o120777, store: true }, { name: 'speech', data: binary }, { name: 'speech.h', data: '/* api */' }])
  const modelBytes = Buffer.from('GGUF fake haas model payload')
  const release = {
    ...SPEECH_CPP_RELEASE,
    assets: { 'linux-x64': { platform: 'linux-x64-cpu', name: 'speech-0.11.0-linux-x64-cpu.zip', size: archive.length, sha256: sha256(archive), executable: 'speech', backend: 'CPU' } }
  }
  const model = { ...HAAS_ASR_MODEL, file: { path: HAAS_ASR_MODEL.file.path, size: modelBytes.length, sha256: sha256(modelBytes) } }
  return { binary, archive, modelBytes, release, model }
}

function commandChild({ stdout = '', stderr = '', code = 0 } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  setImmediate(() => {
    child.stdout.end(stdout)
    child.stderr.end(stderr)
    child.emit('close', code, null)
  })
  return child
}

function workerChild({ version = '0.11.0', fatal = null, text = '東京駅までお願いします。', received = [], deferTranscribe = false } = {}) {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  let closed = false
  const close = (code, signal = null) => {
    if (closed) return
    closed = true
    child.stdout.end()
    child.emit('close', code, signal)
  }
  child.kill = (signal) => { setImmediate(() => close(null, signal)); return true }
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`)
  setImmediate(() => {
    child.stderr.write('loading model\n')
    if (fatal) {
      send({ type: 'fatal', error: fatal })
      setImmediate(() => close(1))
      return
    }
    send({ type: 'ready', protocol: 4, version, defaults: {}, model: { name: 'Haas-ja-v1.0' } })
  })
  const chunks = new Map()
  const split = createJsonLineSplitter((line) => {
    const message = parseWorkerLine(line)
    received.push(message)
    if (message.type === 'chunk') {
      const list = chunks.get(message.id) || []
      list.push(Buffer.from(message.pcm, 'base64'))
      chunks.set(message.id, list)
    }
    if (message.type === 'transcribe') {
      const pcm = Buffer.concat(chunks.get(message.id) || [])
      send({ type: 'progress', id: message.id, done: 0.5 })
      if (!deferTranscribe) send({ type: 'end', id: message.id, text, stop: 'complete', segments: [{ start: 0, end: pcm.length / 2 / message.sample_rate, text }], tokens: [{ start: 0, end: 0.2, text: '東' }] })
    }
    if (message.type === 'cancel') send({ type: 'cancelled', id: message.id })
  })
  child.stdin.on('data', split)
  child.stdin.on('end', () => setImmediate(() => close(0)))
  return child
}

function fakeSpawn({ version = '0.11.0', worker = {} } = {}) {
  const calls = []
  const received = []
  const spawnImpl = (executable, args, options) => {
    calls.push({ executable, args, options })
    if (args[0] === '--version') return commandChild({ stdout: `speech.cpp ${version}, C API 4.2\n` })
    if (args[0] === 'worker') return workerChild({ version, received, ...worker })
    return commandChild({ stderr: 'unexpected command', code: 2 })
  }
  return { spawnImpl, calls, received }
}

function fakeDownloader(contentsByUrl) {
  const calls = []
  const downloadFile = async ({ url, path, partPath, file, signal, onProgress }) => {
    calls.push({ url, path, partPath, file })
    if (signal?.aborted) throw signal.reason
    const bytes = contentsByUrl(url)
    onProgress?.({ fileBytes: Math.floor(bytes.length / 2) })
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, bytes)
    onProgress?.({ fileBytes: bytes.length, terminal: true })
  }
  return { downloadFile, calls }
}

async function makeRuntime(overrides = {}) {
  const userDataDir = await makeTempDir()
  const fixtures = makeFixtures()
  const spawn = fakeSpawn(overrides.spawn)
  const downloads = fakeDownloader((url) => url.endsWith('.zip') ? (overrides.archiveBytes || fixtures.archive) : fixtures.modelBytes)
  const progress = []
  const runtime = createHaasAsrRuntime({
    userDataDir,
    platform: 'linux',
    arch: 'x64',
    env: { PATH: '/usr/bin' },
    spawnImpl: spawn.spawnImpl,
    downloadFile: downloads.downloadFile,
    getFilesystemStats: async () => ({ bavail: 1e9, bsize: 4096 }),
    release: fixtures.release,
    model: fixtures.model,
    idleStopMs: 0,
    onProgress: (event) => progress.push(event),
    ...overrides.runtime
  })
  return { runtime, userDataDir, fixtures, spawn, downloads, progress }
}

describe('speech worker protocol helpers', () => {
  test('splits JSON Lines across chunks and rejects non-protocol output', () => {
    const lines = []
    const split = createJsonLineSplitter((line) => lines.push(line))
    split('{"type":"ready"')
    split('}\n\n{"type":"end","id":"a"}\r\n')
    expect(lines).toEqual(['{"type":"ready"}', '{"type":"end","id":"a"}'])
    expect(parseWorkerLine(lines[1])).toEqual({ type: 'end', id: 'a' })
    expect(() => parseWorkerLine('loading model…')).toThrow(/not JSON/)
    expect(() => parseWorkerLine('[1,2]')).toThrow(/protocol message/)
  })

  test('builds ordered base64 PCM chunks then one transcribe request', () => {
    const pcm = Buffer.alloc(10_000)
    for (let index = 0; index < pcm.length; index += 2) pcm.writeInt16LE(index, index)
    const lines = buildTranscribeLines('r1', pcm, 16_000, { chunkBytes: 4_001, timestamps: true }).map((line) => JSON.parse(line))
    expect(lines.map((line) => line.type)).toEqual(['chunk', 'chunk', 'chunk', 'transcribe'])
    expect(lines.slice(0, 3).map((line) => line.seq)).toEqual([0, 1, 2])
    expect(Buffer.concat(lines.slice(0, 3).map((line) => Buffer.from(line.pcm, 'base64')))).toEqual(pcm)
    expect(lines[3]).toEqual({ type: 'transcribe', id: 'r1', sample_rate: 16_000, timestamps: true })
    expect(() => buildTranscribeLines('r', Buffer.alloc(3), 16_000)).toThrow(/16-bit/)
    expect(() => buildTranscribeLines('r', Buffer.alloc(4), 96_000)).toThrow(/8–48 kHz/)
  })
})

describe('Haas speech.cpp runtime', () => {
  test('reports an unsupported platform without offering setup', async () => {
    const { runtime } = await makeRuntime({ runtime: { platform: 'linux', arch: 'arm64' } })
    const status = await runtime.getStatus()
    expect(status.platformSupported).toBe(false)
    expect(status.canSetupRuntime).toBe(false)
    expect(status.runtimeError).toMatch(/linux-arm64/)
    await expect(runtime.setupRuntime()).rejects.toThrow(/no pinned release/)
  })

  test('installs only the speech executable from the verified archive and checks its version', async () => {
    const { runtime, userDataDir, fixtures, spawn, downloads, progress } = await makeRuntime()
    expect((await runtime.getStatus()).runtimeReady).toBe(false)
    const status = await runtime.setupRuntime()
    expect(status.runtimeReady).toBe(true)
    expect(status.runtimeVersion).toBe('0.11.0')
    const installed = join(userDataDir, 'native-runtimes', 'speech.cpp', 'v0.11.0', 'speech')
    expect(status.runtimePath).toBe(installed)
    expect(await readFile(installed)).toEqual(fixtures.binary)
    expect((await stat(installed)).mode & 0o111).toBeTruthy()
    expect(await stat(join(userDataDir, 'native-runtimes', 'speech.cpp', 'v0.11.0', 'libspeech.so')).catch(() => null)).toBeNull()
    expect(await stat(join(userDataDir, 'native-runtimes', 'speech.cpp', 'downloads', fixtures.release.assets['linux-x64'].name)).catch(() => null)).toBeNull()
    expect(downloads.calls[0].url).toBe('https://github.com/nyosegawa/speech.cpp/releases/download/v0.11.0/speech-0.11.0-linux-x64-cpu.zip')
    expect(spawn.calls.filter((call) => call.args[0] === '--version').every((call) => call.options.env.SPEECH_NO_UPDATE_CHECK === '1')).toBe(true)
    expect(progress.some((event) => event.state === 'runtime-ready')).toBe(true)
  })

  test('refuses a runtime whose version does not match the pin and an archive with the wrong digest', async () => {
    const wrongVersion = await makeRuntime({ spawn: { version: '0.10.2' } })
    await expect(wrongVersion.runtime.setupRuntime()).rejects.toThrow(/0\.10\.2 does not match the pinned speech\.cpp 0\.11\.0/)
    expect(await stat(join(wrongVersion.userDataDir, 'native-runtimes', 'speech.cpp', 'v0.11.0')).catch(() => null)).toBeNull()
    expect((await wrongVersion.runtime.getStatus()).runtimeReady).toBe(false)

    const tampered = await makeRuntime({ archiveBytes: makeZip([{ name: 'speech', data: 'something else' }]) })
    await expect(tampered.runtime.setupRuntime()).rejects.toThrow(/SHA-256/)
  })

  test('downloads the pinned model with a resumable part file and detects a corrupted cache', async () => {
    const { runtime, userDataDir, fixtures, downloads } = await makeRuntime()
    const status = await runtime.downloadModel()
    expect(status.modelInstalled).toBe(true)
    expect(status.downloadedBytes).toBe(fixtures.modelBytes.length)
    const modelPath = join(userDataDir, 'asr-models', 'haas-ja-v1.0', HAAS_ASR_MODEL.revision, HAAS_ASR_MODEL.file.path)
    expect(downloads.calls[0]).toMatchObject({ url: `https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/resolve/${HAAS_ASR_MODEL.revision}/${HAAS_ASR_MODEL.file.path}`, path: modelPath, partPath: `${modelPath}.part` })
    // Replace the file (new inode) so the cached size/mtime/inode signature changes even within one clock tick.
    await rm(modelPath)
    await writeFile(modelPath, Buffer.alloc(fixtures.modelBytes.length, 7))
    expect((await runtime.getStatus()).modelInstalled).toBe(false)
    expect((await runtime.removeModelCache()).downloadedBytes).toBe(0)
  })

  test('cancels a model download and reports the partial bytes kept for resume', async () => {
    const userDataDir = await makeTempDir()
    const fixtures = makeFixtures()
    let started
    const startedPromise = new Promise((resolvePromise) => { started = resolvePromise })
    const runtime = createHaasAsrRuntime({
      userDataDir, platform: 'linux', arch: 'x64', release: fixtures.release, model: fixtures.model, spawnImpl: fakeSpawn().spawnImpl,
      getFilesystemStats: async () => ({ bavail: 1e9, bsize: 4096 }),
      downloadFile: async ({ partPath, signal }) => {
        await mkdir(join(partPath, '..'), { recursive: true })
        await writeFile(partPath, fixtures.modelBytes.subarray(0, 5))
        started()
        await new Promise((_, rejectPromise) => signal.addEventListener('abort', () => rejectPromise(signal.reason), { once: true }))
      }
    })
    const task = runtime.downloadModel()
    await startedPromise
    expect(runtime.cancelModelDownload()).toEqual({ cancelled: true })
    await expect(task).rejects.toThrow(/cancelled/)
    const status = await runtime.getStatus()
    expect(status.modelInstalled).toBe(false)
    expect(status.downloadedBytes).toBe(5)
    expect(runtime.cancelModelDownload()).toEqual({ cancelled: false })
  })

  test('transcribes through one long-lived speech worker that loads the local GGUF path', async () => {
    const { runtime, userDataDir, spawn } = await makeRuntime()
    await runtime.setupRuntime()
    await runtime.downloadModel()
    const wav = encodeWav16(tone(1.2))
    const first = await runtime.transcribe(wav)
    expect(first.text).toBe('東京駅までお願いします。')
    expect(first.audioSeconds).toBeCloseTo(1.2, 3)
    expect(first.segments).toHaveLength(1)
    expect(first.tokens[0].text).toBe('東')
    expect(first.backend).toBe('speech.cpp 0.11.0 · CPU')
    const workerCalls = spawn.calls.filter((call) => call.args[0] === 'worker')
    expect(workerCalls).toHaveLength(1)
    expect(workerCalls[0].args).toEqual(['worker', join(userDataDir, 'asr-models', 'haas-ja-v1.0', HAAS_ASR_MODEL.revision, HAAS_ASR_MODEL.file.path)])
    expect(workerCalls[0].executable).toBe(join(userDataDir, 'native-runtimes', 'speech.cpp', 'v0.11.0', 'speech'))
    const transcribeLine = spawn.received.find((message) => message.type === 'transcribe')
    expect(transcribeLine).toMatchObject({ sample_rate: 16_000, timestamps: true })
    const pcm = Buffer.concat(spawn.received.filter((message) => message.type === 'chunk').map((message) => Buffer.from(message.pcm, 'base64')))
    expect(pcm).toEqual(Buffer.from(wav.subarray(44)))

    const second = await runtime.transcribe(wav)
    expect(second.loadSeconds).toBe(0)
    expect(spawn.calls.filter((call) => call.args[0] === 'worker')).toHaveLength(1)
    expect((await runtime.getStatus()).workerRunning).toBe(true)
    await runtime.stop()
    expect((await runtime.getStatus()).workerRunning).toBe(false)
  })

  test('cancels an in-flight transcription through the worker protocol', async () => {
    const { runtime, spawn } = await makeRuntime({ spawn: { worker: { deferTranscribe: true } } })
    await runtime.setupRuntime()
    await runtime.downloadModel()
    const task = runtime.transcribe(encodeWav16(tone(1)))
    for (let attempt = 0; attempt < 100 && !spawn.received.some((message) => message.type === 'transcribe'); attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
    }
    const request = spawn.received.find((message) => message.type === 'transcribe')
    expect(request).toBeTruthy()
    expect(runtime.cancelTranscription()).toEqual({ cancelled: true })
    await expect(task).rejects.toMatchObject({ code: 'cancelled' })
    expect(spawn.received).toContainEqual({ type: 'cancel', id: request.id })
    expect(runtime.cancelTranscription()).toEqual({ cancelled: false })
    await runtime.stop()
  })

  test('surfaces worker start failures and refuses silent or premature requests', async () => {
    const notReady = await makeRuntime()
    await expect(notReady.runtime.transcribe(encodeWav16(tone(1)))).rejects.toThrow(/Install the speech\.cpp runtime|does not match/)
    await expect(notReady.runtime.transcribe(encodeWav16(new Float32Array(16_000)))).rejects.toThrow(/silent/)

    const fatal = await makeRuntime({ spawn: { worker: { fatal: { code: 'model_file', message: 'not a speech.cpp model' } } } })
    await fatal.runtime.setupRuntime()
    await fatal.runtime.downloadModel()
    await expect(fatal.runtime.transcribe(encodeWav16(tone(1)))).rejects.toThrow(/could not start: not a speech\.cpp model/)
    expect((await fatal.runtime.getStatus()).workerRunning).toBe(false)
  })
})
