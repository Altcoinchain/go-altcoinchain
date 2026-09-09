const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execSync } = require('child_process');

let mainWindow;
let tray = null;
let gethProcess = null;

const RPC_URL = 'http://127.0.0.1:8332';
const CHAIN_ID = 2330;
const USER_DATA_DIR = app.getPath('userData');
const WALLETS_DIR = path.join(USER_DATA_DIR, 'wallets');

// Use platform-appropriate data directory
const isWindows = process.platform === 'win32';
const DATA_DIR = isWindows
  ? path.join(process.env.APPDATA || app.getPath('home'), 'altcoinchain')
  : path.join(app.getPath('home'), '.altcoinchain');

// Data file paths
const TOKENS_FILE = path.join(USER_DATA_DIR, 'tokens.json');
const NFT_COLLECTIONS_FILE = path.join(USER_DATA_DIR, 'nft-collections.json');
const NFT_METADATA_FILE = path.join(USER_DATA_DIR, 'nft-metadata.json');
const CONTACTS_FILE = path.join(USER_DATA_DIR, 'contacts.json');
const SETTINGS_FILE = path.join(USER_DATA_DIR, 'settings.json');

// Ensure directories exist
if (!fs.existsSync(WALLETS_DIR)) {
  fs.mkdirSync(WALLETS_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Log file for debugging
const LOG_FILE = path.join(DATA_DIR, 'wallet.log');
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
}

// Get defaults path
function getDefaultsPath(filename) {
  const possiblePaths = [
    path.join(process.resourcesPath, 'defaults', filename),
    path.join(__dirname, 'defaults', filename),
    path.join(app.getAppPath(), 'defaults', filename)
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// Copy default data files on first run
function initializeDefaultData() {
  console.log('Checking default data files...');

  const defaultFiles = [
    { source: 'tokens.json', target: TOKENS_FILE },
    { source: 'nft-collections.json', target: NFT_COLLECTIONS_FILE },
    { source: 'nft-metadata.json', target: NFT_METADATA_FILE },
    { source: 'contacts.json', target: CONTACTS_FILE },
    { source: 'settings.json', target: SETTINGS_FILE }
  ];

  for (const file of defaultFiles) {
    if (!fs.existsSync(file.target)) {
      const defaultPath = getDefaultsPath(file.source);
      if (defaultPath) {
        try {
          const content = fs.readFileSync(defaultPath, 'utf8');
          fs.writeFileSync(file.target, content);
          console.log(`Initialized ${file.source} with defaults`);
        } catch (err) {
          console.error(`Failed to copy default ${file.source}:`, err.message);
        }
      } else {
        console.log(`No default found for ${file.source}`);
      }
    }
  }
}

// Get resource paths (different in dev vs production)
function getResourcePath(filename) {
  const possiblePaths = [
    path.join(process.resourcesPath, filename),
    path.join(__dirname, '..', filename),
    path.join(__dirname, '..', '..', filename),
    path.join(app.getAppPath(), '..', filename)
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// Get geth binary path
function getGethPath() {
  const isWindows = process.platform === 'win32';
  const gethName = isWindows ? 'geth.exe' : 'geth';

  log('Looking for geth, platform: ' + process.platform);
  log('resourcesPath: ' + process.resourcesPath);
  log('__dirname: ' + __dirname);
  log('appPath: ' + app.getAppPath());

  const possiblePaths = [
    path.join(process.resourcesPath, gethName),
    path.join(__dirname, '..', gethName),
    path.join(__dirname, '..', '..', gethName),
    path.join(app.getAppPath(), '..', gethName)
  ];

  // Add platform-specific paths
  if (isWindows) {
    // Get the exe directory (where Altcoinchain Wallet.exe is)
    const exeDir = path.dirname(app.getPath('exe'));
    log('exeDir: ' + exeDir);
    possiblePaths.push(path.join(exeDir, 'resources', gethName));
    possiblePaths.push(path.join(exeDir, gethName));
    // Common Windows install locations
    possiblePaths.push(path.join(process.resourcesPath, '..', 'resources', gethName));
    possiblePaths.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Altcoinchain Wallet', 'resources', gethName));
    possiblePaths.push(path.join(process.env.PROGRAMFILES || '', 'Altcoinchain Wallet', 'resources', gethName));
  } else {
    possiblePaths.push('/opt/Altcoinchain Wallet/resources/geth');
    possiblePaths.push('/usr/lib/altcoinchain-wallet/resources/geth');
  }

  for (const p of possiblePaths) {
    const exists = fs.existsSync(p);
    log('Checking: ' + p + ' exists: ' + exists);
    if (exists) {
      log('Found geth at: ' + p);
      return p;
    }
  }
  log('ERROR: Geth not found in any location');
  return null;
}

// Read bootnodes
function getBootnodes() {
  const bootnodesPath = getResourcePath('bootnodes.txt');
  if (bootnodesPath && fs.existsSync(bootnodesPath)) {
    const content = fs.readFileSync(bootnodesPath, 'utf8');
    return content.split('\n').filter(line => line.trim().startsWith('enode://'));
  }
  // Default bootnodes
  return [
    'enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303',
    'enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304',
    'enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303'
  ];
}

// Initialize genesis if needed
function initializeGenesis() {
  const genesisPath = getResourcePath('genesis.json');
  const chainDataPath = path.join(DATA_DIR, 'geth', 'chaindata');

  log('Checking genesis initialization...');
  log('DATA_DIR: ' + DATA_DIR);
  log('chainDataPath: ' + chainDataPath);
  log('genesisPath: ' + genesisPath);

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    log('Creating data directory: ' + DATA_DIR);
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(chainDataPath) && genesisPath) {
    log('Initializing genesis block...');
    const gethPath = getGethPath();
    if (gethPath) {
      try {
        const isWindows = process.platform === 'win32';
        const initArgs = ['--datadir', DATA_DIR, 'init', genesisPath];
        log('Running genesis init: ' + gethPath + ' ' + initArgs.join(' '));

        // Use spawnSync instead of execSync to avoid shell quoting issues
        const { spawnSync } = require('child_process');
        const result = spawnSync(gethPath, initArgs, {
          stdio: 'pipe',
          windowsHide: true,
          timeout: 60000  // 60 second timeout
        });

        if (result.error) {
          log('Genesis init error: ' + result.error.message);
        } else if (result.status !== 0) {
          log('Genesis init failed with code: ' + result.status);
          if (result.stderr) {
            log('Genesis init stderr: ' + result.stderr.toString());
          }
        } else {
          log('Genesis initialized successfully');
        }

        if (result.stdout) {
          log('Genesis init stdout: ' + result.stdout.toString());
        }
      } catch (err) {
        log('Failed to initialize genesis: ' + err.message);
        log('Genesis init error stack: ' + err.stack);
      }
    } else {
      log('ERROR: geth binary not found for genesis init');
    }
  } else {
    log('Genesis already initialized or genesis file not found');
  }
}

// Start geth node
function startGethNode() {
  log('startGethNode called');

  if (gethProcess) {
    log('Geth already running');
    return;
  }

  const gethPath = getGethPath();
  if (!gethPath) {
    log('ERROR: Cannot start geth - binary not found');
    return;
  }

  log('Found geth at: ' + gethPath);

  // Initialize genesis if needed
  initializeGenesis();

  const bootnodes = getBootnodes();
  const bootnodesArg = bootnodes.join(',');

  const args = [
    '--datadir', DATA_DIR,
    '--networkid', '2330',
    '--port', '31303',
    '--http',
    '--http.addr', '127.0.0.1',
    '--http.port', '8332',
    '--http.api', 'eth,net,web3,personal,miner,txpool,debug',
    '--http.corsdomain', '*',
    '--ws',
    '--ws.addr', '127.0.0.1',
    '--ws.port', '8333',
    '--ws.api', 'eth,net,web3,personal,miner,txpool',
    '--ws.origins', '*',
    '--bootnodes', bootnodesArg,
    '--syncmode', 'snap',
    '--gcmode', 'full',
    '--maxpeers', '50',
    '--cache', '512',
    '--ethstats', 'wattx:alt@alt-stat.outsidethebox.top'
  ];

  log('Starting geth with args: ' + args.join(' '));
  log('Geth path: ' + gethPath);
  log('Data directory: ' + DATA_DIR);

  const isWindows = process.platform === 'win32';
  log('Platform: ' + process.platform + ', isWindows: ' + isWindows);

  try {
    // Don't use shell - Node.js spawn handles paths with spaces correctly
    // Using shell causes quoting issues on Windows
    const spawnOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    };

    // On Windows, we need to set cwd to avoid path issues
    if (isWindows) {
      spawnOptions.cwd = path.dirname(gethPath);
    }

    log('Spawn options: ' + JSON.stringify(spawnOptions));
    gethProcess = spawn(gethPath, args, spawnOptions);
  } catch (err) {
    log('Spawn failed: ' + err.message);
    log('Spawn error stack: ' + err.stack);
    return;
  }

  if (!gethProcess || !gethProcess.pid) {
    log('ERROR: Failed to spawn geth process');
    return;
  }

  log('Geth spawned with PID: ' + gethProcess.pid);

  gethProcess.stdout.on('data', (data) => {
    log('geth stdout: ' + data.toString().trim());
  });

  gethProcess.stderr.on('data', (data) => {
    log('geth stderr: ' + data.toString().trim());
  });

  gethProcess.on('error', (err) => {
    log('Geth process error: ' + err.message);
    gethProcess = null;
  });

  gethProcess.on('close', (code) => {
    log('Geth exited with code ' + code);
    gethProcess = null;
  });

  // Save PID for reference
  const pidFile = path.join(DATA_DIR, 'geth.pid');
  try {
    fs.writeFileSync(pidFile, gethProcess.pid.toString());
    log('Saved PID to: ' + pidFile);
  } catch (err) {
    log('Failed to save PID file: ' + err.message);
  }
}

// Stop geth node
function stopGethNode() {
  if (gethProcess) {
    console.log('Stopping geth...');
    gethProcess.kill('SIGTERM');
    gethProcess = null;
  }

  // Clean up PID file
  const pidFile = path.join(DATA_DIR, 'geth.pid');
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

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

  // Load the built React wallet
  mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Log any loading errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Console [${level}]: ${message}`);
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

// Helper to read JSON file safely
function readJsonFile(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return defaultValue;
}

// Helper to write JSON file safely
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return { success: false, error: err.message };
  }
}

// Window control IPC handlers
ipcMain.handle('window-action', (event, action) => {
  if (!mainWindow) return;

  switch (action) {
    case 'minimize':
      mainWindow.minimize();
      break;
    case 'maximize':
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
    case 'close':
      app.isQuitting = true;
      app.quit();
      break;
  }
});

// Node status IPC handlers
ipcMain.handle('get-node-status', async () => {
  return await checkNodeStatus();
});

ipcMain.handle('start-node', () => {
  startGethNode();
  return { success: true };
});

ipcMain.handle('stop-node', () => {
  stopGethNode();
  return { success: true };
});

// Wallet management IPC handlers
ipcMain.handle('get-wallets', () => {
  try {
    if (!fs.existsSync(WALLETS_DIR)) {
      return [];
    }
    const files = fs.readdirSync(WALLETS_DIR).filter(f => f.endsWith('.json'));
    return files.map(filename => {
      try {
        const content = fs.readFileSync(path.join(WALLETS_DIR, filename), 'utf8');
        const keystore = JSON.parse(content);
        return {
          filename,
          address: keystore.address ? '0x' + keystore.address : '',
          name: filename.replace('.json', '')
        };
      } catch {
        return { filename, address: '', name: filename.replace('.json', '') };
      }
    });
  } catch (err) {
    console.error('Error reading wallets:', err);
    return [];
  }
});

ipcMain.handle('save-wallet', (event, { filename, content }) => {
  try {
    const filePath = path.join(WALLETS_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return { success: true };
  } catch (err) {
    console.error('Error saving wallet:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-wallet', (event, filename) => {
  try {
    const filePath = path.join(WALLETS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content: JSON.parse(content) };
  } catch (err) {
    console.error('Error loading wallet:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-wallet', (event, filename) => {
  try {
    const filePath = path.join(WALLETS_DIR, filename);
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    console.error('Error deleting wallet:', err);
    return { success: false, error: err.message };
  }
});

// Token management
ipcMain.handle('get-tokens', () => {
  return readJsonFile(TOKENS_FILE, []);
});

ipcMain.handle('save-tokens', (event, tokens) => {
  return writeJsonFile(TOKENS_FILE, tokens);
});

// NFT Collections management
ipcMain.handle('get-nft-collections', () => {
  return readJsonFile(NFT_COLLECTIONS_FILE, []);
});

ipcMain.handle('save-nft-collections', (event, collections) => {
  return writeJsonFile(NFT_COLLECTIONS_FILE, collections);
});

// NFT Metadata management
ipcMain.handle('get-nft-metadata', () => {
  return readJsonFile(NFT_METADATA_FILE, {});
});

ipcMain.handle('save-nft-metadata', (event, metadata) => {
  return writeJsonFile(NFT_METADATA_FILE, metadata);
});

// Contacts/Address Book management
ipcMain.handle('get-contacts', () => {
  return readJsonFile(CONTACTS_FILE, []);
});

ipcMain.handle('save-contacts', (event, contacts) => {
  return writeJsonFile(CONTACTS_FILE, contacts);
});

// Settings management
ipcMain.handle('get-settings', () => {
  return readJsonFile(SETTINGS_FILE, {
    theme: 'matrix',
    currency: 'USD',
    language: 'en'
  });
});

ipcMain.handle('save-settings', (event, settings) => {
  return writeJsonFile(SETTINGS_FILE, settings);
});

// File operations
ipcMain.handle('get-data-dir', () => {
  return USER_DATA_DIR;
});

ipcMain.handle('open-data-dir', () => {
  shell.openPath(USER_DATA_DIR);
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const { dialog } = require('electron');
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('write-file', (event, { path: filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  // Initialize default data files on first run
  initializeDefaultData();

  // Start geth node
  startGethNode();

  // Create window and tray
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopGethNode();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopGethNode();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
