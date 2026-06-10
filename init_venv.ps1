param([string]$PyDir, [string]$PyHome)

$cfgPath = Join-Path $PyDir "pyvenv.cfg"
$needWrite = $true

if (Test-Path $cfgPath) {
    $content = Get-Content $cfgPath -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($PyHome)) {
        $needWrite = $false
    }
}

if ($needWrite) {
    $lines = @(
        "home = $PyHome",
        "include-system-site-packages = true",
        "version = 3.12.3"
    )
    [System.IO.File]::WriteAllLines($cfgPath, $lines, [System.Text.UTF8Encoding]::new($false))
}
