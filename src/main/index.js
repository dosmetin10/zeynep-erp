const path = require('path');
const { app } = require('electron');
const { WindowManager } = require('./windows/windowManager');
const { registerIpc } = require('./ipc/registerIpc');
const { openDb } = require('./db/db');
const { WINDOWS } = require('../shared/constants');

let windowManager;

app.whenReady().then(() => {
  openDb();
  windowManager = new WindowManager(path.join(__dirname, 'preload.js'));
  registerIpc(windowManager);
  windowManager.openWindow(WINDOWS.mainMenu);

  app.on('activate', () => {
    windowManager.openWindow(WINDOWS.mainMenu);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
