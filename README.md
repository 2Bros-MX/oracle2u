# ORACLE2U

A Chrome extension for automating file downloads from Oracle2u and syncing data to AWS S3 and Oracle systems.

## What It Does

ORACLE2U automates the process of downloading stock, pricing, and product files from the Oracle2u platform. It handles login, navigation, and file management automatically. Downloaded files can be uploaded to AWS S3 for storage and synced to Oracle systems for data updates.

## Features

- Automated file downloads from Oracle2u stock page
- Automatic login with saved credentials
- Multiple file support (Stock Qtys, Pricing, Products)
- AWS S3 integration for file storage
- Oracle API integration for data syncing
- Session-based file organization
- Real-time status tracking and activity logging

## Installation

### Windows (Easy Install)

1. Double-click `install.bat` and follow the on-screen instructions
2. Once installation completes, open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked" and select the `dist` folder

### Manual Install

1. Make sure Node.js is installed (download from https://nodejs.org/)
2. Open terminal/command prompt in this directory
3. Run `npm install` to install dependencies
4. Run `npm run build` to build the extension
5. Open Chrome and navigate to `chrome://extensions/`
6. Enable "Developer mode"
7. Click "Load unpacked" and select the `dist` folder

## Configuration

Configure the extension through the settings panel:

- **Download Targets**: Customize CSS selectors for download buttons
- **Auto-Login**: Set up automatic login credentials
- **AWS S3**: Configure S3 bucket and credentials for file storage
- **Oracle**: Set up API key and base URL for data syncing

## Usage

1. Open the extension side panel
2. Configure your settings (download targets, credentials, S3, Oracle)
3. Click "Download Files" to start the automated workflow
4. Files are downloaded to `Downloads/oro-scrape/` with unique session IDs
5. Use "Upload to S3" to upload files to your configured S3 bucket
6. Use "Sync" to sync data to Oracle systems

## Requirements

- Node.js (download from https://nodejs.org/)
- Chrome browser (version 114+ for side panel support)
- Valid Oracle2u account credentials
- AWS S3 bucket and credentials (optional, for file storage)
- Oracle API key and base URL (optional, for data syncing)
