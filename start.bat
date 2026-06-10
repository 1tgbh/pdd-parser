@echo off
chcp 65001 >nul 2>&1
title PDD Proxy Service
cd /d "%~dp0"

set "PY_DIR=%~dp0python"
set "PY_HOME=%~dp0python"
if "%PY_HOME:~-1%"=="\" set "PY_HOME=%PY_HOME:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init_venv.ps1" -PyDir "%PY_DIR%" -PyHome "%PY_HOME%"

set PYTHONHOME=
set PYTHONPATH=
set PATH=%PY_DIR%;%PY_DIR%\Scripts;%PATH%
"%PY_DIR%\python.exe" "%~dp0pdd_proxy\start.py"
if errorlevel 1 echo.
pause
