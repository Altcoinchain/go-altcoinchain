const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let gethProcess = null;

// Paths
const isDev = !app.isPackaged;
const appPath = isDev ? path.join(__dirname, '..', '..') : path.dirname(app.getPath('exe'));
const dataDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA, 'Altcoinchain')
    : path.join(process.env.HOME, '.altcoinchain');
const walletsDir = path.join(dataDir, 'wallets');
const tokensFile = path.join(dataDir, 'tokens.json');

// Ensure directories exist
if (!fs.existsSync(walletsDir)) {
    fs.mkdirSync(walletsDir, { recursive: true });
}

// Geth path
function getGethPath() {
    const gethName = process.platform === 'win32' ? 'geth.exe' : 'geth';
    const locations = [
        path.join(appPath, 'build', 'bin', gethName),
        path.join(appPath, gethName),
        path.join(__dirname, '..', '..', 'build', 'bin', gethName),
        gethName
    ];
    for (const loc of locations) {
        if (fs.existsSync(loc)) return loc;
    }
    return gethName;
}

// Check if node is already running
async function checkExistingNode() {
    try {
        const http = require('http');
        return new Promise((resolve) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: 8545,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: 2000
            }, () => resolve(true));
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write(JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }));
            req.end();
        });
    } catch (e) {
        return false;
    }
}

async function startGeth() {
    const nodeRunning = await checkExistingNode();
    if (nodeRunning) {
        console.log('External geth node detected');
        if (mainWindow) mainWindow.webContents.send('node-status', { running: true, message: 'Connected to existing node' });
        return;
    }

    if (gethProcess) {
        if (mainWindow) mainWindow.webContents.send('node-status', { running: true, message: 'Node already running' });
        return;
    }

    const gethPath = getGethPath();
    console.log('Starting geth from:', gethPath);

    const args = [
        '--datadir', dataDir,
        '--networkid', '2330',
        '--http', '--http.addr', '127.0.0.1', '--http.port', '8545',
        '--http.api', 'eth,net,web3,personal,miner,txpool,admin',
        '--http.corsdomain', '*',
        '--syncmode', 'full', '--verbosity', '3'
    ];

    try {
        gethProcess = spawn(gethPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        gethProcess.stdout.on('data', (data) => {
            if (mainWindow) mainWindow.webContents.send('node-log', data.toString());
        });
        gethProcess.stderr.on('data', (data) => {
            if (mainWindow) mainWindow.webContents.send('node-log', data.toString());
        });
        gethProcess.on('close', (code) => {
            gethProcess = null;
            if (mainWindow) mainWindow.webContents.send('node-status', { running: false, message: `Node stopped (code ${code})` });
        });
        gethProcess.on('error', (err) => {
            gethProcess = null;
            if (mainWindow) mainWindow.webContents.send('node-status', { running: false, message: `Failed: ${err.message}` });
        });
        if (mainWindow) mainWindow.webContents.send('node-status', { running: true, message: 'Node starting...' });
    } catch (err) {
        console.error('Failed to start geth:', err);
    }
}

function stopGeth() {
    if (gethProcess) {
        gethProcess.kill('SIGTERM');
        gethProcess = null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        frame: false,
        backgroundColor: '#0a0a0f',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Always load from build folder for now
    const buildPath = path.join(__dirname, '..', 'build', 'index.html');
    if (require('fs').existsSync(buildPath)) {
        mainWindow.loadFile(buildPath);
    } else if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, 'index.html'));
    }

    mainWindow.on('closed', () => { mainWindow = null; });
}

// IPC Handlers
ipcMain.handle('get-node-status', () => ({ running: gethProcess !== null }));
ipcMain.handle('start-node', () => { startGeth(); return { success: true }; });
ipcMain.handle('stop-node', () => { stopGeth(); return { success: true }; });

ipcMain.handle('get-wallets', () => {
    try {
        const files = fs.readdirSync(walletsDir);
        return files.filter(f => f.endsWith('.json')).map(f => {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(walletsDir, f), 'utf8'));
                return {
                    filename: f,
                    address: content.address ? (content.address.startsWith('0x') ? content.address : '0x' + content.address) : null,
                    name: content.name || f.replace('.json', '')
                };
            } catch (e) {
                return { filename: f, address: null, name: f };
            }
        });
    } catch (e) {
        return [];
    }
});

ipcMain.handle('save-wallet', (event, { filename, content }) => {
    try {
        fs.writeFileSync(path.join(walletsDir, filename), JSON.stringify(content, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('load-wallet', (event, filename) => {
    try {
        const content = fs.readFileSync(path.join(walletsDir, filename), 'utf8');
        return { success: true, content: JSON.parse(content) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-wallet', (event, filename) => {
    try {
        fs.unlinkSync(path.join(walletsDir, filename));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-tokens', () => {
    try {
        if (fs.existsSync(tokensFile)) return JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
        return [];
    } catch (e) {
        return [];
    }
});

ipcMain.handle('save-tokens', (event, tokens) => {
    try {
        fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('window-action', (event, action) => {
    if (!mainWindow) return;
    switch (action) {
        case 'minimize': mainWindow.minimize(); break;
        case 'maximize': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
        case 'close': mainWindow.close(); break;
    }
});

ipcMain.handle('open-data-dir', () => shell.openPath(dataDir));
ipcMain.handle('get-data-dir', () => dataDir);

// App lifecycle
app.whenReady().then(async () => {
    await startGeth();
    createWindow();
});

app.on('window-all-closed', () => {
    stopGeth();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});

app.on('before-quit', () => stopGeth());
