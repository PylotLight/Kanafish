import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { dirname, extname } from 'node:path'
import {
  getHfHubCacheRoot,
  getModelSnapshotDirectory,
  getTtsModel,
  getTtsModelFilePath
} from './modelRegistry.js'

const inflightDownloads = new Map()
const verifiedAssets = new Set()
const MAX_DOWNLOAD_ATTEMPTS = 5
const INACTIVITY_TIMEOUT_MS = 60_000
const DOWNLOAD_CONCURRENCY = 3
const WRITE_BATCH_BYTES = 4 * 1024 * 1024

async function matchesSha256(path, expected) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const valid = hash.digest('hex') === expected
  if (valid) verifiedAssets.add(path)
  else verifiedAssets.delete(path)
  return valid
}

async function formatFileStatus(file, path, fileStat) {
  const sized = Boolean(fileStat && fileStat.isFile() && fileStat.size === file.size)
  const valid = sized && (verifiedAssets.has(path) || await matchesSha256(path, file.sha256))
  return { path: file.path, size: file.size, downloaded: valid, downloadedBytes: valid ? file.size : 0 }
}

async function fileStatOrNull(path) {
  try {
    return await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function getTtsModelStatus(modelId = 'supertonic-3', cacheRoot = getHfHubCacheRoot()) {
  const model = getTtsModel(modelId)
  if (!model) throw new Error(`Unknown TTS model: ${modelId}`)
  const files = await Promise.all(model.files.map(async (file) => {
    const path = getTtsModelFilePath(modelId, file.path, cacheRoot)
    return formatFileStatus(file, path, await fileStatOrNull(path))
  }))
  const totalBytes = model.files.reduce((sum, file) => sum + file.size, 0)
  const downloadedBytes = files.reduce((sum, file) => sum + file.downloadedBytes, 0)
  return {
    id: model.id,
    name: model.name,
    repoId: model.repoId,
    revision: model.revision,
    modelCardUrl: model.modelCardUrl,
    weightsLicense: model.weightsLicense,
    files,
    totalBytes,
    downloadedBytes,
    installed: files.every((file) => file.downloaded),
    cachePath: getModelSnapshotDirectory(modelId, cacheRoot)
  }
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
}

function raceWithAbort(promise, signal) {
  if (!signal) return promise
  checkAbort(signal)
  let onAbort
  const aborted = new Promise((_, rejectPromise) => {
    onAbort = () => rejectPromise(signal.reason || new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', onAbort))
}

function isTransient(error) {
  const code = error?.code || error?.cause?.code
  return Boolean(error?.retryable) || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code)
}

function timeoutError(message) {
  return Object.assign(new Error(message), { code: 'ETIMEDOUT', retryable: true })
}

function waitForRetry(ms, signal) {
  checkAbort(signal)
  return new Promise((resolvePromise, rejectPromise) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timer = setTimeout(() => { cleanup(); resolvePromise() }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      rejectPromise(signal.reason || new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

export async function downloadVerifiedFile({
  url,
  file,
  path,
  partPath = `${path}.part`,
  fetchImpl = globalThis.fetch,
  signal,
  onProgress = () => {},
  modelId = '',
  totalBytes = file.size,
  downloadedBytes = 0,
  completedFiles = 0,
  totalFiles = 0,
  maxAttempts = MAX_DOWNLOAD_ATTEMPTS,
  inactivityTimeoutMs = INACTIVITY_TIMEOUT_MS
}) {
  let lastReport = 0
  let lastBytes = -1
  const progress = (bytes, terminal = false) => {
    const now = Date.now()
    if (terminal || bytes === file.size || bytes - lastBytes >= 256 * 1024 || now - lastReport >= 250) {
      try {
        onProgress({ modelId, file: file.path, fileBytes: bytes, fileSize: file.size, downloadedBytes: downloadedBytes + bytes, totalBytes, completedFiles, totalFiles, terminal })
      } catch {}
      lastReport = now
      lastBytes = bytes
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    checkAbort(signal)
    const partialInfo = await fileStatOrNull(partPath)
    let offset = partialInfo?.isFile() ? partialInfo.size : 0
    if (partialInfo && !partialInfo.isFile()) {
      await rm(partPath, { recursive: true, force: true })
      offset = 0
    }
    if (offset > file.size) {
      await rm(partPath, { force: true })
      offset = 0
    }
    if (offset === file.size) {
      if (await matchesSha256(partPath, file.sha256)) {
        await rename(partPath, path)
        verifiedAssets.add(path)
        progress(file.size, true)
        return
      }
      await rm(partPath, { force: true })
      offset = 0
    }

    const controller = new AbortController()
    const relay = () => controller.abort(signal.reason || new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', relay, { once: true })
    if (signal?.aborted) relay()
    let handle
    let reader
    let flush = async () => {}
    try {
      const headers = offset ? { Range: `bytes=${offset}-` } : {}
      let headerTimer
      const headerTimeout = new Promise((_, rejectPromise) => {
        headerTimer = setTimeout(() => {
          const error = timeoutError(`Timed out waiting for Hugging Face response headers for ${file.path}`)
          controller.abort(error)
          rejectPromise(error)
        }, inactivityTimeoutMs)
      })
      let response
      try {
        response = await raceWithAbort(Promise.race([fetchImpl(url, { signal: controller.signal, headers }), headerTimeout]), signal)
      } finally {
        clearTimeout(headerTimer)
      }

      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        await Promise.resolve(response.body?.cancel?.()).catch(() => {})
        throw Object.assign(new Error(`Hugging Face download failed (${response.status}) for ${file.path}`), { retryable: true })
      }
      if (offset && response.status === 200) {
        offset = 0
      } else if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers?.get?.('content-range') || '')
        if (!range || Number(range[1]) !== offset || Number(range[3]) !== file.size || Number(range[2]) < offset || Number(range[2]) >= file.size) {
          await Promise.resolve(response.body?.cancel?.()).catch(() => {})
          await rm(partPath, { force: true })
          continue
        }
      } else if (response.status !== 200) {
        await Promise.resolve(response.body?.cancel?.()).catch(() => {})
        throw new Error(`Hugging Face download failed (${response.status}) for ${file.path}`)
      }
      if (!response.body) throw Object.assign(new Error(`Hugging Face returned an empty file for ${file.path}`), { retryable: true })

      await mkdir(dirname(partPath), { recursive: true })
      handle = await open(partPath, offset ? 'a' : 'w')
      const hash = createHash('sha256')
      if (offset) for await (const chunk of createReadStream(partPath)) hash.update(chunk)
      reader = response.body.getReader()
      let bytes = offset
      let pending = []
      let pendingBytes = 0
      flush = async () => {
        if (!pendingBytes) return
        const buffer = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes)
        pending = []
        pendingBytes = 0
        let written = 0
        while (written < buffer.byteLength) {
          const writeResult = await handle.write(buffer, written, buffer.byteLength - written)
          if (!writeResult.bytesWritten) throw Object.assign(new Error(`Could not write downloaded bytes for ${file.path}`), { code: 'EIO', retryable: true })
          written += writeResult.bytesWritten
        }
      }
      while (true) {
        checkAbort(signal)
        let timer
        const bodyTimeout = new Promise((_, rejectPromise) => {
          timer = setTimeout(() => {
            const error = timeoutError(`Download body inactive for ${file.path}`)
            controller.abort(error)
            rejectPromise(error)
          }, inactivityTimeoutMs)
        })
        const result = await raceWithAbort(Promise.race([reader.read(), bodyTimeout]), signal).finally(() => clearTimeout(timer))
        if (result.done) break
        const chunk = Buffer.from(result.value)
        if (bytes + chunk.byteLength > file.size) {
          await rm(partPath, { force: true })
          throw new Error(`Downloaded file exceeded expected size for ${file.path}`)
        }
        pending.push(chunk)
        pendingBytes += chunk.byteLength
        if (pendingBytes >= WRITE_BATCH_BYTES) await flush()
        hash.update(chunk)
        bytes += chunk.byteLength
        progress(bytes)
      }
      await flush()
      await handle.sync()
      await handle.close()
      handle = null
      if (bytes !== file.size) throw Object.assign(new Error(`Downloaded size mismatch for ${file.path}: expected ${file.size}, got ${bytes}`), { retryable: true })
      if (hash.digest('hex') !== file.sha256) {
        await rm(partPath, { force: true })
        throw new Error(`SHA-256 mismatch for ${file.path}`)
      }
      await rename(partPath, path)
      verifiedAssets.add(path)
      progress(file.size, true)
      return
    } catch (error) {
      await reader?.cancel?.().catch(() => {})
      // Keep already-received bytes so a cancelled or interrupted download resumes from them.
      if (handle) await flush().catch(() => {})
      await handle?.close().catch(() => {})
      if (signal?.aborted) {
        progress((await fileStatOrNull(partPath))?.size || 0, true)
        throw signal.reason || error
      }
      if (!isTransient(error) || attempt + 1 >= maxAttempts) {
        progress((await fileStatOrNull(partPath))?.size || 0, true)
        throw error
      }
      await waitForRetry(Math.min(8_000, 250 * 2 ** attempt), signal)
    } finally {
      signal?.removeEventListener('abort', relay)
    }
  }
  throw new Error(`Could not download ${file.path} after ${maxAttempts} attempts.`)
}
async function downloadModel(modelId, { cacheRoot = getHfHubCacheRoot(), fetchImpl = globalThis.fetch, onProgress = () => {}, signal } = {}) {
  const model = getTtsModel(modelId)
  if (!model) throw new Error(`Unknown TTS model: ${modelId}`)
  if (typeof fetchImpl !== 'function') throw new Error('This runtime does not support downloads')
  const initialStatus = await getTtsModelStatus(modelId, cacheRoot)
  let downloadedBytes = initialStatus.downloadedBytes
  const totalBytes = initialStatus.totalBytes
  let completedFiles = initialStatus.files.filter(file => file.downloaded).length
  onProgress({ modelId, file: '', downloadedBytes, totalBytes, completedFiles, totalFiles: model.files.length })
  // Several files at once: one Hugging Face stream is often the bottleneck on slow links.
  const inflightBytes = new Map()
  const report = (extra = {}) => {
    let active = 0
    for (const bytes of inflightBytes.values()) active += bytes
    onProgress({ modelId, downloadedBytes: downloadedBytes + active, totalBytes, completedFiles, totalFiles: model.files.length, ...extra })
  }
  const local = new AbortController()
  const relayAbort = () => local.abort(signal.reason)
  if (signal?.aborted) relayAbort()
  else signal?.addEventListener('abort', relayAbort, { once: true })
  const queue = model.files.filter(file => !initialStatus.files.find(item => item.path === file.path)?.downloaded)
  let firstError = null
  const worker = async () => {
    try { await drain() } catch (error) {
      firstError ??= error
      if (!local.signal.aborted) local.abort(error)
    }
  }
  const drain = async () => {
    while (queue.length) {
      checkAbort(local.signal)
      const file = queue.shift()
      const filePath = getTtsModelFilePath(modelId,file.path,cacheRoot)
      await mkdir(dirname(filePath),{recursive:true})
      await rm(filePath, { force: true })
      inflightBytes.set(file.path, 0)
      await downloadVerifiedFile({
        url:`https://huggingface.co/${model.repoId}/resolve/${model.revision}/${file.path}`, file, path:filePath, fetchImpl, signal: local.signal, modelId,
        totalBytes, downloadedBytes: 0, completedFiles, totalFiles: model.files.length,
        onProgress: (progress) => {
          inflightBytes.set(file.path, progress.fileBytes || 0)
          report({ file: file.path, fileBytes: progress.fileBytes, fileSize: file.size })
        }
      })
      inflightBytes.delete(file.path)
      downloadedBytes += file.size
      completedFiles += 1
      report({ file:file.path, fileBytes:file.size, fileSize:file.size, terminal:true })
    }
  }
  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, () => worker())
  try {
    await Promise.all(workers)
  } finally {
    signal?.removeEventListener('abort', relayAbort)
  }
  if (firstError) throw signal?.aborted ? (signal.reason || firstError) : firstError
  return getTtsModelStatus(modelId,cacheRoot)
}

export function downloadTtsModel(modelId = 'supertonic-3', options = {}) {
  const existing = inflightDownloads.get(modelId)
  if (existing) return existing
  const task = downloadModel(modelId, options).finally(() => inflightDownloads.delete(modelId))
  inflightDownloads.set(modelId, task)
  return task
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin'
}

export async function serveTtsModelAsset(request, cacheRoot = getHfHubCacheRoot()) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  let url
  let assetPath
  try {
    url = new URL(request.url)
    assetPath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch {
    return new Response('Invalid model asset URL', { status: 400, headers: CORS_HEADERS })
  }
  const modelId = url.hostname
  if (!getTtsModel(modelId)) return new Response('Unknown model', { status: 404, headers: CORS_HEADERS })
  try {
    const model = getTtsModel(modelId)
    const file = model.files.find((item) => item.path === assetPath)
    if (!file) return new Response('Unknown model asset', { status: 404, headers: CORS_HEADERS })
    const filePath = getTtsModelFilePath(modelId, assetPath, cacheRoot)
    const fileInfo = await fileStatOrNull(filePath)
    if (!fileInfo?.isFile() || fileInfo.size !== file.size) return new Response('Model asset is not downloaded', { status: 404, headers: CORS_HEADERS })
    if (!verifiedAssets.has(filePath) && !await matchesSha256(filePath, file.sha256)) {
      return new Response('Model asset failed its pinned SHA-256 integrity check', { status: 409, headers: CORS_HEADERS })
    }
    const headers = {
      ...CORS_HEADERS,
      'Content-Length': String(fileInfo.size),
      'Content-Type': extname(assetPath) === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream'
    }
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
    const body = Readable.toWeb(createReadStream(filePath))
    return new Response(body, { status: 200, headers })
  } catch (error) {
    return new Response(`Unable to serve model asset: ${error.message}`, { status: 500, headers: CORS_HEADERS })
  }
}
