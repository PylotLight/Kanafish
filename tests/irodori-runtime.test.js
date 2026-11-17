import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createIrodoriRuntime, IRODORI_TTS_RUNTIME, isPathWithinDirectory, wavDurationSeconds } from '../src/main/tts/irodoriRuntime.js'

function makeWav(sampleRate = 48_000, seconds = 1) {
  const channels = 1
  const bytesPerSample = 2
  const dataBytes = sampleRate * seconds * channels * bytesPerSample
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  wav.writeUInt16LE(channels * bytesPerSample, 32)
  wav.writeUInt16LE(bytesPerSample * 8, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  return wav
}

describe('Irodori runtime manager', () => {
  test('pins the expected v4.1-Small model and codec revisions with SHA-256 digests', () => {
    expect(IRODORI_TTS_RUNTIME.id).toBe('irodori-v4.1-small')
    expect(IRODORI_TTS_RUNTIME.modelRevision).toBe('2b28324dc263ed5e6638b3cf3dd94c82ead07b4b')
    expect(IRODORI_TTS_RUNTIME.codecRevision).toBe('47376ee24834d7a05a48ebabfe3cde29b3c5e214')
    expect(IRODORI_TTS_RUNTIME.approximateBytes).toBe(3_500_634_824)
    expect(IRODORI_TTS_RUNTIME.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  })

  test('validates the RIFF/WAVE sample duration and rejects malformed buffers', () => {
    expect(wavDurationSeconds(makeWav(48_000, 1.25))).toBe(1.25)
    expect(wavDurationSeconds(Buffer.from('not a wav'))).toBeNull()
  })

  test('resumes from valid individual files, replaces a partial file, and verifies the final manifest', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kanafish-irodori-cache-test-'))
    const first = Buffer.from('verified-model-part')
    const second = Buffer.from('verified-codec-part')
    const config = {
      id: 'irodori-test',
      name: 'Irodori test fixture',
      modelRepo: 'example/model',
      modelRevision: 'model-revision',
      sourceRepo: 'example/source',
      sourceCommit: 'source-commit',
      codecRepo: 'example/codec',
      codecRevision: 'codec-revision',
      weightsLicense: 'MIT',
      codeLicense: 'MIT',
      codecLicense: 'MIT',
      files: [
        { role: 'checkpoint', name: 'model.bin', repo: 'example/model', revision: 'model-revision', size: first.length, sha256: createHash('sha256').update(first).digest('hex') },
        { role: 'codec', name: 'nested/codec.bin', repo: 'example/codec', revision: 'codec-revision', size: second.length, sha256: createHash('sha256').update(second).digest('hex') }
      ]
    }
    const cacheRoot = join(userDataDir, 'tts-models', config.id)
    const firstPath = join(cacheRoot, 'model.bin')
    const secondPath = join(cacheRoot, 'nested', 'codec.bin')
    const fetches = []
    const runtime = createIrodoriRuntime({
      userDataDir,
      env: { PATH: '' },
      home: userDataDir,
      platform: 'linux',
      pythonEnvRoot: join(userDataDir, 'missing-venv'),
      pythonExecutable: join(userDataDir, 'missing-venv', 'bin', 'python'),
      assetRoot: userDataDir,
      runtimeConfig: config,
      fetchImpl: async (url) => {
        fetches.push(url)
        return new Response(second)
      }
    })
    try {
      await mkdir(dirname(firstPath), { recursive: true })
      await mkdir(dirname(secondPath), { recursive: true })
      await writeFile(firstPath, first)
      await writeFile(secondPath, Buffer.from('partial'))
      const partialStatus = await runtime.getStatus()
      expect(partialStatus.modelInstalled).toBe(false)
      expect(partialStatus.downloadedBytes).toBe(first.length)
      expect(partialStatus.files.map((file) => file.downloaded)).toEqual([true, false])
      expect(isPathWithinDirectory(cacheRoot, firstPath)).toBe(true)
      expect(isPathWithinDirectory(cacheRoot, join(userDataDir, 'outside.bin'))).toBe(false)

      const result = await runtime.downloadModel()
      expect(fetches).toHaveLength(1)
      expect(fetches[0]).toContain('/example/codec/resolve/codec-revision/nested/codec.bin')
      expect(result.modelInstalled).toBe(true)
      expect(result.downloadedBytes).toBe(first.length + second.length)
      expect(result.files.every((file) => file.downloaded)).toBe(true)
      expect(await readFile(secondPath)).toEqual(second)
    } finally {
      await runtime.stop().catch(() => {})
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
