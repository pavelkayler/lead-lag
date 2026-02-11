@echo off
setlocal

if /I "%1"=="stop" goto stop
if /I "%1"=="restart" goto restart
goto start

:start
echo [Lead-Lag] Запуск backend и frontend...
start "Lead-Lag Backend" cmd /k "cd /d %~dp0backend && npm install && npm run dev"
start "Lead-Lag Frontend" cmd /k "cd /d %~dp0frontend && npm install && npm run dev"
goto :eof

:stop
echo [Lead-Lag] Остановка процессов node.exe (остановит все Node-процессы в системе).
taskkill /F /IM node.exe >nul 2>nul
goto :eof

:restart
call "%~f0" stop
timeout /t 1 >nul
call "%~f0"
