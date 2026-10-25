@echo off
setlocal
cd /d "%~dp0"

set "NODE_DIR=%~dp0tools\node-v22.20.0-win-x64"
set "NODE_EXE=%NODE_DIR%\node.exe"

if not exist "%NODE_EXE%" (
  echo [error] Node.js not found: "%NODE_EXE%"
  echo Re-download Node.js into tools\ or install it system-wide.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [setup] installing dependencies...
  call "%NODE_DIR%\npm.cmd" install --no-audit --no-fund
  if errorlevel 1 (
    echo [error] npm install failed.
    pause
    exit /b 1
  )
)

echo [start] WASTED AI video bot
"%NODE_EXE%" --env-file-if-exists=.env src/index.js
if errorlevel 1 (
  echo.
  echo [error] bot stopped. Read the message above.
  pause
)

endlocal
