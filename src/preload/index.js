import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('kanafish', Object.freeze({
  exitApp: () => ipcRenderer.invoke('kanafish:exit-app')
}))
