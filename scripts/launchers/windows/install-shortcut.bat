@echo off
:: Install Altcoinchain Desktop Shortcuts on Windows

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Altcoinchain"

echo.
echo ===============================================================
echo         ALTCOINCHAIN DESKTOP SHORTCUT INSTALLER
echo ===============================================================
echo.

:: Create Start Menu folder
if not exist "%STARTMENU%" mkdir "%STARTMENU%"

:: Create shortcuts using PowerShell
echo Creating desktop shortcuts...

:: Node shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP%\Altcoinchain Node.lnk'); $s.TargetPath = '%SCRIPT_DIR%start-altcoinchain.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'Altcoinchain Blockchain Node'; $s.Save()"

:: Wallet shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP%\Altcoinchain Wallet.lnk'); $s.TargetPath = '%SCRIPT_DIR%start-wallet.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'Altcoinchain Desktop Wallet'; $s.Save()"

echo Creating Start Menu shortcuts...

:: Start Menu - Node
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTMENU%\Altcoinchain Node.lnk'); $s.TargetPath = '%SCRIPT_DIR%start-altcoinchain.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'Altcoinchain Blockchain Node'; $s.Save()"

:: Start Menu - Wallet
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTMENU%\Altcoinchain Wallet.lnk'); $s.TargetPath = '%SCRIPT_DIR%start-wallet.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'Altcoinchain Desktop Wallet'; $s.Save()"

:: Start Menu - Stop Node
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTMENU%\Stop Altcoinchain.lnk'); $s.TargetPath = '%SCRIPT_DIR%stop-altcoinchain.bat'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'Stop Altcoinchain Node'; $s.Save()"

echo.
echo ===============================================================
echo Desktop shortcuts installed successfully!
echo.
echo Created:
echo   Desktop:
echo     - Altcoinchain Node
echo     - Altcoinchain Wallet
echo.
echo   Start Menu (Altcoinchain folder):
echo     - Altcoinchain Node
echo     - Altcoinchain Wallet
echo     - Stop Altcoinchain
echo ===============================================================
echo.
pause
