@echo off
setlocal enabledelayedexpansion

REM Change to the directory where this script is located
cd /d "%~dp0"

echo ========================================
echo ORACLE2U Extension Updater
echo ========================================
echo.
echo This will update the extension from GitHub.
echo Current directory: %CD%
echo.

REM Check if Node.js is installed
set "NODE_EXE="
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set "NODE_EXE=node"
    goto :check_npm
)

REM Check common installation paths
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
    echo ERROR: Node.js is not installed.
    echo Please install Node.js from https://nodejs.org/ or run install.bat first.
    echo.
    pause
    exit /b 1
)

:check_npm
echo Finding npm...
set "NPM_CMD="
set "USE_NPM_CLI=0"

if defined NODE_PATH (
    if exist "!NODE_PATH!\npm.cmd" (
        set "NPM_CMD=!NODE_PATH!\npm.cmd"
        echo Found npm.cmd at "!NPM_CMD!"
    ) else if exist "!NODE_PATH!\node_modules\npm\bin\npm-cli.js" (
        set "USE_NPM_CLI=1"
        set "NPM_CLI=!NODE_PATH!\node_modules\npm\bin\npm-cli.js"
        echo Found npm-cli.js at "!NPM_CLI!"
    )
)

if not defined NPM_CMD (
    if %USE_NPM_CLI% EQU 0 (
        where npm >nul 2>nul
        if %ERRORLEVEL% EQU 0 (
            set "NPM_CMD=npm"
        )
    )
)

if not defined NPM_CMD (
    if %USE_NPM_CLI% EQU 0 (
        echo ERROR: Cannot find npm.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Downloading latest version from GitHub...
set "ZIP_FILE=%TEMP%\oracle2u-update.zip"
set "EXTRACT_DIR=%TEMP%\oracle2u-update"

REM Clean up any previous update files
if exist "!ZIP_FILE!" del "!ZIP_FILE!" >nul 2>&1
if exist "!EXTRACT_DIR!" rmdir /s /q "!EXTRACT_DIR!" >nul 2>&1

REM Download the repository as ZIP from GitHub
REM Using main branch - change to 'master' if needed
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/2Bros-MX/oracle2u/archive/refs/heads/main.zip' -OutFile '!ZIP_FILE!' -ErrorAction Stop; Write-Host 'Download complete' } catch { Write-Host 'Download failed:'; Write-Host $_.Exception.Message; exit 1 }"

if not exist "!ZIP_FILE!" (
    echo.
    echo ERROR: Failed to download update from GitHub.
    echo Please check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

echo Extracting files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '!ZIP_FILE!' -DestinationPath '!EXTRACT_DIR!' -Force"

if not exist "!EXTRACT_DIR!\oracle2u-main" (
    echo.
    echo ERROR: Failed to extract update files.
    echo.
    pause
    exit /b 1
)

echo.
echo Updating files...
echo This will replace your current files with the latest version.
echo.
set /p CONFIRM="Continue? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    echo Update cancelled.
    pause
    exit /b 0
)

REM Backup current dist folder if it exists
if exist "dist" (
    echo Backing up current dist folder...
    if exist "dist-backup" rmdir /s /q "dist-backup" >nul 2>&1
    xcopy /E /I /Y "dist" "dist-backup" >nul 2>&1
)

REM Copy new files (exclude .git, node_modules, dist, and backup folders)
echo Copying new files...
robocopy "!EXTRACT_DIR!\oracle2u-main" "." /E /XD .git node_modules dist dist-backup /XF *.log .DS_Store /NFL /NDL /NJH /NJS >nul 2>&1

REM Clean up extracted files
echo Cleaning up...
rmdir /s /q "!EXTRACT_DIR!" >nul 2>&1
del "!ZIP_FILE!" >nul 2>&1

echo.
echo Installing dependencies...
cd /d "%~dp0"
echo Current directory: %CD%
echo Verifying package.json exists...
if not exist "package.json" (
    echo ERROR: package.json not found in current directory!
    echo Current directory: %CD%
    echo.
    pause
    exit /b 1
)
echo package.json found.
echo.
if %USE_NPM_CLI% EQU 1 (
    if defined NPM_CLI (
        if exist "!NPM_CLI!" (
            echo Using npm via node: "!NODE_EXE!" "!NPM_CLI!"
            "!NODE_EXE!" "!NPM_CLI!" install
        ) else (
            echo ERROR: npm-cli.js not found at "!NPM_CLI!"
            echo Please check your Node.js installation.
            pause
            exit /b 1
        )
    ) else (
        echo ERROR: NPM_CLI path not set.
        pause
        exit /b 1
    )
) else (
    if defined NPM_CMD (
        echo Using npm: "!NPM_CMD!"
        "!NPM_CMD!" install
    ) else (
        echo ERROR: NPM_CMD not set.
        pause
        exit /b 1
    )
)
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies.
    echo You may need to restore from dist-backup if something went wrong.
    echo.
    pause
    exit /b 1
)

echo.
echo Building extension...
cd /d "%~dp0"
echo Current directory: %CD%
if %USE_NPM_CLI% EQU 1 (
    if defined NPM_CLI (
        if exist "!NPM_CLI!" (
            echo Using npm via node: "!NODE_EXE!" "!NPM_CLI!"
            "!NODE_EXE!" "!NPM_CLI!" run build
        ) else (
            echo ERROR: npm-cli.js not found at "!NPM_CLI!"
            echo Please check your Node.js installation.
            pause
            exit /b 1
        )
    ) else (
        echo ERROR: NPM_CLI path not set.
        pause
        exit /b 1
    )
) else (
    if defined NPM_CMD (
        echo Using npm: "!NPM_CMD!"
        "!NPM_CMD!" run build
    ) else (
        echo ERROR: NPM_CMD not set.
        pause
        exit /b 1
    )
)
if errorlevel 1 (
    echo.
    echo ERROR: Build failed.
    echo You may need to restore from dist-backup if something went wrong.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Update Complete!
echo ========================================
echo.
echo The extension has been updated to the latest version.
echo Your previous dist folder has been backed up to "dist-backup".
echo.
echo Next steps:
echo 1. Open Google Chrome
echo 2. Navigate to chrome://extensions/
echo 3. Click the refresh icon on the ORACLE2U extension
echo.
echo The extension is now ready to use!
echo.
pause
