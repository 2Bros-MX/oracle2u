@echo off
setlocal enabledelayedexpansion

echo ========================================
echo ORACLE2U Extension Installer
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Node.js found!
    node --version
    echo.
    goto :install
)

echo Node.js not found in PATH. Checking common installation locations...
set "NODE_PATH="

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_PATH=%ProgramFiles%\nodejs"
    echo Found Node.js in Program Files
) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
    echo Found Node.js in Program Files (x86)
) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_PATH=%LOCALAPPDATA%\Programs\nodejs"
    echo Found Node.js in Local AppData
)

if defined NODE_PATH (
    echo Adding Node.js to PATH for this session...
    set "PATH=!NODE_PATH!;!PATH!"
    goto :install
)

echo.
echo Node.js is not installed. Would you like to install it automatically? (Y/N)
set /p INSTALL_NODE="> "
if /i not "%INSTALL_NODE%"=="Y" (
    echo.
    echo Please install Node.js manually from https://nodejs.org/
    echo Then run this installer again.
    echo.
    pause
    exit /b 1
)

echo.
echo Downloading Node.js installer...
set "INSTALLER=%TEMP%\nodejs-installer.msi"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile '%INSTALLER%' -ErrorAction Stop; Write-Host 'Download complete' } catch { Write-Host 'Download failed:'; Write-Host $_.Exception.Message; exit 1 }"

if not exist "%INSTALLER%" (
    echo.
    echo ERROR: Failed to download Node.js installer.
    echo Please install Node.js manually from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo Installing Node.js (this may take a minute)...
echo Please wait...
start /wait msiexec /i "%INSTALLER%" /quiet /norestart

REM Wait for installation to complete
timeout /t 5 /nobreak >nul

REM Clean up installer
del "%INSTALLER%" >nul 2>&1

REM Check for Node.js after installation
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_PATH=%ProgramFiles%\nodejs"
) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_PATH=%LOCALAPPDATA%\Programs\nodejs"
)

if not defined NODE_PATH (
    echo.
    echo Node.js installation may have completed, but it was not found.
    echo Please close this window and run install.bat again.
    echo.
    pause
    exit /b 0
)

set "PATH=!NODE_PATH!;!PATH!"
echo Node.js installed successfully!
echo.

:install
echo Verifying Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is still not accessible.
    echo Please restart your computer or run this installer again.
    echo.
    pause
    exit /b 1
)

node --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to run Node.js.
    echo.
    pause
    exit /b 1
)
echo.

echo Installing dependencies...
if defined NODE_PATH (
    "!NODE_PATH!\npm.cmd" install
) else (
    call npm install
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to install dependencies.
    echo.
    pause
    exit /b 1
)

echo.
echo Building extension...
if defined NODE_PATH (
    "!NODE_PATH!\npm.cmd" run build
) else (
    call npm run build
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to build extension.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Open Google Chrome
echo 2. Navigate to chrome://extensions/
echo 3. Enable "Developer mode" (toggle in top-right)
echo 4. Click "Load unpacked"
echo 5. Select the "dist" folder in this directory
echo.
echo The extension is now ready to use!
echo.
pause
