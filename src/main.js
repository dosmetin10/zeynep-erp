const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const APP_TITLE = 'MTN Muhasebe ERP';

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0f172a',
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('backup:save', async (_event, payload) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Yedek Kaydet',
    defaultPath: `mtn-yedek-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (canceled || !filePath) {
    return { ok: false, message: 'İşlem iptal edildi.' };
  }

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, message: `Yedek kaydedildi: ${filePath}` };
});

ipcMain.handle('backup:load', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Yedek Dosyası Seç',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (canceled || filePaths.length === 0) {
    return { ok: false, message: 'İşlem iptal edildi.' };
  }

  const [filePath] = filePaths;
  const content = await fs.readFile(filePath, 'utf8');
  return { ok: true, payload: JSON.parse(content), message: `Yedek yüklendi: ${filePath}` };
});

ipcMain.handle('report:exportCsv', async (_event, { filename, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'CSV Rapor Dışa Aktar',
    defaultPath: filename || `mtn-rapor-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (canceled || !filePath) {
    return { ok: false, message: 'CSV dışa aktarma iptal edildi.' };
  }

  await fs.writeFile(filePath, content, 'utf8');
  return { ok: true, message: `CSV oluşturuldu: ${filePath}` };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
