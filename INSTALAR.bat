@echo off
title ClickReel - Instalacao
cd /d "%~dp0"
echo.
echo  === ClickReel - instalacao ===
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  O Node.js nao esta instalado.
  echo  Vou abrir o site. Baixe a versao "LTS", instale com as opcoes padrao
  echo  e depois rode este arquivo de novo.
  start "" https://nodejs.org/pt
  pause
  exit /b 1
)
echo  [1/2] Instalando os componentes (pode levar alguns minutos)...
call npm install --no-fund --no-audit
if errorlevel 1 goto erro
echo.
echo  [2/2] Baixando o navegador usado nas gravacoes...
call npx playwright install chromium
if errorlevel 1 goto erro
echo.
echo  Criando atalho na Area de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+'\ClickReel.lnk'); $s.TargetPath='%~dp0ABRIR-PAINEL.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0clickreel.ico'; $s.Save()"
echo.
echo  Tudo pronto! Use o icone "ClickReel" na Area de Trabalho
echo  (ou o arquivo "ABRIR-PAINEL.bat").
echo.
pause
exit /b 0
:erro
echo.
echo  Algo deu errado na instalacao. Verifique sua internet e tente de novo.
pause
exit /b 1
