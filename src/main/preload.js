const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('../shared/constants');

contextBridge.exposeInMainWorld('erpApi', {
  setupAdmin: (payload) => ipcRenderer.invoke(IPC.authSetup, payload),
  login: (payload) => ipcRenderer.invoke(IPC.authLogin, payload),
  openModuleWindow: (payload) => ipcRenderer.invoke(IPC.openModuleWindow, payload),
  listData: (payload) => ipcRenderer.invoke(IPC.dataList, payload),
  createData: (payload) => ipcRenderer.invoke(IPC.dataCreate, payload),
  createSales: (payload) => ipcRenderer.invoke(IPC.salesCreate, payload),
  createPayment: (payload) => ipcRenderer.invoke(IPC.paymentsCreate, payload),
  reportSummary: (payload) => ipcRenderer.invoke(IPC.reportSummary, payload),
  createBackup: (payload) => ipcRenderer.invoke(IPC.backupCreate, payload),
  restoreBackup: (payload) => ipcRenderer.invoke(IPC.backupRestore, payload),
  importLegacyJson: (payload) => ipcRenderer.invoke(IPC.legacyImport, payload),
  onWindowParams: (cb) => ipcRenderer.on('window:params', (_event, params) => cb(params)),
});
