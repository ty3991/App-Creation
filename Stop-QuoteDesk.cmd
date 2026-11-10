@echo off
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" scripts\local-app.mjs stop
) else (
  node scripts\local-app.mjs stop
)
if errorlevel 1 pause
