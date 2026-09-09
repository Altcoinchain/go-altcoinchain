const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let gethProcess = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');

    // Create menu
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Start Local Node',
                    click: () => startGeth()
                },
                {
                    label: 'Stop Local Node',
                    click: () => stopGeth()
                },
                { type: 'separator' },
                {
                    label: 'Open Data Directory',
                    click: () => {
                        const dataDir = process.platform === 'win32'
                            ? path.join(process.env.APPDATA, 'Altcoinchain')
                            : path.join(process.env.HOME, '.altcoinchain');
                        shell.openPath(dataDir);
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Network',
            submenu: [
                {
                    label: 'Connect to Local Node',
                    click: () => mainWindow.webContents.executeJavaScript(
                        "document.getElementById('rpcUrl').value = 'http://127.0.0.1:8545'; connect();"
                    )
                },
                {
                    label: 'Connect to Mainnet RPC',
                    click: () => mainWindow.webContents.executeJavaScript(
                        "document.getElementById('rpcUrl').value = 'https://alt-rpc2.minethepla.net'; connect();"
                    )
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { role: 'resetZoom' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Altcoinchain Website',
                    click: () => shell.openExternal('https://altcoinchain.org')
                },
                {
                    label: 'Block Explorer',
                    click: () => shell.openExternal('https://explorer.altcoinchain.org')
                },
                { type: 'separator' },
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Altcoinchain Dashboard',
                            message: 'Altcoinchain Dashboard v1.0.0',
                            detail: 'Hybrid PoW/PoS Node Manager\n\nChain ID: 2330\nHybrid Fork: Block 7,000,000\n\nStaking Contract:\n0x87f0bd245507e5a94cdb03472501a9f522a9e0f1'
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
        stopGeth();
    });
}

function startGeth() {
    if (gethProcess) {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            message: 'Node is already running'
        });
        return;
    }

    const gethPath = process.platform === 'win32' ? 'geth.exe' : 'geth';
    const dataDir = process.platform === 'win32'
        ? path.join(process.env.APPDATA, 'Altcoinchain')
        : path.join(process.env.HOME, '.altcoinchain');

    const args = [
        '--datadir', dataDir,
        '--networkid', '2330',
        '--http',
        '--http.addr', '127.0.0.1',
        '--http.api', 'eth,net,web3,personal,miner,validator,admin',
        '--http.corsdomain', '*',
        '--syncmode', 'full'
    ];

    try {
        gethProcess = spawn(gethPath, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        gethProcess.stdout.on('data', (data) => {
            console.log(`geth: ${data}`);
        });

        gethProcess.stderr.on('data', (data) => {
            console.log(`geth: ${data}`);
        });

        gethProcess.on('close', (code) => {
            console.log(`geth exited with code ${code}`);
            gethProcess = null;
        });

        gethProcess.on('error', (err) => {
            dialog.showErrorBox('Error', `Failed to start geth: ${err.message}`);
            gethProcess = null;
        });

        mainWindow.webContents.executeJavaScript(
            "log('Local node starting...', 'info');"
        );

        // Auto-connect after a delay
        setTimeout(() => {
            mainWindow.webContents.executeJavaScript(
                "document.getElementById('rpcUrl').value = 'http://127.0.0.1:8545'; connect();"
            );
        }, 3000);

    } catch (err) {
        dialog.showErrorBox('Error', `Failed to start geth: ${err.message}`);
    }
}

function stopGeth() {
    if (gethProcess) {
        gethProcess.kill('SIGTERM');
        gethProcess = null;
        if (mainWindow) {
            mainWindow.webContents.executeJavaScript(
                "log('Local node stopped', 'info');"
            );
        }
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    stopGeth();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('before-quit', () => {
    stopGeth();
});
