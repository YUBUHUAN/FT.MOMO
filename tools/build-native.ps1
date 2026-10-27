<#
  重新发布墨墨的 Windows 版本。

  用法（在仓库根目录）：
    powershell -ExecutionPolicy Bypass -File tools\build-native.ps1

  产物：
    dist\MomoPet-Windows            框架依赖版（需要 .NET 10 Desktop Runtime）
    dist\MomoPet-Windows-Portable   带私有 .NET 运行时 + 启动墨墨.cmd

  需要：.NET 10 SDK
#>
param(
  [switch]$SkipPortable
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "desktop-native"
$dist = Join-Path $root "dist"
$lite = Join-Path $dist "MomoPet-Windows"
$portable = Join-Path $dist "MomoPet-Windows-Portable"

Write-Host "==> publish framework-dependent build" -ForegroundColor Cyan
Remove-Item $lite -Recurse -Force -ErrorAction SilentlyContinue
dotnet publish $project -c Release -r win-x64 --self-contained false -p:PublishSingleFile=false -o $lite
Get-ChildItem $lite -Filter *.pdb -Recurse | Remove-Item -Force -ErrorAction SilentlyContinue

if ($SkipPortable) {
  Write-Host "done: $lite" -ForegroundColor Green
  return
}

Write-Host "==> locate .NET 10 desktop runtime" -ForegroundColor Cyan
$lines = dotnet --list-runtimes
$versions = @()
foreach ($line in $lines) {
  if ($line -match '^Microsoft\.WindowsDesktop\.App\s+(10\.[0-9]+\.[0-9]+)\s') {
    $versions += $Matches[1]
  }
}
if ($versions.Count -eq 0) {
  throw "没有找到 Microsoft.WindowsDesktop.App 10.x 运行时，无法制作便携版。"
}
$version = ($versions | Sort-Object { [version]$_ } -Descending | Select-Object -First 1)
$dotnetRoot = Split-Path (Get-Command dotnet).Source
Write-Host "    runtime $version from $dotnetRoot"

Write-Host "==> assemble portable copy" -ForegroundColor Cyan
Remove-Item $portable -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item (Join-Path $lite "*") $portable -Recurse -Force

$hostFxr = Join-Path $dotnetRoot "host\fxr\$version"
$netCore = Join-Path $dotnetRoot "shared\Microsoft.NETCore.App\$version"
$desktop = Join-Path $dotnetRoot "shared\Microsoft.WindowsDesktop.App\$version"
if (!(Test-Path $hostFxr) -or !(Test-Path $netCore) -or !(Test-Path $desktop)) {
  throw "运行时不完整：$hostFxr / $netCore / $desktop"
}

New-Item -ItemType Directory -Force -Path (Join-Path $portable "dotnet\host\fxr") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $portable "dotnet\shared\Microsoft.NETCore.App") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $portable "dotnet\shared\Microsoft.WindowsDesktop.App") | Out-Null
Copy-Item $hostFxr (Join-Path $portable "dotnet\host\fxr") -Recurse -Force
Copy-Item $netCore (Join-Path $portable "dotnet\shared\Microsoft.NETCore.App") -Recurse -Force
Copy-Item $desktop (Join-Path $portable "dotnet\shared\Microsoft.WindowsDesktop.App") -Recurse -Force

$launcher = @'
' MomoPet portable launcher: point DOTNET_ROOT at the bundled runtime, then start.
Option Explicit
Dim shell, fso, base, env
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set env = shell.Environment("PROCESS")
env("DOTNET_ROOT") = base & "\dotnet"
env("DOTNET_MULTILEVEL_LOOKUP") = "0"
shell.CurrentDirectory = base
shell.Run """" & base & "\MomoPet.exe""", 1, False
'@
$launcherPath = Join-Path $portable "启动墨墨.vbs"
Set-Content -Path $launcherPath -Value $launcher -Encoding ASCII

$cmdLauncher = @'
@echo off
cd /d "%~dp0"
set "DOTNET_ROOT=%~dp0dotnet"
set "DOTNET_MULTILEVEL_LOOKUP=0"
start "" "%~dp0MomoPet.exe"
timeout /t 2 >nul
tasklist /FI "IMAGENAME eq MomoPet.exe" | find /I "MomoPet.exe" >nul
if errorlevel 1 (
  echo.
  echo MomoPet did not start. Please run MomoPet.exe directly to see the error.
  pause
)
'@
Set-Content -Path (Join-Path $portable "启动墨墨.cmd") -Value $cmdLauncher -Encoding ASCII


$readme = @"
墨墨 · 桌宠（Windows 便携版）
================================

双击「启动墨墨.cmd」运行（推荐）。
如果 Windows 提示“Windows 已保护你的电脑”，点“更多信息” → “仍要运行”。
这是未购买代码签名证书的程序会出现的提示，不是病毒；介意的话可以先用压缩包里的绿色版。
如果系统已安装 .NET 10 Desktop Runtime，也可以直接双击 MomoPet.exe；
如果 cmd 也打不开，再试 启动墨墨.vbs；两者都会带上私有 .NET 运行时。

第一次打开会先出现登录 / 创建账号窗口；登录后她出现在右下角。
每个账号有独立的心情、饱食度、健康值、疲惫值、投喂 / 运动 / 出游记录。

右键她 → 个人页面，可以看到健康值、疲惫值、今日陪伴、运动/出游记录、可切换的小屋背景（主界面右上角背景图标），以及“账号与同步”里的手机地址。
现在使用云端同步：电脑和手机登录同一个账号即可，手机不用再连电脑的局域网。
数据保存在 %LOCALAPPDATA%\MomoPet\data（accounts.json / sessions.json / states/），升级或替换程序文件夹不会丢；旧版数据会自动迁移
"@
Set-Content -Path (Join-Path $portable "使用说明.txt") -Value $readme -Encoding UTF8

Write-Host "done:" -ForegroundColor Green
Write-Host "  $lite"
Write-Host "  $portable"
