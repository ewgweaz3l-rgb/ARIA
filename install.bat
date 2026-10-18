@echo off
title Install ARIA
setlocal
set "DEST=%LOCALAPPDATA%\ARIA"
echo.
echo  Installing ARIA to %DEST%
echo.

rem --- Python (3.9+) -------------------------------------------------------
set "PYW="
for /f "delims=" %%P in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%P"
if not defined PY for /f "delims=" %%P in ('python -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%P"
if not defined PY (
  echo  Python not found - installing it with winget...
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not defined PY (
  echo.
  echo  Couldn't find or install Python. Install Python 3.12 from python.org, then run this again.
  pause & exit /b 1
)
set "PYW=%PY:python.exe=pythonw.exe%"
if not exist "%PYW%" set "PYW=%PY%"

rem --- copy the app (your settings and data are never overwritten) ----------
robocopy "%~dp0." "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XD cache backups browser-profile __pycache__ .git /XF config.json macros.json aria.log install.bat >nul
if not exist "%DEST%\cache" mkdir "%DEST%\cache"

rem --- shortcuts ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=New-Object -ComObject WScript.Shell;" ^
  "foreach($p in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){" ^
  " $l=$s.CreateShortcut((Join-Path $p 'ARIA.lnk'));" ^
  " $l.TargetPath='%PYW%'; $l.Arguments='\"%DEST%\launcher.pyw\"'; $l.WorkingDirectory='%DEST%';" ^
  " $l.IconLocation='%DEST%\aria.ico'; $l.Description='ARIA Quartermaster'; $l.Save() }"

echo.
echo  Done. ARIA is on your desktop and in the Start menu.
echo  It checks for updates every time it starts - no more downloading zips.
echo.
start "" "%PYW%" "%DEST%\launcher.pyw"
timeout /t 4 >nul
