@echo off
:: Self-elevate via UAC if not already running as Administrator.
:: Installing WSL (if it's missing) requires this; if WSL/Docker are
:: already set up, running elevated doesn't cause any problems either way.
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :run
)
echo Requesting administrator privileges...
powershell -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
exit /b

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
