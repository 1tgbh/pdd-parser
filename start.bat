@echo off
chcp 65001 >nul 2>&1
title PDD Parser
cd /d "%~dp0"

set "VENV_DIR=%~dp0.venv"
set "PY_EXE=%VENV_DIR%\Scripts\python.exe"

if not exist "%PY_EXE%" (
    echo  First run - creating virtual environment ...
    where python >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Python not found. Please install Python 3.10+ and add it to PATH.
        pause
        exit /b 1
    )
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo  [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo  Installing dependencies ...
    "%PY_EXE%" -m pip install -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo  [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

"%PY_EXE%" -u "%~dp0pdd_proxy\start.py"
if errorlevel 1 echo.
pause
