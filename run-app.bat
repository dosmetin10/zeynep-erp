@echo off
setlocal

title MTN Muhasebe - Calistir
cd /d "%~dp0"

echo ==============================================
echo MTN Muhasebe ^| Calistir
echo ==============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi.
  echo Lutfen once Node.js LTS kurun: https://nodejs.org/
  pause
  exit /b 1
)

echo Kutuphaneler kontrol ediliyor...
if not exist node_modules (
  echo node_modules yok, npm install calisiyor...
  call npm install
  if errorlevel 1 (
    echo Hata: npm install basarisiz.
    pause
    exit /b 1
  )
)

echo.
echo Uygulama baslatiliyor...
call npm start
endlocal
