Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".env")) {
    Write-Host "No .env found. Run setup.bat (or setup.ps1) first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

docker compose up -d 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host "docker compose failed - is Docker Desktop running?" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$envLines = Get-Content ".env"
$portLine = $envLines | Where-Object { $_ -match '^APP_PORT=' }
$port = if ($portLine) { $portLine -replace '^APP_PORT=', '' } else { "8080" }

Write-Host "Started. Visit https://localhost:$port" -ForegroundColor Green
Read-Host "Press Enter to close this window"
