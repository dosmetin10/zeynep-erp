@echo off
setlocal

title MTN Muhasebe - Kurulum Dosyasi Olustur
cd /d "%~dp0"

echo ==============================================
echo MTN Muhasebe ^| Setup Olusturucu
echo ==============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi.
  echo Lutfen once Node.js LTS kurun: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo NPM bulunamadi.
  echo Node.js kurulumunu dogrulayin.
  pause
  exit /b 1
)

echo [1/2] Kutuphaneler kuruluyor (npm install)...
call npm install
if errorlevel 1 (
  echo Hata: npm install basarisiz.
  pause
  exit /b 1
)

echo.
echo [2/2] Setup olusturuluyor (npm run dist)...
call npm run dist
if errorlevel 1 (
  echo Hata: dist olusturulamadi.
  pause
  exit /b 1
)

echo.
echo TAMAM! Kurulum dosyasi "dist" klasorune olusturuldu.
echo dist klasoru icinde "Setup.exe" dosyasini bulup calistirin.
echo.
pause
endlocal
