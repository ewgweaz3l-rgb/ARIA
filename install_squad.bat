@echo off
title Install ARIA squad server
setlocal EnableDelayedExpansion
set "DEST=%LOCALAPPDATA%\ARIA-Squad"
set "PYVER=3.12.7"
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-amd64.exe"
set "PORT=8777"
echo.
echo  ====================================
echo   ARIA squad server - installer
echo   (leaderboards + game lobby host)
echo  ====================================
echo.

rem --- 1. Python 3.9+ ------------------------------------------------------
call :findpy
if defined PY goto :havepy
echo  Python 3.9+ not found. Installing Python %PYVER%...
where winget >nul 2>nul
if %errorlevel%==0 (
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  call :findpy
)
if defined PY goto :havepy
set "PYSETUP=%TEMP%\python-%PYVER%-amd64.exe"
curl -L -# -o "%PYSETUP%" "%PYURL%"
if not exist "%PYSETUP%" powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -Uri '%PYURL%' -OutFile '%PYSETUP%'"
if not exist "%PYSETUP%" ( echo  Couldn't download Python. Install 3.12 from python.org and run this again. & pause & exit /b 1 )
"%PYSETUP%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1 SimpleInstall=1
del "%PYSETUP%" >nul 2>nul
call :findpy
if not defined PY ( echo  Python installed but not found yet - open a NEW window and run this again. & pause & exit /b 1 )

:havepy
set "PYW=%PY:python.exe=pythonw.exe%"
if not exist "%PYW%" set "PYW=%PY%"
echo  Python at %PY%

rem --- 2. copy the server (your key, scores and lobbies are kept) ----------
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0squad_server.py" "%DEST%\" >nul
copy /y "%~dp0squad.py" "%DEST%\" >nul
copy /y "%~dp0VERSION" "%DEST%\" >nul
copy /y "%~dp0squad_server.bat" "%DEST%\" >nul 2>nul
copy /y "%~dp0README-SQUAD.txt" "%DEST%\" >nul 2>nul
set "NAME=%COMPUTERNAME%"
set /p "NAME=  Name to show on the boards [%COMPUTERNAME%]: "
if "%NAME%"=="" set "NAME=%COMPUTERNAME%"

rem --- 3. firewall rule (one admin prompt; skip it if friends are on a VPN) -
echo  Opening port %PORT% in Windows Firewall (admin prompt)...
powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"ARIA squad server\" dir=in action=allow protocol=TCP localport=%PORT%' -Verb RunAs -Wait" >nul 2>nul

rem --- 4. run at every logon, hidden ---------------------------------------
schtasks /delete /tn "ARIA squad server" /f >nul 2>nul
schtasks /create /tn "ARIA squad server" /sc onlogon /rl limited /f /tr "\"%PYW%\" \"%DEST%\squad_server.py\" --name \"%NAME%\" --port %PORT%" >nul
if errorlevel 1 echo  (couldn't add the logon task - start it by hand with %DEST%\squad_server.bat)

rem --- 5. start it now and show the key -----------------------------------
start "" "%PYW%" "%DEST%\squad_server.py" --name "%NAME%" --port %PORT%
timeout /t 2 >nul
echo.
echo  ---------------------------------------------------------------
echo   Running. Give your squad this address and key:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "IP=%%A" & set "IP=!IP: =!" & echo     http://!IP!:%PORT%
)
for /f "usebackq tokens=*" %%K in (`"%PY%" -c "import json;print(json.load(open(r'%DEST%\squad_config.json'))['key'])"`) do echo     key: %%K
echo.
echo   Everyone (you too): ARIA - Settings - Squad - paste both - Test.
echo   Status page: http://localhost:%PORT%     Files: %DEST%
echo   Starts by itself at every logon. Remove: schtasks /delete /tn "ARIA squad server" /f
echo  ---------------------------------------------------------------
start "" "http://localhost:%PORT%/"
pause
exit /b 0

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
