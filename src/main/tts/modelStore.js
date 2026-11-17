import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { dirname, extname } from 'node:path'
import {
  getHfHubCacheRoot,
  getTtsModel,
  getTtsModelFilePath
} from './modelRegistry.js'

const inflightDownloads = new Map()
const verifiedAssets = new Set()

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
    cachePath: getTtsModelFilePath(modelId, model.files[0].path, cacheRoot).replace(/[/\\]onnx[/\\]tts\.json$/, '')
  }
}

async function downloadModel(modelId, { cacheRoot = getHfHubCacheRoot(), fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const model = getTtsModel(modelId)
  if (!model) throw new Error(`Unknown TTS model: ${modelId}`)
  if (typeof fetchImpl !== 'function') throw new Error('This runtime does not support downloads')

  const initialStatus = await getTtsModelStatus(modelId, cacheRoot)
  let downloadedBytes = initialStatus.downloadedBytes
  const totalBytes = initialStatus.totalBytes
  const statusByPath = new Map(initialStatus.files.map((file) => [file.path, file]))
  onProgress({ modelId, file: '', downloadedBytes, totalBytes, completedFiles: initialStatus.files.filter((file) => file.downloaded).length, totalFiles: model.files.length })

  for (const file of model.files) {
    if (statusByPath.get(file.path)?.downloaded) continue
    const filePath = getTtsModelFilePath(modelId, file.path, cacheRoot)
    const partPath = `${filePath}.part`
    await mkdir(dirname(filePath), { recursive: true })
    let handle
    try {
      const url = `https://huggingface.co/${model.repoId}/resolve/${model.revision}/${file.path}`
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(300_000) })
      if (!response.ok) throw new Error(`Hugging Face download failed (${response.status}) for ${file.path}`)
      if (!response.body) throw new Error(`Hugging Face returned an empty file for ${file.path}`)
      handle = await open(partPath, 'w')
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let fileBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await handle.write(value)
        hash.update(value)
        fileBytes += value.byteLength
        onProgress({ modelId, file: file.path, downloadedBytes: downloadedBytes + fileBytes, totalBytes, fileBytes, fileSize: file.size, completedFiles: initialStatus.files.filter((item) => item.downloaded).length + model.files.indexOf(file), totalFiles: model.files.length })
      }
      const actualHash = hash.digest('hex')
      await handle.sync()
      await handle.close()
      handle = undefined
      const written = await stat(partPath)
      if (written.size !== file.size) throw new Error(`Downloaded size mismatch for ${file.path}: expected ${file.size}, got ${written.size}`)
      if (actualHash !== file.sha256) throw new Error(`SHA-256 mismatch for ${file.path}; the downloaded file did not match the pinned model revision`)
      await rename(partPath, filePath)
      verifiedAssets.add(filePath)
      downloadedBytes += file.size
      onProgress({ modelId, file: file.path, downloadedBytes, totalBytes, fileBytes: file.size, fileSize: file.size, completedFiles: model.files.indexOf(file) + 1, totalFiles: model.files.length })
    } catch (error) {
      await handle?.close().catch(() => {})
      await rm(partPath, { force: true }).catch(() => {})
      throw error
    }
  }

  return getTtsModelStatus(modelId, cacheRoot)
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
