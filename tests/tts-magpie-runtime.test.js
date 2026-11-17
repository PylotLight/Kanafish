import { describe, expect, test } from 'bun:test'
import {
  MAGPIE_RUNTIME,
  isPinnedMagpieArtifactPath,
  isPathWithinDirectory,
  normalizeMagpieError,
  parseNemoFeatures,
  parseNemoVersion,
  supportsJapaneseHttpTts,
  wavDurationSeconds
} from '../src/main/tts/magpieRuntime.js'

function makeMonoWav(durationSeconds = 1, sampleRate = 22_050) {
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

describe('native Magpie runtime helpers', () => {
  test('pins the current v2607 model and keeps voices to its five named speakers', () => {
    expect(MAGPIE_RUNTIME.modelRevision).toBe('19806879b16d3f2ccf28fb112b1bcd16a3c7923e')
    expect(MAGPIE_RUNTIME.codecRevision).toBe('fc00890b604aa2de298d2641ffc6c5f6caf8c4d7')
    expect(MAGPIE_RUNTIME.voices).toEqual(['Aria', 'Jason', 'John', 'Leo', 'Sofia'])
  })

  test('accepts only the pinned model and codec revision path segments', () => {
    expect(isPinnedMagpieArtifactPath('tts', `/cache/${MAGPIE_RUNTIME.modelRevision}/model.gguf`)).toBe(true)
    expect(isPinnedMagpieArtifactPath('tokenizer', `C:\\cache\\${MAGPIE_RUNTIME.modelRevision}\\tokenizer`)).toBe(true)
    expect(isPinnedMagpieArtifactPath('codec', `/cache/${MAGPIE_RUNTIME.codecRevision}/decoder.gguf`)).toBe(true)
    expect(isPinnedMagpieArtifactPath('codec', `/cache/${MAGPIE_RUNTIME.modelRevision}/decoder.gguf`)).toBe(false)
    expect(isPinnedMagpieArtifactPath('other', `/cache/${MAGPIE_RUNTIME.codecRevision}/file`)).toBe(false)
  })

  test('recognizes only a recent NeMo runtime built with the Japanese HTTP TTS features', () => {
    const version = 'nemo-speech 0.3.0\n'
    const features = 'NeMo-Speech.cpp 0.3.0\nFeatures: http model_pull tts tts_japanese\n'
    expect(parseNemoVersion(version)).toEqual([0, 3, 0])
    expect(parseNemoFeatures(features)).toEqual(['http', 'model_pull', 'tts', 'tts_japanese'])
    expect(supportsJapaneseHttpTts(version, features)).toBe(true)
    expect(supportsJapaneseHttpTts('nemo-speech 0.2.9', features)).toBe(false)
    expect(supportsJapaneseHttpTts(version, 'Features: http model_pull tts')).toBe(false)
  })

  test('does not treat paths outside the local cache as valid model artifacts', () => {
    expect(isPathWithinDirectory('/home/user/cache', '/home/user/cache/model.gguf')).toBe(true)
    expect(isPathWithinDirectory('/home/user/cache', '/home/user/cache-escape/model.gguf')).toBe(false)
    expect(isPathWithinDirectory('/home/user/cache', '/home/user/cache/../outside.gguf')).toBe(false)
  })

  test('reads mono PCM16 WAV duration and rejects malformed files', () => {
    expect(wavDurationSeconds(makeMonoWav(1.25))).toBeCloseTo(1.25, 5)
    expect(wavDurationSeconds(Buffer.from('not a wav'))).toBeNull()
  })

  test('translates a missing Japanese frontend into actionable setup guidance', () => {
    const error = normalizeMagpieError(new Error("native Magpie tokenizer is not available for language_code 'ja'"))
    expect(error).toContain('NEMO_SPEECH_TTS_WITH_JA=ON')
    expect(normalizeMagpieError(new Error('a different error'))).toBe('a different error')
  })
})
