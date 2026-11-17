import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('kanafish', Object.freeze({
  exitApp: () => ipcRenderer.invoke('kanafish:exit-app'),
  getTtsModelStatus: () => ipcRenderer.invoke('kanafish:tts-model-status'),
  downloadTtsModel: () => ipcRenderer.invoke('kanafish:tts-download-model'),
  onTtsDownloadProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:tts-download-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:tts-download-progress', listener)
  },
  getMagpieStatus: () => ipcRenderer.invoke('kanafish:magpie-status'),
  downloadMagpieModel: () => ipcRenderer.invoke('kanafish:magpie-download-model'),
  synthesizeMagpie: (request) => ipcRenderer.invoke('kanafish:magpie-synthesize', request),
  onMagpieProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:magpie-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:magpie-progress', listener)
  },
  getQwenStatus: () => ipcRenderer.invoke('kanafish:qwen-status'),
  downloadQwenModel: () => ipcRenderer.invoke('kanafish:qwen-download-model'),
  synthesizeQwen: (request) => ipcRenderer.invoke('kanafish:qwen-synthesize', request),
  onQwenProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:qwen-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:qwen-progress', listener)
  }
}))
