@echo off
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" scripts\local-app.mjs start
  if errorlevel 1 pause
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Double-click Setup-Local.cmd once, then try again.
  pause
  exit /b 1
)
node scripts\local-app.mjs start
if errorlevel 1 (
  echo.
  echo See the message above and README.md for help.
  pause
)
