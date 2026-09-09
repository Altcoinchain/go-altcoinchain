@echo off
:: Altcoinchain Wallet Launcher for Windows
:: Starts the node and launches the Electron wallet

title Altcoinchain Wallet Launcher

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "GETH_BIN=%SCRIPT_DIR%geth.exe"
set "WALLET_DIR=%SCRIPT_DIR%wallet"
set "DATADIR=%USERPROFILE%\.altcoinchain"
set "GENESIS=%SCRIPT_DIR%genesis.json"

:: Network configuration
set NETWORK_ID=2330
set RPC_PORT=8332
set WS_PORT=8333
set P2P_PORT=31303

:: Altcoinchain Bootnodes
set "BOOTNODES=enode://9355a3870bb3c7882a51797c6633380359c827febdbd89c87c0ff72914b351caf1642e5326ba78532f249082aad7c08d524cd418514865a49f8a5bca200ecbba@154.12.237.243:30303,enode://926900ccd1e2f218ce0d3c31f731eb1af1be60049624db9a01fa73588157f3fb7fd04c5f0874ca7cc030ab79d836c1961c3ef67aefe09f352e8a7aba03d3cdbf@154.12.237.243:30304,enode://c2e73bd6232c73ab7887d92aa904413597638ebf935791ca197bdd7902560baa7a4e8a1235b6d10d121ffc4602373476e7daa7d20d326466a5ae423be6581707@99.248.100.186:31303"

echo.
echo ===============================================================
echo              ALTCOINCHAIN WALLET LAUNCHER
echo                    Network ID: 2330
echo               Hybrid PoW/PoS - Fusaka Fork
echo ===============================================================
echo.

:: Check geth binary
if not exist "%GETH_BIN%" (
    echo ERROR: geth.exe not found at %GETH_BIN%
    pause
    exit /b 1
)

:: Create datadir
if not exist "%DATADIR%" mkdir "%DATADIR%"

:: Initialize genesis if needed
if not exist "%DATADIR%\geth" (
    echo [Altcoinchain] Initializing data directory...
    if exist "%GENESIS%" (
        "%GETH_BIN%" --datadir "%DATADIR%" init "%GENESIS%"
        echo [Altcoinchain] Genesis initialized (Chain ID: 2330)
    )
)

:: Check if node is already running
tasklist /FI "IMAGENAME eq geth.exe" 2>NUL | find /I /N "geth.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [Altcoinchain] Node is already running
    goto :launch_wallet
)

echo [Altcoinchain] Starting node in background...
echo [Info] Connecting to network bootnodes...

:: Start node in background
start "Altcoinchain Node" /MIN "%GETH_BIN%" --datadir "%DATADIR%" ^
    --networkid %NETWORK_ID% ^
    --port %P2P_PORT% ^
    --bootnodes "%BOOTNODES%" ^
    --http --http.port %RPC_PORT% ^
    --http.api personal,eth,net,web3,miner,admin,debug,txpool ^
    --http.corsdomain "*" ^
    --ws --ws.port %WS_PORT% ^
    --ws.api personal,eth,net,web3,miner,admin,debug,txpool ^
    --ws.origins "*" ^
    --allow-insecure-unlock ^
    --syncmode=full ^
    --gcmode=archive ^
    --maxpeers 50 ^
    --nat=any

echo [Altcoinchain] Waiting for node RPC...
:: Wait for RPC to be ready
set /a counter=0
:wait_rpc
set /a counter+=1
if %counter% gtr 30 goto :launch_wallet
timeout /t 1 /nobreak >nul
curl -s -X POST -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" http://127.0.0.1:%RPC_PORT% >nul 2>&1
if errorlevel 1 goto :wait_rpc
echo [Altcoinchain] Node RPC ready on port %RPC_PORT%

:launch_wallet
echo [Altcoinchain] Launching wallet...
cd /d "%WALLET_DIR%"

:: Check for node_modules
if not exist "node_modules" (
    echo [Warning] Installing wallet dependencies...
    call npm install
)

:: Launch Electron wallet
where electron >nul 2>&1
if %ERRORLEVEL%==0 (
    electron .
) else if exist "node_modules\.bin\electron.cmd" (
    call node_modules\.bin\electron.cmd .
) else (
    call npx electron .
)

echo.
echo [Altcoinchain] Wallet closed. Node continues syncing in background.
echo [Info] To stop the node, run stop-altcoinchain.bat or close the node window.
echo.
pause
