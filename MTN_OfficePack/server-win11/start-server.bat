@echo off
setlocal enabledelayedexpansion
if not exist mtn.env (
  echo SERVER_PORT=3777> mtn.env
  echo SERVER_IP=127.0.0.1>> mtn.env
)
for /f "tokens=1,2 delims==" %%a in (mtn.env) do set %%a=%%b
if not exist data mkdir data
if not exist logs mkdir logs
if "%BACKUP_KEY%"=="" (
  set BACKUP_KEY=%RANDOM%%RANDOM%%RANDOM%%RANDOM%
  echo BACKUP_KEY=!BACKUP_KEY!>> mtn.env
)
if exist MTN-Server.exe (
  start "MTN Server" /min MTN-Server.exe >> logs\server.log 2>&1
) else (
  start "MTN Server" /min cmd /c "node ..\..\server-src\src\index.js >> logs\server.log 2>&1"
)
start http://%SERVER_IP%:%SERVER_PORT%
