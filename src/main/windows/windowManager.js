const { BrowserWindow } = require('electron');
const path = require('path');
const { WINDOWS } = require('../../shared/constants');

class WindowManager {
  constructor(preloadPath) {
    this.preloadPath = preloadPath;
    this.windows = new Map();
  }

  getConfig(name) {
    const map = {
      [WINDOWS.mainMenu]: { file: 'mainMenu/index.html', w: 1200, h: 820 },
      [WINDOWS.customersWindow]: { file: 'customers/index.html', w: 1100, h: 760 },
      [WINDOWS.stockWindow]: { file: 'stock/index.html', w: 1100, h: 760 },
      [WINDOWS.salesWindow]: { file: 'sales/index.html', w: 1200, h: 800 },
      [WINDOWS.purchaseWindow]: { file: 'purchase/index.html', w: 1100, h: 760 },
      [WINDOWS.cashWindow]: { file: 'cash/index.html', w: 1000, h: 720 },
      [WINDOWS.bankWindow]: { file: 'bank/index.html', w: 1000, h: 720 },
      [WINDOWS.proposalWindow]: { file: 'proposal/index.html', w: 1100, h: 760 },
      [WINDOWS.invoiceWindow]: { file: 'invoice/index.html', w: 1100, h: 760 },
      [WINDOWS.reportsWindow]: { file: 'reports/index.html', w: 1200, h: 800 },
      [WINDOWS.settingsWindow]: { file: 'settings/index.html', w: 900, h: 680 },
      [WINDOWS.usersWindow]: { file: 'users/index.html', w: 900, h: 680 },
      [WINDOWS.backupWindow]: { file: 'backup/index.html', w: 900, h: 680 },
    };
    return map[name];
  }

  openWindow(name, params = {}) {
    const existing = this.windows.get(name);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      existing.webContents.send('window:params', params);
      return existing;
    }

    const cfg = this.getConfig(name);
    if (!cfg) throw new Error(`Unknown window: ${name}`);
    const win = new BrowserWindow({
      width: cfg.w,
      height: cfg.h,
      minWidth: 800,
      minHeight: 600,
      autoHideMenuBar: true,
      backgroundColor: '#0b1220',
      webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false },
    });

    win.loadFile(path.join(__dirname, '../../renderer', cfg.file));
    win.webContents.once('did-finish-load', () => win.webContents.send('window:params', params));
    win.on('closed', () => this.windows.delete(name));
    this.windows.set(name, win);
    return win;
  }

  bringToFront(name) {
    const win = this.windows.get(name);
    if (win && !win.isDestroyed()) {
      win.focus();
      return true;
    }
    return false;
  }
}

module.exports = { WindowManager };
