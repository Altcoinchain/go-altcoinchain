const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window-action', 'minimize'),
    maximize: () => ipcRenderer.invoke('window-action', 'maximize'),
    close: () => ipcRenderer.invoke('window-action', 'close'),

    // Node management
    getNodeStatus: () => ipcRenderer.invoke('get-node-status'),
    startNode: () => ipcRenderer.invoke('start-node'),
    stopNode: () => ipcRenderer.invoke('stop-node'),
    onNodeStatus: (callback) => ipcRenderer.on('node-status', (event, data) => callback(data)),
    onNodeLog: (callback) => ipcRenderer.on('node-log', (event, data) => callback(data)),

    // Wallet management
    getWallets: () => ipcRenderer.invoke('get-wallets'),
    saveWallet: (filename, content) => ipcRenderer.invoke('save-wallet', { filename, content }),
    loadWallet: (filename) => ipcRenderer.invoke('load-wallet', filename),
    deleteWallet: (filename) => ipcRenderer.invoke('delete-wallet', filename),

    // Token management
    getTokens: () => ipcRenderer.invoke('get-tokens'),
    saveTokens: (tokens) => ipcRenderer.invoke('save-tokens', tokens),

    // File operations
    getDataDir: () => ipcRenderer.invoke('get-data-dir'),
    openDataDir: () => ipcRenderer.invoke('open-data-dir'),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    writeFile: (path, content) => ipcRenderer.invoke('write-file', { path, content }),

    // Menu actions
    onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, action) => callback(action)),
    onConnectRpc: (callback) => ipcRenderer.on('connect-rpc', (event, url) => callback(url)),
    onShowMessage: (callback) => ipcRenderer.on('show-message', (event, msg) => callback(msg)),

    // Platform info
    platform: process.platform
});
