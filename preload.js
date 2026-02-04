const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) =>
    ipcRenderer.on('open-file', (_, filePath) => callback(filePath))
});