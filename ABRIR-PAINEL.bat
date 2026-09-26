@echo off
title Estudio Demo
cd /d "%~dp0"
if not exist "node_modules\playwright" (
  call INSTALAR.bat
  if errorlevel 1 exit /b 1
)
node server.js
echo.
echo  O Estudio Demo foi encerrado.
pause
