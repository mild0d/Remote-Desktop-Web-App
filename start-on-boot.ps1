# Waits for Docker Desktop to finish starting, then brings up the RDP
# web app. Safe to run even if the containers are already up (docker
# compose up -d is idempotent - it won't recreate anything unnecessarily).

$ErrorActionPreference = "Continue"

# Adjust this if you extracted the project to a different location.
$ProjectPath = "$PSScriptRoot"

Set-Location -Path $ProjectPath

$maxWaitSeconds = 180
$waited = 0
$dockerReady = $false

Write-Output "Waiting for Docker Desktop to be ready..."

while ($waited -lt $maxWaitSeconds) {
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $dockerReady = $true
        break
    }
    Start-Sleep -Seconds 5
    $waited += 5
}

if (-not $dockerReady) {
    Write-Output "Docker Desktop did not become ready within $maxWaitSeconds seconds. Giving up."
    exit 1
}

Write-Output "Docker is ready. Starting containers..."
docker compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Output "RDP web app started successfully."
} else {
    Write-Output "docker compose up failed - check the containers manually."
}
