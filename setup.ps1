#Requires -Version 5.1

# Deliberately NOT setting $ErrorActionPreference = "Stop" globally.
# See README troubleshooting section - native command stderr output can be
# treated as a terminating error by some PowerShell versions when EAP is
# Stop, even on a zero exit code. We check $LASTEXITCODE ourselves instead.

Set-Location -Path $PSScriptRoot

Write-Host "== RDP Web App - Setup ==" -ForegroundColor Cyan
Write-Host ""

function Test-CommandExists($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# --- WSL check ---
# Docker Desktop requires WSL 2 to be installed regardless of whether you
# actually use the WSL2 or Hyper-V backend for containers - it's a hard
# prerequisite of Docker Desktop itself, not something we can skip.
Write-Host "Checking for Windows Subsystem for Linux (WSL)..."
wsl --status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "WSL is not installed yet - Docker Desktop requires it." -ForegroundColor Yellow

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "Installing WSL requires Administrator privileges." -ForegroundColor Red
        Write-Host "Right-click setup.bat and choose 'Run as administrator', then run this again."
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host "Installing WSL now..."
    wsl --install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "wsl --install did not complete successfully." -ForegroundColor Red
        Write-Host "Try running 'wsl --install' manually from an Administrator PowerShell prompt."
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host ""
    Write-Host "WSL was installed successfully." -ForegroundColor Green
    Write-Host "Your computer needs to RESTART before continuing - this is a Windows/WSL" -ForegroundColor Yellow
    Write-Host "requirement, not something this script can skip." -ForegroundColor Yellow
    Write-Host "After restarting, just run setup.bat again - it'll pick up right where it left off."
    Read-Host "Press Enter to exit"
    exit 0
}
Write-Host "WSL is already installed."
Write-Host ""

# --- Docker check ---
if (-not (Test-CommandExists "docker")) {
    Write-Host "Docker Desktop was not found on this machine." -ForegroundColor Yellow
    $answer = Read-Host "Attempt to install Docker Desktop automatically via winget now? [y/N]"
    if ($answer -match '^[Yy]') {
        if (Test-CommandExists "winget") {
            # --source winget avoids routing through the msstore source,
            # which can fail with region/agreement errors on some machines.
            winget install -e --id Docker.DockerDesktop --source winget
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "winget was unable to install Docker Desktop (exit code $LASTEXITCODE)." -ForegroundColor Red
                Write-Host "Please install it manually from https://www.docker.com/products/docker-desktop/"
                Read-Host "Press Enter to exit"
                exit 1
            }
            Write-Host ""
            Write-Host "Docker Desktop was installed. Please LAUNCH Docker Desktop now, wait for it to" -ForegroundColor Yellow
            Write-Host "finish starting (whale icon steady in the system tray), then re-run this script." -ForegroundColor Yellow
            Read-Host "Press Enter to exit"
            exit 1
        } else {
            Write-Host "winget is not available on this machine." -ForegroundColor Red
            Write-Host "Please install Docker Desktop manually from https://www.docker.com/products/docker-desktop/"
            Read-Host "Press Enter to exit"
            exit 1
        }
    } else {
        Write-Host "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/ and re-run this script."
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# --- Docker Compose plugin check ---
docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "The 'docker compose' command isn't working. Make sure Docker Desktop is installed" -ForegroundColor Red
    Write-Host "and running, then re-run this script."
    Read-Host "Press Enter to exit"
    exit 1
}

# --- Is Docker Desktop actually running? ---
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker Desktop doesn't seem to be running yet." -ForegroundColor Red
    Write-Host "Please start Docker Desktop from the Start menu, wait for the whale icon in the"
    Write-Host "system tray to stop animating (fully started), then re-run this script."
    Read-Host "Press Enter to exit"
    exit 1
}

function New-HexKey([int]$byteLength) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buffer = New-Object byte[] $byteLength
    $rng.GetBytes($buffer)
    -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

if (-not (Test-Path ".env")) {
    Write-Host "Generating .env with fresh secrets..."

    $appSecretKey = New-HexKey 16
    $guacCryptKey = New-HexKey 16
    $sessionSecret = New-HexKey 32

    $envContent = @"
# Port the web UI will be exposed on (host side)
APP_PORT=8080

# 32-character secret keys / session secret, auto-generated.
APP_SECRET_KEY=$appSecretKey
GUAC_CRYPT_KEY=$guacCryptKey
SESSION_SECRET=$sessionSecret
"@

    # Set-Content's "utf8NoBOM" encoding name only exists in PowerShell 7+;
    # Windows PowerShell 5.1 doesn't recognize it. Writing the file directly
    # with .NET's UTF8Encoding(false) works identically on both.
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), $envContent, $utf8NoBom)
} else {
    Write-Host ".env already exists - leaving it untouched. Delete it if you want to regenerate secrets."
}

New-Item -ItemType Directory -Force -Path "data" | Out-Null

if (-not (Test-Path "docker-compose.yml")) {
    Write-Host "Generating docker-compose.yml from the template..."
    Copy-Item "docker-compose.yml.example" "docker-compose.yml"
} else {
    Write-Host "docker-compose.yml already exists - leaving it untouched (edit it directly for local customizations, e.g. reverse proxy labels)."
}

Write-Host ""
Write-Host "Building and starting containers (this pulls guacd and builds the webapp image)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "docker compose failed - see the error above." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$envLines = Get-Content ".env"
$portLine = $envLines | Where-Object { $_ -match '^APP_PORT=' }
$port = if ($portLine) { $portLine -replace '^APP_PORT=', '' } else { "8080" }

Write-Host ""
Write-Host "== Setup complete ==" -ForegroundColor Green
Write-Host "Open: https://localhost:$port"
Write-Host "(Your browser will show a security warning the first time - this is expected, since it's a self-signed certificate. Click through/accept it.)"
Write-Host "Register an account on first visit to get started."
Read-Host "Press Enter to close this window"
