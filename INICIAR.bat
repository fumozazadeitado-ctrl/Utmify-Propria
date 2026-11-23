@echo off
cd /d "%~dp0"
title Painel de rastreamento
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao 22 ou superior em https://nodejs.org
  pause
  exit /b
)
for /f "usebackq delims=" %%p in (`node -p "require('./marca.json').porta||3000" 2^>nul`) do set PORTA=%%p
if "%PORTA%"=="" set PORTA=3000
echo Iniciando o painel... nao feche esta janela.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://localhost:%PORTA%'"
node --no-warnings server.js
echo.
echo O servidor parou. Veja a mensagem de erro acima.
pause