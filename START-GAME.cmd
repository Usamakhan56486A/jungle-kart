@echo off
setlocal
cd /d "%~dp0"
title Jungle Kart - Wild Circuit
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org to run the local game server.
  pause
  exit /b 1
)
if not exist "node_modules\three\package.json" (
  echo Preparing the browser game...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.mjs --open
pause
