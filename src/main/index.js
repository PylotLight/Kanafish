import { app, BrowserWindow, ipcMain, protocol, session, shell, systemPreferences } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadTtsModel, getTtsModelStatus, serveTtsModelAsset } from './tts/modelStore.js'
import { createMagpieRuntime } from './tts/magpieRuntime.js'
import { createQwenRuntime } from './tts/qwenRuntime.js'
import { createIrodoriRuntime } from './tts/irodoriRuntime.js'
import { createIrodoriMfOnnxRuntime } from './tts/irodoriMfRuntime.js'
import { createNativeRuntimeSetup } from './tts/nativeRuntimeSetup.js'
import { createMioRuntime } from './tts/mioRuntime.js'
import { createHaasAsrRuntime } from './asr/haasRuntime.js'
import { isAppOrigin, isAudioMediaPermissionCheck, isAudioOnlyMediaRequest } from './asr/mediaPermissions.js'

import { pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const rendererIndexPath = join(here, '../renderer/index.html')
const packagedRendererUrl = pathToFileURL(rendererIndexPath).href
const isMac = process.platform === 'darwin'
let mainWindow
let magpieRuntime
let qwenRuntime
let nativeRuntimeSetup
let irodoriRuntime
let irodoriMfOnnxRuntime
let mioRuntime
let asrRuntime
let quittingAfterTtsStop = false

protocol.registerSchemesAsPrivileged([{
  scheme: 'kanafish-cache',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    transparent: isMac,
    vibrancy: isMac ? 'fullscreen-ui' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: isMac ? '#00000000' : '#edf1eb',
    title: 'Kanafish',
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(rendererIndexPath)
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = undefined })
}

app.whenReady().then(async () => {
  await protocol.handle('kanafish-cache', serveTtsModelAsset)
  nativeRuntimeSetup = createNativeRuntimeSetup({
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:native-runtime-setup-progress', progress)
    }
  })
  magpieRuntime = createMagpieRuntime({
    userDataDir: app.getPath('userData'),
    nativeRuntimeSetup,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:magpie-progress', progress)
    }
  })
  qwenRuntime = createQwenRuntime({
    userDataDir: app.getPath('userData'),
    nativeRuntimeSetup,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:qwen-progress', progress)
    }
  })
  irodoriRuntime = createIrodoriRuntime({
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:irodori-progress', progress)
    }
  })
  irodoriMfOnnxRuntime = createIrodoriMfOnnxRuntime({
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:irodori-mf-onnx-progress', progress)
    }
  })
  mioRuntime = createMioRuntime({
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:mio-progress', progress)
    }
  })
  asrRuntime = createHaasAsrRuntime({
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:asr-progress', progress)
    }
  })
  // Microphone for on-device speech recognition: allow audio capture for the app's own renderer page only; deny all
  // unrelated permission types and any request from another page or subframe.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'media') return callback(false)
    const requestingUrl = details?.requestingUrl || webContents?.getURL?.()
    callback(isAppOrigin(requestingUrl, process.env.ELECTRON_RENDERER_URL, packagedRendererUrl) && isAudioOnlyMediaRequest(details))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
    if (permission !== 'media') return false
    return isAppOrigin(details?.requestingUrl || _requestingOrigin, process.env.ELECTRON_RENDERER_URL, packagedRendererUrl) && isAudioMediaPermissionCheck(details)
  })
  ipcMain.handle('kanafish:exit-app', () => app.quit())
  ipcMain.handle('kanafish:tts-model-status', () => getTtsModelStatus())
  ipcMain.handle('kanafish:tts-download-model', (event) => downloadTtsModel('supertonic-3', {
    onProgress: (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('kanafish:tts-download-progress', progress)
    }
  }))
  ipcMain.handle('kanafish:magpie-status', () => magpieRuntime.getStatus())
  ipcMain.handle('kanafish:magpie-setup-runtime', () => magpieRuntime.setupRuntime())
  ipcMain.handle('kanafish:magpie-cancel-runtime-setup', () => magpieRuntime.cancelRuntimeSetup())
  ipcMain.handle('kanafish:magpie-download-model', () => magpieRuntime.downloadModel())
  ipcMain.handle('kanafish:magpie-synthesize', (_event, request = {}) => magpieRuntime.synthesize(request.text, { voice: request.voice }))
  ipcMain.handle('kanafish:qwen-status', () => qwenRuntime.getStatus())
  ipcMain.handle('kanafish:qwen-setup-runtime', () => qwenRuntime.setupRuntime())
  ipcMain.handle('kanafish:qwen-cancel-runtime-setup', () => qwenRuntime.cancelRuntimeSetup())
  ipcMain.handle('kanafish:qwen-download-model', () => qwenRuntime.downloadModel())
  ipcMain.handle('kanafish:qwen-synthesize', (_event, request = {}) => qwenRuntime.synthesize(request.text, { voice: request.voice }))
  ipcMain.handle('kanafish:irodori-status', () => irodoriRuntime.getStatus())
  ipcMain.handle('kanafish:irodori-download-model', () => irodoriRuntime.downloadModel())
  ipcMain.handle('kanafish:irodori-setup-python', () => irodoriRuntime.setupPythonRuntime())
  ipcMain.handle('kanafish:irodori-synthesize', (_event, request = {}) => irodoriRuntime.synthesize(request.text))
  ipcMain.handle('kanafish:irodori-clear-model-cache', () => irodoriRuntime.removeModelCache())
  ipcMain.handle('kanafish:irodori-remove-python-runtime', () => irodoriRuntime.removePythonRuntime())
  ipcMain.handle('kanafish:irodori-mf-onnx-status', () => irodoriMfOnnxRuntime.getStatus())
  ipcMain.handle('kanafish:irodori-mf-onnx-download-model', () => irodoriMfOnnxRuntime.downloadModel())
  ipcMain.handle('kanafish:irodori-mf-onnx-cancel-download', () => irodoriMfOnnxRuntime.cancelDownload())
  ipcMain.handle('kanafish:irodori-mf-onnx-remove-model', () => irodoriMfOnnxRuntime.removeModel())
  ipcMain.handle('kanafish:irodori-mf-onnx-synthesize', (_event, request = {}) => irodoriMfOnnxRuntime.synthesize(request.text))
  ipcMain.handle('kanafish:mio-status', () => mioRuntime.getStatus())
  ipcMain.handle('kanafish:mio-setup-runtime', () => mioRuntime.setupRuntime())
  ipcMain.handle('kanafish:mio-download-model', () => mioRuntime.downloadModel())
  ipcMain.handle('kanafish:mio-synthesize', (_event, request = {}) => mioRuntime.synthesize(request.text, { voice: request.voice }))
  ipcMain.handle('kanafish:mio-remove-model-cache', () => mioRuntime.removeModelCache())
  ipcMain.handle('kanafish:mio-remove-runtime', () => mioRuntime.removeRuntime())
  ipcMain.handle('kanafish:asr-status', () => asrRuntime.getStatus())
  ipcMain.handle('kanafish:asr-setup-runtime', () => asrRuntime.setupRuntime())
  ipcMain.handle('kanafish:asr-cancel-runtime-setup', () => asrRuntime.cancelRuntimeSetup())
  ipcMain.handle('kanafish:asr-warm', () => asrRuntime.warmWorker())
  ipcMain.handle('kanafish:asr-download-model', () => asrRuntime.downloadModel())
  ipcMain.handle('kanafish:asr-cancel-model-download', () => asrRuntime.cancelModelDownload())
  ipcMain.handle('kanafish:asr-transcribe', (_event, request = {}) => {
    const audio = request?.audio
    if (!(audio instanceof Uint8Array)) throw new Error('Speech recognition needs WAV bytes.')
    return asrRuntime.transcribe(audio, { timestamps: request.timestamps !== false })
  })
  ipcMain.handle('kanafish:asr-cancel-transcription', () => asrRuntime.cancelTranscription())
  ipcMain.handle('kanafish:asr-remove-model', () => asrRuntime.removeModelCache())
  ipcMain.handle('kanafish:asr-remove-runtime', () => asrRuntime.removeRuntime())
  ipcMain.handle('kanafish:request-microphone-access', async () => {
    if (process.platform !== 'darwin') return { granted: true, status: 'not-applicable' }
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'granted') return { granted: true, status }
    if (status === 'denied' || status === 'restricted') return { granted: false, status }
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return { granted, status: granted ? 'granted' : 'denied' }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if ((!magpieRuntime && !qwenRuntime && !irodoriRuntime && !irodoriMfOnnxRuntime && !mioRuntime && !asrRuntime) || quittingAfterTtsStop) return
  event.preventDefault()
  quittingAfterTtsStop = true
  void Promise.allSettled([nativeRuntimeSetup?.cancel(), magpieRuntime?.stop(), qwenRuntime?.stop(), irodoriRuntime?.stop(), irodoriMfOnnxRuntime?.stop(), mioRuntime?.stop(), asrRuntime?.stop()]).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
