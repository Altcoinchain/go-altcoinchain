// Preload script for Electron
// This runs in the renderer process with access to Node.js APIs

const { contextBridge } = require('electron');

// Expose safe APIs to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    version: process.versions.electron
});
