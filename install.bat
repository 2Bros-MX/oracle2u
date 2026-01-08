@echo off
setlocal enabledelayedexpansion

echo ========================================
echo ORACLE2U Extension Installer
echo ========================================
echo.

REM Check if Node.js is installed and accessible
set "NODE_EXE="
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "NODE_EXE=node"
    echo Node.js found in PATH!
    node --version
    echo.
    goto :install
)

REM Check common installation paths
if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    set "NODE_PATH=%ProgramFiles%\nodejs"
    echo Found Node.js in Program Files
) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
    set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
    echo Found Node.js in Program Files (x86)
) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    set "NODE_PATH=%LOCALAPPDATA%\Programs\nodejs"
    echo Found Node.js in Local AppData
)

if defined NODE_EXE (
    echo Testing Node.js...
    "!NODE_EXE!" --version >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        "!NODE_EXE!" --version
        echo.
        goto :install
    )
)

REM Node.js not found - offer to install
echo.
echo Node.js is not installed or not accessible.
echo Would you like to install it automatically? (Y/N)
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

REM Wait longer for installation to complete and npm to be available
echo Waiting for installation to finish...
timeout /t 15 /nobreak >nul

REM Clean up installer
del "%INSTALLER%" >nul 2>&1

REM Check for Node.js after installation
set "NODE_EXE="
set "NODE_PATH="

if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
    set "NODE_PATH=%ProgramFiles%\nodejs"
) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
    set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    set "NODE_PATH=%LOCALAPPDATA%\Programs\nodejs"
)

if not defined NODE_EXE (
    echo.
    echo Node.js installation completed, but it was not found in expected locations.
    echo Please close this window and run install.bat again.
    echo.
    pause
    exit /b 0
)

echo Testing installed Node.js...
"!NODE_EXE!" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Node.js was installed but is not working correctly.
    echo Please close this window and run install.bat again.
    echo.
    pause
    exit /b 0
)

"!NODE_EXE!" --version
echo Node.js installed successfully!
echo.

:install
REM Verify we have a working Node.js
if not defined NODE_EXE (
    if defined NODE_PATH (
        set "NODE_EXE=!NODE_PATH!\node.exe"
    ) else (
        where node >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            set "NODE_EXE=node"
        ) else (
            echo ERROR: Cannot find Node.js executable.
            echo.
            pause
            exit /b 1
        )
    )
)

REM Test Node.js
"!NODE_EXE!" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not working correctly.
    echo.
    pause
    exit /b 1
)

echo Finding npm...
set "NPM_EXE="
set "NPM_CLI="

REM Try to find npm.cmd first
if defined NODE_PATH (
    if exist "!NODE_PATH!\npm.cmd" (
        set "NPM_EXE=!NODE_PATH!\npm.cmd"
        echo Found npm.cmd
    )
)

REM If npm.cmd not found, try to find npm-cli.js and use node to run it
if not defined NPM_EXE (
    if defined NODE_PATH (
        if exist "!NODE_PATH!\node_modules\npm\bin\npm-cli.js" (
            set "NPM_CLI=!NODE_PATH!\node_modules\npm\bin\npm-cli.js"
            echo Found npm-cli.js, will use node to run it
        )
    )
)

REM If still not found, try PATH
if not defined NPM_EXE (
    if not defined NPM_CLI (
        where npm >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            set "NPM_EXE=npm"
            echo Found npm in PATH
        )
    )
)

REM If we have npm-cli.js, construct command to use node
if defined NPM_CLI (
    REM Create a wrapper: node.exe npm-cli.js [args]
    set "NPM_EXE=!NODE_EXE! !NPM_CLI!"
)

if not defined NPM_EXE (
    echo.
    echo ERROR: Cannot find npm. Please ensure Node.js is properly installed.
    echo.
    pause
    exit /b 1
)

REM Test npm
echo Testing npm...
"!NPM_EXE!" --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo WARNING: npm test failed, but continuing anyway...
    echo.
) else (
    "!NPM_EXE!" --version
    echo.
)

echo Installing dependencies...
"!NPM_EXE!" install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to install dependencies.
    echo.
    pause
    exit /b 1
)

echo.
echo Building extension...
"!NPM_EXE!" run build
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
