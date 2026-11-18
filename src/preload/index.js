import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('kanafish', Object.freeze({
  platform: process.platform,
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
  setupMagpieRuntime: () => ipcRenderer.invoke('kanafish:magpie-setup-runtime'),
  cancelMagpieRuntimeSetup: () => ipcRenderer.invoke('kanafish:magpie-cancel-runtime-setup'),
  downloadMagpieModel: () => ipcRenderer.invoke('kanafish:magpie-download-model'),
  synthesizeMagpie: (request) => ipcRenderer.invoke('kanafish:magpie-synthesize', request),
  onMagpieProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:magpie-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:magpie-progress', listener)
  },
  getQwenStatus: () => ipcRenderer.invoke('kanafish:qwen-status'),
  setupQwenRuntime: () => ipcRenderer.invoke('kanafish:qwen-setup-runtime'),
  cancelQwenRuntimeSetup: () => ipcRenderer.invoke('kanafish:qwen-cancel-runtime-setup'),
  downloadQwenModel: () => ipcRenderer.invoke('kanafish:qwen-download-model'),
  synthesizeQwen: (request) => ipcRenderer.invoke('kanafish:qwen-synthesize', request),
  onQwenProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:qwen-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:qwen-progress', listener)
  },
  onNativeRuntimeSetupProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:native-runtime-setup-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:native-runtime-setup-progress', listener)
  },
  getIrodoriStatus: () => ipcRenderer.invoke('kanafish:irodori-status'),
  downloadIrodoriModel: () => ipcRenderer.invoke('kanafish:irodori-download-model'),
  setupIrodoriPython: () => ipcRenderer.invoke('kanafish:irodori-setup-python'),
  synthesizeIrodori: (request) => ipcRenderer.invoke('kanafish:irodori-synthesize', request),
  clearIrodoriModelCache: () => ipcRenderer.invoke('kanafish:irodori-clear-model-cache'),
  removeIrodoriPythonRuntime: () => ipcRenderer.invoke('kanafish:irodori-remove-python-runtime'),
  getIrodoriMfOnnxStatus: () => ipcRenderer.invoke('kanafish:irodori-mf-onnx-status'),
  downloadIrodoriMfOnnxModel: () => ipcRenderer.invoke('kanafish:irodori-mf-onnx-download-model'),
  cancelIrodoriMfOnnxDownload: () => ipcRenderer.invoke('kanafish:irodori-mf-onnx-cancel-download'),
  removeIrodoriMfOnnxModel: () => ipcRenderer.invoke('kanafish:irodori-mf-onnx-remove-model'),
  synthesizeIrodoriMfOnnx: (request) => ipcRenderer.invoke('kanafish:irodori-mf-onnx-synthesize', request),
  onIrodoriMfOnnxProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:irodori-mf-onnx-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:irodori-mf-onnx-progress', listener)
  },
  onIrodoriProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:irodori-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:irodori-progress', listener)
  },
  getMioStatus: () => ipcRenderer.invoke('kanafish:mio-status'),
  setupMioRuntime: () => ipcRenderer.invoke('kanafish:mio-setup-runtime'),
  downloadMioModel: () => ipcRenderer.invoke('kanafish:mio-download-model'),
  synthesizeMio: (request) => ipcRenderer.invoke('kanafish:mio-synthesize', request),
  removeMioModelCache: () => ipcRenderer.invoke('kanafish:mio-remove-model-cache'),
  removeMioRuntime: () => ipcRenderer.invoke('kanafish:mio-remove-runtime'),
  onMioProgress: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('kanafish:mio-progress', listener)
    return () => ipcRenderer.removeListener('kanafish:mio-progress', listener)
  }
}))
