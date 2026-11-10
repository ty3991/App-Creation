@echo off
cd /d "%~dp0"
echo Starting Printelligent Quote Desk at http://localhost:4173
echo Press Ctrl+C in this window to stop the server.
node --env-file-if-exists=../.env.local server.mjs
if errorlevel 1 (
  echo.
  echo Node.js 24 or newer must be installed and available on PATH.
  echo See README.md for setup instructions.
  pause
)
