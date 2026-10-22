@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title PC-Bridge — диагностика запуска

set "HERE=%~dp0"
set "EXE="
for %%F in ("%HERE%PC-Bridge-portable-*.exe") do set "EXE=%%~fF"
if not defined EXE (
  echo [!] Рядом с этим файлом не найден PC-Bridge-portable-*.exe
  echo     Положите diagnose.bat в ту же папку, что и exe.
  pause & exit /b 1
)

set "DATA=%LOCALAPPDATA%\PC-Bridge"
set "OUT=%USERPROFILE%\Desktop\pcbridge-diag"
if exist "%OUT%" rd /s /q "%OUT%"
mkdir "%OUT%" >nul 2>&1

echo ============================================
echo   PC-Bridge — диагностика
echo   exe: %EXE%
echo   логи: %OUT%
echo ============================================
echo.

echo [1/4] Чищу старые логи запуска
if exist "%DATA%\startup.log" del /q "%DATA%\startup.log"

echo [2/4] Обычный запуск с логированием Chromium
echo       (окно может не появиться — ждите 20 секунд)
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1
"%EXE%" --enable-logging --v=1 > "%OUT%\run-console.log" 2>&1
echo       код завершения: %ERRORLEVEL%

if exist "%DATA%\startup.log" copy /y "%DATA%\startup.log" "%OUT%\startup-normal.log" >nul
if exist "%DATA%\chrome_debug.log" copy /y "%DATA%\chrome_debug.log" "%OUT%\chrome-normal.log" >nul

echo.
echo [3/4] Безопасный режим: без прозрачности, без оверлея, без трея
if exist "%DATA%\startup.log" del /q "%DATA%\startup.log"
"%EXE%" --safe --enable-logging --v=1 > "%OUT%\run-safe.log" 2>&1
echo       код завершения: %ERRORLEVEL%

if exist "%DATA%\startup.log" copy /y "%DATA%\startup.log" "%OUT%\startup-safe.log" >nul
if exist "%DATA%\pc_agent_log.txt" copy /y "%DATA%\pc_agent_log.txt" "%OUT%\agent.log" >nul

echo.
echo [4/4] Собираю сведения о системе и упаковываю
> "%OUT%\system.txt" (
  echo Дата: %DATE% %TIME%
  echo Windows:
  ver
  echo.
  echo Разрядность и версия:
  wmic os get Caption,Version,BuildNumber,OSArchitecture /value 2>nul
  echo.
  echo Пользователь: %USERNAME%  ^(админ: проверьте UAC-запрос^)
  echo.
  echo Файлы PC-Bridge:
  dir /b "%DATA%" 2>nul
)

powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath '%USERPROFILE%\Desktop\pcbridge-diag.zip' -Force" >nul 2>&1

echo.
echo ============================================
if exist "%USERPROFILE%\Desktop\pcbridge-diag.zip" (
  echo Готово. Архив с логами:
  echo   %USERPROFILE%\Desktop\pcbridge-diag.zip
  echo.
  echo Пришлите этот архив — в нём startup.log, консоль Chromium
  echo и сведения о системе.
) else (
  echo Логи лежат в папке: %OUT%
)
echo ============================================
echo.
echo Содержимое startup.log (обычный запуск):
echo ----------------------------------------
if exist "%OUT%\startup-normal.log" type "%OUT%\startup-normal.log"
echo ----------------------------------------
echo Содержимое startup.log (безопасный режим):
echo ----------------------------------------
if exist "%OUT%\startup-safe.log" type "%OUT%\startup-safe.log"
echo ----------------------------------------
pause
