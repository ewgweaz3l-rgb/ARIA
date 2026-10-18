@echo off
title Install ARIA
setlocal EnableDelayedExpansion
set "DEST=%LOCALAPPDATA%\ARIA"
set "PYVER=3.12.7"
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-amd64.exe"
echo.
echo  ================================
echo   ARIA Quartermaster - installer
echo  ================================
echo.

rem --- 1. find a Python 3.9+ ------------------------------------------------
call :findpy
if defined PY goto :havepy

echo  Python 3.9+ not found. Installing Python %PYVER%...
echo.
where winget >nul 2>nul
if %errorlevel%==0 (
  echo  Using winget...
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  call :findpy
)
if defined PY goto :havepy

echo  Downloading the official installer from python.org...
set "PYSETUP=%TEMP%\python-%PYVER%-amd64.exe"
curl -L -# -o "%PYSETUP%" "%PYURL%"
if not exist "%PYSETUP%" (
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri '%PYURL%' -OutFile '%PYSETUP%'"
)
if not exist "%PYSETUP%" (
  echo.
  echo  Couldn't download Python. Check your internet connection, or install
  echo  Python 3.12 from python.org yourself ^(tick "Add python.exe to PATH"^) and run this again.
  pause & exit /b 1
)
echo  Installing ^(this takes about a minute^)...
"%PYSETUP%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1 SimpleInstall=1
del "%PYSETUP%" >nul 2>nul
call :findpy
if defined PY goto :havepy
echo.
echo  Python was installed but can't be found yet. Close this window, open a NEW one, and run install.bat again.
pause & exit /b 1

:havepy
for /f "delims=" %%V in ('"%PY%" -c "import sys;print(sys.version.split()[0])"') do set "PYV=%%V"
echo  Python %PYV% at %PY%
set "PYW=%PY:python.exe=pythonw.exe%"
if not exist "%PYW%" set "PYW=%PY%"

rem --- 2. copy the app (your settings and data are never overwritten) -------
echo  Installing ARIA to %DEST%
robocopy "%~dp0." "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XD cache backups browser-profile __pycache__ .git /XF config.json macros.json aria.log install.bat >nul
if not exist "%DEST%\cache" mkdir "%DEST%\cache"

rem --- 3. shortcuts ---------------------------------------------------------
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
exit /b 0

rem --- helper: set PY to a python.exe that is 3.9 or newer ------------------
:findpy
set "PY="
for %%C in ("py -3" "python" "python3") do (
  for /f "delims=" %%P in ('%%~C -c "import sys;print(sys.executable if sys.version_info>=(3,9) else '')" 2^>nul') do if not defined PY set "PY=%%P"
)
if defined PY exit /b 0
for %%D in ("%LOCALAPPDATA%\Programs\Python\Python313" "%LOCALAPPDATA%\Programs\Python\Python312" "%LOCALAPPDATA%\Programs\Python\Python311" "%LOCALAPPDATA%\Programs\Python\Python310" "%ProgramFiles%\Python313" "%ProgramFiles%\Python312" "%ProgramFiles%\Python311" "%ProgramFiles%\Python310") do (
  if not defined PY if exist "%%~D\python.exe" set "PY=%%~D\python.exe"
)
exit /b 0
