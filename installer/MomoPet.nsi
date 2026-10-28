Unicode true

!define APP_NAME "墨墨桌宠"
!define APP_VERSION "1.4.2.3"
!define APP_PUBLISHER "MomoPet"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MomoPet"

Name "${APP_NAME}"
OutFile "..\dist\MomoPet-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\MomoPet"
InstallDirRegKey HKCU "Software\MomoPet" "InstallDir"
RequestExecutionLevel user
SetCompressor zlib
BrandingText "${APP_NAME} ${APP_VERSION}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "..\desktop-native\Assets\app.ico"
!define MUI_UNICON "..\desktop-native\Assets\app.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\启动墨墨.cmd"
!define MUI_FINISHPAGE_RUN_TEXT "启动墨墨"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

VIProductVersion "1.4.2.1"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "墨墨桌宠 Windows 安装程序"
VIAddVersionKey "FileVersion" "${APP_VERSION}"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\dist\MomoPet-Windows-Portable\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\MomoPet" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\MomoPet.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  CreateShortCut "$DESKTOP\墨墨桌宠.lnk" "$INSTDIR\启动墨墨.cmd" "" "$INSTDIR\MomoPet.exe" 0
  CreateDirectory "$SMPROGRAMS\墨墨桌宠"
  CreateShortCut "$SMPROGRAMS\墨墨桌宠\墨墨桌宠.lnk" "$INSTDIR\启动墨墨.cmd" "" "$INSTDIR\MomoPet.exe" 0
  CreateShortCut "$SMPROGRAMS\墨墨桌宠\卸载墨墨.lnk" "$INSTDIR\Uninstall.exe"

  DetailPrint "账号和数据保存在 %LOCALAPPDATA%\MomoPet\data，升级不会清除。"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\墨墨桌宠.lnk"
  RMDir /r "$SMPROGRAMS\墨墨桌宠"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\MomoPet"
  RMDir /r "$INSTDIR"
  ; Intentionally keep %LOCALAPPDATA%\MomoPet\data (accounts and pet history).
SectionEnd
