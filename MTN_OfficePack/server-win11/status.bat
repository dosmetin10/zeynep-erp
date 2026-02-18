@echo off
netstat -ano | findstr :3777
tasklist | findstr /I "MTN-Server.exe node.exe"
