@echo off
rem VidShelf first-time setup: auto update on [Pull origin] + desktop icon
cd /d "%~dp0"
where node >NUL 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Opening https://nodejs.org - install the LTS version, then run this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
node scripts\launch.cjs --setup
