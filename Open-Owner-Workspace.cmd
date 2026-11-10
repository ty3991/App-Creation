@echo off
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" scripts\local-app.mjs owner
) else (
  node scripts\local-app.mjs owner
)
if errorlevel 1 pause
