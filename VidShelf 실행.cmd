@echo off
rem VidShelf: start (builds first if there is a new version)
cd /d "%~dp0"
where node >NUL 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Run "VidShelf setup" first.
  pause
  exit /b 1
)
node scripts\launch.cjs
