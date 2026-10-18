@echo off
title ARIA Quartermaster
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py server.py %*
) else (
  python server.py %*
)
if errorlevel 1 (
  echo.
  echo ARIA could not start. Install Python 3.9+ from python.org and tick "Add Python to PATH".
)
pause
