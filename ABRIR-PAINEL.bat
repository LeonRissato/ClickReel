@echo off
title ClickReel
cd /d "%~dp0"
if not exist "node_modules\playwright" (
  call INSTALAR.bat
  if errorlevel 1 exit /b 1
)
node server.js
echo.
echo  O ClickReel foi encerrado.
pause
