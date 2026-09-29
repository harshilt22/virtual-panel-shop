@echo off
title Electrical Virtual Shop Server
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo.
 echo Node.js is not installed.
 echo Install Node.js LTS from https://nodejs.org/
 echo Then run this file again.
 pause
 exit /b 1
)
echo Starting Electrical Virtual Shop on port 3500...
start "" http://localhost:3500
node server.js
pause
