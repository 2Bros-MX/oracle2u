@echo off
setlocal enabledelayedexpansion

echo ========================================
echo ORACLE2U Extension Installer
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js not found. Installing Node.js automatically...
    echo.
    
    REM Try to find Node.js in common installation paths
    set "NODE_PATH="
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_PATH=%ProgramFiles%\nodejs"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "NODE_PATH=%LOCALAPPDATA%\Programs\nodejs"
    )
    
    if not defined NODE_PATH (
        echo Downloading Node.js installer...
        set "INSTALLER=%TEMP%\nodejs-installer.msi"
        
        REM Download latest LTS Node.js (Windows x64)
        REM Note: Using Node.js v20 LTS - update version if needed
        powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi' -OutFile '%INSTALLER%'}"
        
        if not exist "%INSTALLER%" (
            echo ERROR: Failed to download Node.js installer.
            echo Please install Node.js manually from https://nodejs.org/
            echo.
            pause
            exit /b 1
        )
        
        echo Installing Node.js (this may take a minute)...
        echo Please wait...
        
        REM Install Node.js silently
        msiexec /i "%INSTALLER%" /quiet /norestart /L*v "%TEMP%\nodejs-install.log"
        
        REM Wait a moment for installation to complete
        timeout /t 5 /nobreak >nul
        
        REM Clean up installer
        del "%INSTALLER%" >nul 2>&1
        
        REM Try to find Node.js in common installation paths after install
        if exist "%ProgramFiles%\nodejs\node.exe" (
            set "NODE_PATH=%ProgramFiles%\nodejs"
        ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
            set "NODE_PATH=%ProgramFiles(x86)%\nodejs"
        ) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
            set "NODE_PATH=%LOCALAPPDATA%\Programs\nodejs"
        )
        
        if not defined NODE_PATH (
            echo.
            echo Node.js installation completed, but PATH may need to be refreshed.
            echo Please close this window and run install.bat again.
            echo.
            pause
            exit /b 0
        )
        
        echo Node.js installed successfully!
        echo.
    )
    
    REM Add Node.js to PATH for this session
    set "PATH=%NODE_PATH%;%PATH%"
)

REM Verify Node.js is accessible
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if defined NODE_PATH (
        set "PATH=%NODE_PATH%;%PATH%"
    ) else (
        echo ERROR: Node.js is still not accessible.
        echo Please restart your computer or run this installer again.
        echo.
        pause
        exit /b 1
    )
)

echo Checking Node.js version...
node --version
echo.

echo Installing dependencies...
if defined NODE_PATH (
    "%NODE_PATH%\npm.cmd" install
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
    "%NODE_PATH%\npm.cmd" run build
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

