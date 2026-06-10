@echo off
chcp 65001 >nul 2>&1
title Install CA Certificate
cd /d "%~dp0"

echo.
echo  Installing mitmproxy CA certificate ...
echo  (Administrator privileges required)
echo.

set "CERT_FILE=%~dp0pdd_proxy\certs\mitmproxy-ca-cert.cer"

if not exist "%CERT_FILE%" (
    echo  [ERROR] Certificate file not found: %CERT_FILE%
    echo  Please run the proxy service once to generate certificates.
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
