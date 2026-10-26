@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE=%~dp0desktop-native\node\node.exe"
if not exist "%NODE%" set "NODE=node"

echo.
echo   墨墨的小屋（仅服务端）
echo   关闭此窗口即停止同步服务。
echo.
"%NODE%" server\server.js

pause
