const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mtnDesktop', {
  env: {
    platform: process.platform,
  },
});
