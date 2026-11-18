import { describe, expect, test } from 'bun:test'
import { HAAS_ASR_MODEL, SILERO_VAD_MODEL, SPEECH_CPP_RELEASE, getHaasModelUrl, getVadModelUrl, getSpeechCppAsset, getSpeechCppAssetUrl } from '../src/main/asr/haasRegistry.js'
import { isSafeZipEntryName, listZipEntries, readZipEntry } from '../src/main/asr/zipEntry.js'
import { isAppOrigin, isAudioMediaPermissionCheck, isAudioOnlyMediaRequest } from '../src/main/asr/mediaPermissions.js'
import { buildWorkerArgs, parsePcm16Wav, parseSpeechVersion, speechEnvironment } from '../src/main/asr/haasRuntime.js'
import { buildStreamingAsrArgs, createSpeechJsonLineSplitter } from '../src/main/asr/speechStream.js'
import { ASR_SAMPLE_RATE, createPcm16FrameAccumulator, downmixToMono, encodeWav16, floatToPcm16, resampleLinear, trimToSeconds } from '../src/renderer/src/asr/audio.js'
import { getAsrReadiness } from '../src/renderer/src/asr/readiness.js'
import { katakanaToHiragana, levenshtein, normalizeForComparison, scoreSpokenLine } from '../src/renderer/src/asr/similarity.js'
import { makeZip } from './asr-helpers.js'

function tone(seconds, rate = ASR_SAMPLE_RATE, amplitude = 0.4) {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, index) => amplitude * Math.sin((2 * Math.PI * 220 * index) / rate))
}

describe('speech.cpp and Haas pins', () => {
  test('pins speech.cpp 0.11.0 archives with SHA-256 digests for macOS arm64, Linux x64 and Windows x64', () => {
    expect(SPEECH_CPP_RELEASE.version).toBe('0.11.0')
    expect(SPEECH_CPP_RELEASE.tag).toBe('v0.11.0')
    expect(SPEECH_CPP_RELEASE.workerProtocol).toBe(4)
    expect(Object.keys(SPEECH_CPP_RELEASE.assets).sort()).toEqual(['darwin-arm64', 'linux-x64', 'win32-x64'])
    for (const asset of Object.values(SPEECH_CPP_RELEASE.assets)) {
      expect(asset.name).toBe(`speech-0.11.0-${asset.platform}.zip`)
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.size).toBeGreaterThan(1_000_000)
    }
    expect(getSpeechCppAsset('darwin', 'arm64').sha256).toBe('3ffe12c4398fa9265abdbf673e2e1ee32b04f52cde151d5388833ac3296c69c0')
    expect(getSpeechCppAsset('linux', 'x64').platform).toBe('linux-x64-cpu')
    expect(getSpeechCppAsset('win32', 'x64').executable).toBe('speech.exe')
    expect(getSpeechCppAsset('darwin', 'x64')).toBeNull()
    expect(getSpeechCppAsset('linux', 'arm64')).toBeNull()
    expect(getSpeechCppAssetUrl(getSpeechCppAsset('linux', 'x64'))).toBe('https://github.com/nyosegawa/speech.cpp/releases/download/v0.11.0/speech-0.11.0-linux-x64-cpu.zip')
    expect(() => getSpeechCppAssetUrl({ name: '../evil.zip' })).toThrow()
  })

  test('pins the Haas Q8_0 GGUF to a commit, size and SHA-256', () => {
    expect(HAAS_ASR_MODEL.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(HAAS_ASR_MODEL.file).toEqual({ path: 'Haas-616M-ja-v1.0-Q8_0.gguf', size: 656_381_472, sha256: 'cd5f60b2f1c411404b83fca4a65e3ce30a26d9e951b6a346529e65f22758afeb' })
    expect(HAAS_ASR_MODEL.license).toBe('Apache-2.0')
    expect(getHaasModelUrl()).toBe('https://huggingface.co/sakasegawa/Haas-ja-v1.0-GGUF/resolve/6b965d5007ba780585de51549d57a8c1c0d67c7e/Haas-616M-ja-v1.0-Q8_0.gguf')
    expect(() => getHaasModelUrl({ ...HAAS_ASR_MODEL, revision: 'main' })).toThrow(/commit/)
  })

  test('pins the small VAD model to the immutable file revision, size and LFS SHA-256', () => {
    expect(SILERO_VAD_MODEL.revision).toBe('7fcb7aa2a70c312f8579fc987b3e1cdecf9321ca')
    expect(SILERO_VAD_MODEL.file).toEqual({ path: 'silero-vad-309K-v6.2-F32.gguf', size: 1_238_624, sha256: '2fc312514e5fc4fa4ffd02b25c76a4853fa4130e8fb9777d01502183b01238cb' })
    expect(SILERO_VAD_MODEL.license).toBe('MIT')
    expect(getVadModelUrl()).toBe('https://huggingface.co/sakasegawa/silero-vad-GGUF/resolve/7fcb7aa2a70c312f8579fc987b3e1cdecf9321ca/silero-vad-309K-v6.2-F32.gguf')
    expect(() => getVadModelUrl({ ...SILERO_VAD_MODEL, revision: 'main' })).toThrow(/commit/)
  })
})

describe('ZIP entry reader', () => {
  test('reads a deflated or stored top-level file and checks its CRC', () => {
    const payload = Buffer.from('#!/bin/sh\necho speech.cpp 0.11.0\n'.repeat(50))
    const zip = makeZip([{ name: 'speech.h', data: 'header' }, { name: 'speech', data: payload }, { name: 'notes.txt', data: 'x', store: true }])
    expect(listZipEntries(zip).map((entry) => entry.name)).toEqual(['speech.h', 'speech', 'notes.txt'])
    expect(readZipEntry(zip, 'speech')).toEqual(payload)
    expect(readZipEntry(zip, 'notes.txt').toString()).toBe('x')
  })

  test('refuses symlinks, unsafe names, missing entries and corrupt data', () => {
    const zip = makeZip([{ name: 'libspeech.so', data: 'libspeech.so.4', mode: 0o120777, store: true }, { name: 'speech', data: 'abc', crc: 1 }])
    expect(() => readZipEntry(zip, 'libspeech.so')).toThrow(/not a regular file/)
    expect(() => readZipEntry(zip, 'speech')).toThrow(/CRC/)
    expect(() => readZipEntry(zip, 'missing')).toThrow(/exactly one/)
    expect(() => readZipEntry(zip, '../speech')).toThrow(/plain top-level/)
    expect(() => readZipEntry(Buffer.from('not a zip at all, definitely not'), 'speech')).toThrow(/not a ZIP/)
    expect(isSafeZipEntryName('speech.exe')).toBe(true)
    expect(isSafeZipEntryName('dir/speech')).toBe(false)
  })
})

describe('speech command helpers', () => {
  test('parses speech --version and builds worker arguments with a local model path', () => {
    expect(parseSpeechVersion('speech.cpp 0.11.0, C API 4.2\n')).toBe('0.11.0')
    expect(parseSpeechVersion('something else')).toBe('')
    expect(buildWorkerArgs('/data/Haas.gguf')).toEqual(['worker', '/data/Haas.gguf'])
    expect(buildWorkerArgs('/data/Haas.gguf', { device: 'cpu', threads: 4, warmup: false })).toEqual(['worker', '/data/Haas.gguf', '--device', 'cpu', '--threads', '4', '--no-warmup'])
    expect(() => buildWorkerArgs('haas-ja-v1.0')).toThrow(/\.gguf/)
    expect(speechEnvironment({ PATH: '/bin' })).toEqual({ PATH: '/bin', SPEECH_NO_UPDATE_CHECK: '1', NO_COLOR: '1' })
  })

  test('builds app-managed live CLI arguments using local model files, VAD and rate-limited audio stdin', () => {
    expect(buildStreamingAsrArgs('/app/Haas.gguf', '/app/silero.gguf', 16_000)).toEqual(['asr', '/app/Haas.gguf', '--format', 'json', '--vad', '/app/silero.gguf', '--rate', '16000', '--min-silence-duration-ms', '500', '--speech-pad-ms', '300', '-'])
    expect(buildStreamingAsrArgs('/app/Haas.gguf', '/app/silero.gguf', 48_000, { device: 'cpu', threads: 4 }).slice(-5)).toEqual(['--device', 'cpu', '--threads', '4', '-'])
    expect(() => buildStreamingAsrArgs('haas-ja-v1.0', '/app/vad.gguf', 16_000)).toThrow(/local Haas/)
    expect(() => buildStreamingAsrArgs('/app/haas.gguf', 'silero-vad', 16_000)).toThrow(/local VAD/)
    expect(() => buildStreamingAsrArgs('/app/haas.gguf', '/app/vad.gguf', 1000)).toThrow(/8–48/)
  })

  test('splits JSONL events safely when UTF-8 Japanese text spans output chunks', () => {
    const events = []
    const split = createSpeechJsonLineSplitter((event) => events.push(event))
    const bytes = Buffer.from('{"type":"conversation.item.input_audio_transcription.delta","delta":"こんにちは"}\n', 'utf8')
    split(bytes.subarray(0, bytes.length - 4))
    split(bytes.subarray(bytes.length - 4))
    expect(events).toEqual([{ type: 'conversation.item.input_audio_transcription.delta', delta: 'こんにちは' }])
  })

  test('only the exact packaged renderer or configured dev origin may request audio-only capture', () => {
    const packagedPage = 'file:///Applications/Kanafish.app/Contents/Resources/app/out/renderer/index.html'
    expect(isAppOrigin(packagedPage, '', packagedPage)).toBe(true)
    expect(isAppOrigin(`${packagedPage}#/voice-lab`, '', packagedPage)).toBe(true)
    expect(isAppOrigin('file:///tmp/unrelated.html', '', packagedPage)).toBe(false)
    expect(isAppOrigin('file:///Applications/Kanafish.app/Contents/Resources/app/out/renderer/other.html', '', packagedPage)).toBe(false)
    expect(isAppOrigin(`${packagedPage}?untrusted=1`, '', packagedPage)).toBe(false)
    expect(isAppOrigin('http://localhost:5173/#/voice-lab', 'http://localhost:5173')).toBe(true)
    expect(isAppOrigin('https://evil.example/', 'http://localhost:5173')).toBe(false)
    expect(isAppOrigin('http://localhost:5173/')).toBe(false)
    expect(isAudioOnlyMediaRequest({ mediaTypes: ['audio'] })).toBe(true)
    expect(isAudioOnlyMediaRequest({ mediaTypes: ['audio', 'video'] })).toBe(false)
    expect(isAudioOnlyMediaRequest({ mediaTypes: ['audio'], isMainFrame: false })).toBe(false)
    expect(isAudioOnlyMediaRequest({})).toBe(false)
    expect(isAudioMediaPermissionCheck({ mediaType: 'audio' })).toBe(true)
    expect(isAudioMediaPermissionCheck({ mediaType: 'video' })).toBe(false)
    expect(isAudioMediaPermissionCheck({ mediaType: 'audio', isMainFrame: false })).toBe(false)
  })
})

describe('WAV encoding for recognition', () => {
  test('encodes 16 kHz mono PCM16 that the main-process parser accepts', () => {
    const samples = tone(1.5)
    const wav = encodeWav16(samples, ASR_SAMPLE_RATE)
    expect(wav.length).toBe(44 + samples.length * 2)
    const parsed = parsePcm16Wav(wav)
    expect(parsed.sampleRate).toBe(16_000)
    expect(parsed.seconds).toBeCloseTo(1.5, 3)
    expect(parsed.peak).toBeGreaterThan(13_000)
    expect(parsed.pcm.readInt16LE(2)).toBe(floatToPcm16([samples[1]])[0])
  })

  test('rejects stereo, too-long, too-short and non-WAV input', () => {
    const stereo = encodeWav16(tone(1))
    stereo[22] = 2
    expect(() => parsePcm16Wav(stereo)).toThrow(/mono/)
    expect(() => parsePcm16Wav(encodeWav16(tone(61)))).toThrow(/60 seconds/)
    expect(() => parsePcm16Wav(encodeWav16(tone(0.05)))).toThrow(/too short/)
    expect(() => parsePcm16Wav(new Uint8Array(100))).toThrow(/not a WAV/)
  })

  test('clamps samples, downmixes, resamples and trims', () => {
    expect(Array.from(floatToPcm16([2, -2, 0, Number.NaN]))).toEqual([32767, -32767, 0, 0])
    expect(Array.from(downmixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 0])]))).toEqual([0.5, 0])
    expect(resampleLinear(tone(1, 48_000), 48_000, 16_000).length).toBe(16_000)
    expect(resampleLinear(tone(1, 8_000), 8_000, 16_000).length).toBe(16_000)
    expect(trimToSeconds(tone(2), 16_000, 1).length).toBe(16_000)
  })

  test('frames PCM16LE across arbitrary AudioWorklet block boundaries and flushes a final partial frame', () => {
    const framer = createPcm16FrameAccumulator(3)
    const first = framer.push(Float32Array.from([1, -1]))
    expect(first).toHaveLength(0)
    const second = framer.push(Float32Array.from([0.5, Number.NaN, -0.5, 0]))
    expect(second).toHaveLength(2)
    expect(Array.from({ length: 3 }, (_, index) => new DataView(second[0].buffer).getInt16(index * 2, true))).toEqual([32767, -32767, 16384])
    expect(Array.from({ length: 3 }, (_, index) => new DataView(second[1].buffer).getInt16(index * 2, true))).toEqual([0, -16383, 0])
    expect(framer.pendingSamples).toBe(0)
    expect(framer.flush()).toBeNull()
    framer.push(Float32Array.from([0.25]))
    expect(framer.flush().byteLength).toBe(2)
  })
})

describe('speech recognition readiness', () => {
  test('asks for the runtime first, then the model', () => {
    expect(getAsrReadiness(null).missing).toBe('status')
    expect(getAsrReadiness({ platformSupported: false, runtimeError: 'no build' })).toMatchObject({ ready: false, missing: 'platform', message: 'no build' })
    expect(getAsrReadiness({ platformSupported: true, runtimeReady: false, modelInstalled: true }).missing).toBe('runtime')
    expect(getAsrReadiness({ platformSupported: true, runtimeReady: false, runtimeFound: true, runtimeError: 'speech 0.10.0 does not match' }).message).toMatch(/0\.10\.0/)
    expect(getAsrReadiness({ platformSupported: true, runtimeReady: true, modelInstalled: false }).missing).toBe('model')
    expect(getAsrReadiness({ platformSupported: true, runtimeReady: true, modelInstalled: true })).toMatchObject({ ready: true, missing: null })
  })
})

describe('spoken line similarity', () => {
  test('ignores punctuation, whitespace, width and katakana vs hiragana', () => {
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー')
    expect(normalizeForComparison('すみません、 東京駅？')).toBe('すみません東京駅')
    expect(normalizeForComparison('ＡＢＣ　テスト！')).toBe('abcてすと')
    expect(scoreSpokenLine('こんにちは。', 'コンニチハ')).toMatchObject({ score: 100, verdict: 'match' })
  })

  test('scores by character edit distance', () => {
    expect(levenshtein('とうきょう', 'ときょう')).toBe(1)
    expect(scoreSpokenLine('コーヒーを一杯ください。', 'コーヒーを一つください')).toMatchObject({ score: 91, distance: 1, verdict: 'match' })
    expect(scoreSpokenLine('ありがとうございます', 'ありがとうございした')).toMatchObject({ score: 80, verdict: 'close' })
    expect(scoreSpokenLine('こんにちは。', '').verdict).toBe('nothing')
    expect(scoreSpokenLine('電車は午後三時に出発します', 'おはよう').verdict).toBe('retry')
  })
})
