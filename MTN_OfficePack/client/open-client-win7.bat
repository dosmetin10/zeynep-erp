@echo off
set CFG=client-config.json
if not exist %CFG% (
  set /p SERVER_IP=Win11 sunucu IP adresi:
  echo {"SERVER_IP":"%SERVER_IP%","SERVER_PORT":3777}> %CFG%
)
for /f "tokens=2 delims=:,}" %%a in ('type %CFG% ^| findstr SERVER_IP') do set IP=%%~a
set IP=%IP:"=%
start http://%IP%:3777
