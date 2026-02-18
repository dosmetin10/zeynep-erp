@echo off
taskkill /F /IM MTN-Server.exe >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq MTN Server*" >nul 2>nul
