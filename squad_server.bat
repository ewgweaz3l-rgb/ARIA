@echo off
title ARIA squad server
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py squad_server.py %*) else (python squad_server.py %*)
pause
