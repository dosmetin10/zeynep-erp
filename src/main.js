
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

const WEB_URL = process.env.MTN_WEB_URL || 'http://127.0.0.1:3777';
const HEALTH_URL = `${WEB_URL.replace(/\/$/, '')}/api/health-check`;
let embeddedServerProcess = null;

async function isServerAlive(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    return res.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function startEmbeddedServer() {
  if (embeddedServerProcess) return;
  const entry = path.join(__dirname, 'embedded-server', 'index.js');
  embeddedServerProcess = fork(entry, [], {
    stdio: 'ignore',
    detached: false,
    env: {
      ...process.env,
      SERVER_PORT: '3777',
    },
  });
}

async function ensureServer() {
  if (await isServerAlive()) return true;
  startEmbeddedServer();
  for (let i = 0; i < 8; i += 1) {
    await new Promise((r) => setTimeout(r, 450));
    if (await isServerAlive(900)) return true;
  }
  return false;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    autoHideMenuBar: true,
=======
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


  const alive = await ensureServer();
  if (alive) {
    await win.loadURL(WEB_URL);
  } else {
    await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

=======
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

  if (embeddedServerProcess && !embeddedServerProcess.killed) {
    embeddedServerProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
=======
  if (process.platform !== 'darwin') app.quit();
});

