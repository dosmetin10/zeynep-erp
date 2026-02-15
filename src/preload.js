const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mtnApi', {
  saveBackup: (payload) => ipcRenderer.invoke('backup:save', payload),
  loadBackup: () => ipcRenderer.invoke('backup:load'),
  exportCsvReport: (payload) => ipcRenderer.invoke('report:exportCsv', payload),
});
