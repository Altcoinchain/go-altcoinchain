@echo off
:: Stop Altcoinchain Node on Windows

echo Stopping Altcoinchain node...

taskkill /IM geth.exe /F >nul 2>&1

if %ERRORLEVEL%==0 (
    echo Altcoinchain node stopped.
) else (
    echo Altcoinchain node was not running.
)

pause
