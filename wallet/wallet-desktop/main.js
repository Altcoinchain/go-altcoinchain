const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;
let tray = null;

const RPC_URL = 'http://127.0.0.1:8332';
const CHAIN_ID = 2330;

// IPC handlers for window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Check if geth node is running
async function checkNodeStatus() {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    });

    const options = {
      hostname: '127.0.0.1',
      port: 8332,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ connected: true, block: parseInt(json.result, 16) });
        } catch {
          resolve({ connected: false, block: 0 });
        }
      });
    });

    req.on('error', () => resolve({ connected: false, block: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ connected: false, block: 0 });
    });

    req.write(postData);
    req.end();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Altcoinchain Wallet',
    icon: path.join(__dirname, 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false
    },
    backgroundColor: '#0a0a0a',
    show: false
  });

  // Load the local wallet HTML
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Remove menu bar
  mainWindow.setMenuBarVisibility(false);
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      console.log('Icon not found, skipping tray');
      return;
    }

    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Wallet', click: () => mainWindow.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => {
        app.isQuitting = true;
        app.quit();
      }}
    ]);

    tray.setToolTip('Altcoinchain Wallet');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());
  } catch (err) {
    console.log('Could not create tray:', err.message);
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
