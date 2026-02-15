@echo off
title MTN ERP Kurulum (Tek Tik)
color 0A

echo ===============================
echo   MTN ERP - Kurulum Basliyor
echo   MTN Enerji Muhendislik //V\ Metin Dos
echo ===============================

REM Bu script Node.js kurulu olan Windows PC'de calisir.
REM Node.js yoksa: https://nodejs.org (LTS) indirip kurun.

cd /d %~dp0

echo [1/3] Bagimliliklar yukleniyor...
call npm install || goto :err

echo [2/3] Windows kurulumu olusturuluyor (Setup.exe)...
call npm run dist || goto :err

echo [3/3] Bitti.
echo Kurulum dosyaniz dist/ klasorunde olusur.

pause
exit /b 0

:err
echo.
echo HATA: Kurulum tamamlanamadi.
echo Lutfen hata mesajini bana gonder.
pause
exit /b 1
