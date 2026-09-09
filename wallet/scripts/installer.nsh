; Altcoinchain Wallet NSIS Installer Script
; Provides full Windows integration with Start Menu, Desktop, and Taskbar

!include "FileFunc.nsh"

!macro customInit
  ; Check if running as admin
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "admin"
    MessageBox MB_ICONSTOP "Administrator rights required!"
    SetErrorLevel 740
    Quit
  ${EndIf}
!macroend

!macro customInstall
  ; Make geth executable (set file attributes)
  SetFileAttributes "$INSTDIR\resources\geth.exe" NORMAL

  ; Create application data directory
  CreateDirectory "$APPDATA\altcoinchain"

  ; Copy genesis and bootnodes to app data
  CopyFiles "$INSTDIR\resources\genesis.json" "$APPDATA\altcoinchain\genesis.json"
  CopyFiles "$INSTDIR\resources\bootnodes.txt" "$APPDATA\altcoinchain\bootnodes.txt"

  ; Create Desktop shortcut
  CreateShortcut "$DESKTOP\Altcoinchain Wallet.lnk" "$INSTDIR\Altcoinchain Wallet.exe" "" "$INSTDIR\Altcoinchain Wallet.exe" 0

  ; Create Start Menu folder and shortcuts
  CreateDirectory "$SMPROGRAMS\Altcoinchain"
  CreateShortcut "$SMPROGRAMS\Altcoinchain\Altcoinchain Wallet.lnk" "$INSTDIR\Altcoinchain Wallet.exe" "" "$INSTDIR\Altcoinchain Wallet.exe" 0
  CreateShortcut "$SMPROGRAMS\Altcoinchain\Uninstall.lnk" "$INSTDIR\Uninstall Altcoinchain Wallet.exe"

  ; Register URL protocol handler (altcoinchain://)
  WriteRegStr HKCR "altcoinchain" "" "URL:Altcoinchain Protocol"
  WriteRegStr HKCR "altcoinchain" "URL Protocol" ""
  WriteRegStr HKCR "altcoinchain\DefaultIcon" "" "$INSTDIR\Altcoinchain Wallet.exe,0"
  WriteRegStr HKCR "altcoinchain\shell\open\command" "" '"$INSTDIR\Altcoinchain Wallet.exe" "%1"'

  ; Add to Apps & Features with proper info
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "DisplayName" "Altcoinchain Wallet"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "DisplayIcon" "$INSTDIR\Altcoinchain Wallet.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "Publisher" "Altcoinchain"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "DisplayVersion" "2.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "URLInfoAbout" "https://altcoinchain.org"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "UninstallString" "$INSTDIR\Uninstall Altcoinchain Wallet.exe"

  ; Get install size and write to registry
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet" "EstimatedSize" "$0"

  ; Ask user if they want autostart
  MessageBox MB_YESNO|MB_ICONQUESTION "Would you like Altcoinchain Wallet to start automatically when Windows starts?" IDNO skip_autostart
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AltcoinchainWallet" '"$INSTDIR\Altcoinchain Wallet.exe" --hidden'
  skip_autostart:
!macroend

!macro customUnInstall
  ; Remove autostart entry if exists
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AltcoinchainWallet"

  ; Remove URL protocol handler
  DeleteRegKey HKCR "altcoinchain"

  ; Remove from Apps & Features
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AltcoinchainWallet"

  ; Remove application shortcuts
  Delete "$DESKTOP\Altcoinchain Wallet.lnk"
  Delete "$SMPROGRAMS\Altcoinchain\Altcoinchain Wallet.lnk"
  Delete "$SMPROGRAMS\Altcoinchain\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Altcoinchain"

  ; Ask about removing user data
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to remove blockchain data and wallets?$\n$\nWARNING: This will permanently delete all your wallets and synced blockchain data!" IDNO skip_data
    RMDir /r "$APPDATA\altcoinchain"
    RMDir /r "$LOCALAPPDATA\altcoinchain-wallet"
  skip_data:
!macroend
