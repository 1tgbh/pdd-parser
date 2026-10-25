@echo off
chcp 65001 >nul 2>&1
title Install CA Certificate
cd /d "%~dp0"

echo.
echo  Installing mitmproxy CA certificate ...
echo  (Administrator privileges required)
echo.

set "CERTS_DIR=%~dp0pdd_proxy\certs"
set "CERT_FILE=%CERTS_DIR%\mitmproxy-ca-cert.cer"

if not exist "%CERT_FILE%" (
    echo  Certificate not found, generating ...
    if exist "%~dp0.venv\Scripts\python.exe" (
        "%~dp0.venv\Scripts\python.exe" -c "from mitmproxy.certs import CertStore; CertStore.from_store(r'%CERTS_DIR%', 'mitmproxy', 2048)" >nul 2>&1
    ) else if exist "%~dp0python\python.exe" (
        "%~dp0python\python.exe" -c "from mitmproxy.certs import CertStore; CertStore.from_store(r'%CERTS_DIR%', 'mitmproxy', 2048)" >nul 2>&1
    ) else (
        python -c "from mitmproxy.certs import CertStore; CertStore.from_store(r'%CERTS_DIR%', 'mitmproxy', 2048)" >nul 2>&1
    )
)

if not exist "%CERT_FILE%" (
    echo  [ERROR] Certificate file not found: %CERT_FILE%
    echo  Please run start.bat once to install dependencies and generate
    echo  certificates, or install dependencies manually:
    echo      pip install -r pdd_proxy\requirements.txt
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_cert.ps1" "%CERT_FILE%"
if errorlevel 1 (
    echo  [FAIL] Certificate installation failed.
) else (
    echo  [OK] Certificate installed successfully!
)
pause
