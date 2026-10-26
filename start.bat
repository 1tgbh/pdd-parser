@echo off
chcp 65001 >nul 2>&1
title PDD Proxy Service
cd /d "%~dp0"

set "PY_DIR=%~dp0python"
set "PY_HOME=%~dp0python"
if "%PY_HOME:~-1%"=="\" set "PY_HOME=%PY_HOME:~0,-1%"

set PYTHONHOME=
set PYTHONPATH=
set PYTHONUNBUFFERED=1
if exist "%PY_DIR%\python.exe" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0init_venv.ps1" -PyDir "%PY_DIR%" -PyHome "%PY_HOME%"
    "%PY_DIR%\python.exe" -u "%~dp0pdd_proxy\start.py" %*
) else if exist "%~dp0.venv\Scripts\python.exe" (
    "%~dp0.venv\Scripts\python.exe" -u "%~dp0pdd_proxy\start.py" %*
) else (
    python -u "%~dp0pdd_proxy\start.py" %*
)
if errorlevel 1 echo.
pause
