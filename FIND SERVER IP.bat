@echo off
echo Your server IPv4 addresses:
ipconfig | findstr /R /C:"IPv4 Address"
echo.
echo Coworkers should open: http://YOUR-IP:3500
pause
