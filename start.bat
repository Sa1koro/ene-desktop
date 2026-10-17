@echo off
rem Double-click to start ENE: the desktop pet when Rust is installed, otherwise a
rem browser preview. The logic lives in scripts\launch.mjs (see README).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node scripts\launch.mjs %*
if errorlevel 1 pause
exit /b

:nonode
chcp 65001 >nul
echo [ENE] 没有找到 Node.js。请先安装 Node.js 22 LTS（https://nodejs.org/），装好后再双击本文件。
start "" https://nodejs.org/
pause
exit /b 1
