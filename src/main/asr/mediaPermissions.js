import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Packaged builds may capture audio only from their exact renderer index page. Development builds use the exact origin
// configured by ELECTRON_RENDERER_URL; permission checks reject every other origin and permission type.
export function isAppOrigin(url, devServerUrl = '', packagedRendererUrl = '') {
  if (typeof url !== 'string' || !url) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    if (!packagedRendererUrl || parsed.hostname || parsed.search) return false
    let packaged
    try {
      packaged = new URL(packagedRendererUrl)
    } catch {
      return false
    }
    if (packaged.protocol !== 'file:' || packaged.hostname || packaged.search) return false
    try {
      return resolve(fileURLToPath(parsed)) === resolve(fileURLToPath(packaged))
    } catch {
      return false
    }
  }

  if (!devServerUrl || parsed.username || parsed.password) return false
  try {
    const dev = new URL(devServerUrl)
    return (dev.protocol === 'http:' || dev.protocol === 'https:') && !dev.username && !dev.password && parsed.origin === dev.origin
  } catch {
    return false
  }
}

export function isAudioOnlyMediaRequest(details) {
  const types = Array.isArray(details?.mediaTypes) ? details.mediaTypes : []
  return details?.isMainFrame !== false && types.length > 0 && types.every((type) => type === 'audio')
}

export function isAudioMediaPermissionCheck(details) {
  return details?.isMainFrame !== false && details?.mediaType === 'audio'
}
