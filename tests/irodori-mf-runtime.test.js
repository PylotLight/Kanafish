import { describe, expect, test } from 'bun:test'
import {
  assertIrodoriMfFreeSpace,
  createIrodoriMfOnnxRuntime,
  getIrodoriMfRequiredFreeBytes,
  IRODORI_MF_DISK_RESERVE_BYTES,
  validateIrodoriMfText
} from '../src/main/tts/irodoriMfRuntime.js'

const incompleteStatus = {
  installed: false,
  files: [
    { size: 100, downloaded: true },
    { size: 300, downloaded: false }
  ]
}

describe('Irodori v4.1-Small-MF runtime safeguards', () => {
  test('preflights only missing model bytes plus a temporary-file reserve', () => {
    expect(IRODORI_MF_DISK_RESERVE_BYTES).toBe(128 * 1024 * 1024)
    expect(getIrodoriMfRequiredFreeBytes(incompleteStatus)).toBe(300 + IRODORI_MF_DISK_RESERVE_BYTES)
    expect(() => assertIrodoriMfFreeSpace(incompleteStatus, 300 + IRODORI_MF_DISK_RESERVE_BYTES - 1))
      .toThrow(/Not enough free disk space/)
    expect(() => assertIrodoriMfFreeSpace(incompleteStatus, 300 + IRODORI_MF_DISK_RESERVE_BYTES)).not.toThrow()
  })

  test('rejects empty or oversized text while preserving valid Japanese input', () => {
    expect(validateIrodoriMfText('  こんにちは。  ')).toBe('こんにちは。')
    expect(() => validateIrodoriMfText('  ')).toThrow(/Enter Japanese text/)
    expect(() => validateIrodoriMfText('あ'.repeat(501))).toThrow(/up to 500 characters/)
  })

  test('prevents overlapping synthesis calls in the runtime', async () => {
    const runtime = createIrodoriMfOnnxRuntime({
      cacheRoot: '/tmp/kanafish-mf-runtime-test',
      getModelStatus: async () => ({ installed: true, files: [] }),
      inferenceFactory: async () => ({
        synthesize: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return { audio: Buffer.alloc(46), durationSeconds: 0.001, sampleRate: 48_000, metrics: {} }
        }
      })
    })
    const first = runtime.synthesize('こんにちは。')
    await expect(runtime.synthesize('こんばんは。')).rejects.toThrow(/already running/)
    await expect(first).resolves.toMatchObject({ sampleRate: 48_000 })
    await runtime.stop()
  })

  test('rejects a large download before invoking the model downloader', async () => {
    let downloadCalls = 0
    const runtime = createIrodoriMfOnnxRuntime({
      cacheRoot: '/tmp/kanafish-mf-runtime-test',
      getModelStatus: async () => incompleteStatus,
      makeDirectory: async () => {},
      getFilesystemStats: async () => ({ bavail: 1, bsize: 1 }),
      downloadModelAssets: async () => { downloadCalls += 1 }
    })
    await expect(runtime.downloadModel()).rejects.toThrow(/Not enough free disk space/)
    expect(downloadCalls).toBe(0)
  })
})
