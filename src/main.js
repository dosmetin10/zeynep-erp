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
