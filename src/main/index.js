import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadTtsModel, getTtsModelStatus, serveTtsModelAsset } from './tts/modelStore.js'
import { createMagpieRuntime } from './tts/magpieRuntime.js'
import { createQwenRuntime } from './tts/qwenRuntime.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const isMac = process.platform === 'darwin'
let mainWindow
let magpieRuntime
let qwenRuntime
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
    mainWindow.loadFile(join(here, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = undefined })
}

app.whenReady().then(async () => {
  await protocol.handle('kanafish-cache', serveTtsModelAsset)
  magpieRuntime = createMagpieRuntime({
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:magpie-progress', progress)
    }
  })
  qwenRuntime = createQwenRuntime({
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('kanafish:qwen-progress', progress)
    }
  })
  ipcMain.handle('kanafish:exit-app', () => app.quit())
  ipcMain.handle('kanafish:tts-model-status', () => getTtsModelStatus())
  ipcMain.handle('kanafish:tts-download-model', (event) => downloadTtsModel('supertonic-3', {
    onProgress: (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('kanafish:tts-download-progress', progress)
    }
  }))
  ipcMain.handle('kanafish:magpie-status', () => magpieRuntime.getStatus())
  ipcMain.handle('kanafish:magpie-download-model', () => magpieRuntime.downloadModel())
  ipcMain.handle('kanafish:magpie-synthesize', (_event, request = {}) => magpieRuntime.synthesize(request.text, { voice: request.voice }))
  ipcMain.handle('kanafish:qwen-status', () => qwenRuntime.getStatus())
  ipcMain.handle('kanafish:qwen-download-model', () => qwenRuntime.downloadModel())
  ipcMain.handle('kanafish:qwen-synthesize', (_event, request = {}) => qwenRuntime.synthesize(request.text, { voice: request.voice }))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if ((!magpieRuntime && !qwenRuntime) || quittingAfterTtsStop) return
  event.preventDefault()
  quittingAfterTtsStop = true
  void Promise.allSettled([magpieRuntime?.stop(), qwenRuntime?.stop()]).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
