# ─────────────────────────────────────────────────────────────────────────────
# Truecaller Dev Launcher
# Runs Docker (if not running), NestJS backend, and Expo mobile in dev mode.
# Also uninstalls any existing release APK and installs the fresh dev build.
# ─────────────────────────────────────────────────────────────────────────────

# Use Continue so native tool warnings don't abort the script
$ErrorActionPreference = "Continue"

$Root       = Split-Path $PSScriptRoot -Parent
$Backend    = Join-Path $Root "truecaller-backend"
$Mobile     = Join-Path $Root "truecaller-clone"
$AndroidDir = Join-Path $Mobile "android"

$API_BASE_URL = "https://vq52dn7g-3000.inc1.devtunnels.ms/api"

# Helper: run a native command and return its exit code without letting
# PowerShell's error stream interfere.
function Invoke-Native {
    param([string]$Cmd, [string[]]$Args)
    $output = & $Cmd @Args 2>&1
    return $LASTEXITCODE
}

# ── 1. Ensure Docker Desktop is running ──────────────────────────────────────
Write-Host "`n[1/5] Checking Docker..." -ForegroundColor Cyan

$dockerCode = Invoke-Native "docker" @("info")
$dockerRunning = ($dockerCode -eq 0)

if ($dockerRunning) {
    Write-Host "      Docker is already running." -ForegroundColor Green
} else {
    Write-Host "      Docker is not running. Starting Docker Desktop..." -ForegroundColor Yellow

    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
    } else {
        Write-Host "      Docker Desktop not found at default path. Please start it manually." -ForegroundColor Red
        exit 1
    }

    Write-Host "      Waiting for Docker to become ready (up to 120 s)..." -ForegroundColor Yellow
    $timeout = 120
    $elapsed = 0
    while ($elapsed -lt $timeout) {
        Start-Sleep -Seconds 5
        $elapsed += 5
        $code = Invoke-Native "docker" @("info")
        if ($code -eq 0) {
            $dockerRunning = $true
            Write-Host "      Docker is ready." -ForegroundColor Green
            break
        }
    }

    if (-not $dockerRunning) {
        Write-Host "Docker did not start within $timeout seconds. Aborting." -ForegroundColor Red
        exit 1
    }
}

# ── 2. Start backend Docker services ─────────────────────────────────────────
Write-Host "`n[2/5] Starting backend Docker services (docker compose up -d)..." -ForegroundColor Cyan
Push-Location $Backend
& docker compose up -d
Pop-Location
Write-Host "      Docker services are up." -ForegroundColor Green

# ── 3. Start NestJS backend in dev mode ──────────────────────────────────────
Write-Host "`n[3/5] Starting NestJS backend (start:dev)..." -ForegroundColor Cyan
$backendJob = Start-Process -FilePath "pwsh" `
    -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-Command", "Set-Location '$Backend'; pnpm run start:dev"
    ) `
    -PassThru -NoNewWindow
Write-Host "      Backend PID: $($backendJob.Id)" -ForegroundColor Green

# ── 4. Uninstall release APK, build & install dev APK ────────────────────────
Write-Host "`n[4/5] Preparing Android dev build..." -ForegroundColor Cyan

$packageName = "com.sheryians.truecallerclone"
Write-Host "      Uninstalling release build ($packageName) if present..." -ForegroundColor Yellow
$uninstallOut = & adb uninstall $packageName 2>&1
Write-Host "      adb uninstall: $uninstallOut" -ForegroundColor DarkGray

Write-Host "      Building debug APK (this may take a while)..." -ForegroundColor Yellow
Push-Location $AndroidDir
& ".\gradlew.bat" assembleDebug
$gradleCode = $LASTEXITCODE
Pop-Location

if ($gradleCode -ne 0) {
    Write-Host "      Gradle assembleDebug failed (exit $gradleCode). Aborting." -ForegroundColor Red
    exit $gradleCode
}

$debugApk = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
Write-Host "      Installing debug APK: $debugApk" -ForegroundColor Yellow
& adb install -r $debugApk
Write-Host "      APK installed." -ForegroundColor Green

# ── 5. Start Expo in dev mode with API_BASE_URL injected ─────────────────────
Write-Host "`n[5/5] Starting Expo dev client (API_BASE_URL=$API_BASE_URL)..." -ForegroundColor Cyan
$mobileCmd = "Set-Location '$Mobile'; `$env:API_BASE_URL='$API_BASE_URL'; `$env:EXPO_PUBLIC_API_BASE_URL='$API_BASE_URL'; pnpm run android"
$mobileJob = Start-Process -FilePath "pwsh" `
    -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-Command", $mobileCmd
    ) `
    -PassThru -NoNewWindow
Write-Host "      Mobile PID: $($mobileJob.Id)" -ForegroundColor Green

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host "`n─────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host " All services started in development mode." -ForegroundColor Green
Write-Host "  Backend  PID : $($backendJob.Id)" -ForegroundColor White
Write-Host "  Mobile   PID : $($mobileJob.Id)" -ForegroundColor White
Write-Host "  API URL      : $API_BASE_URL" -ForegroundColor White
Write-Host "─────────────────────────────────────────────────`n" -ForegroundColor DarkGray

Write-Host "Waiting for backend and mobile processes... (Ctrl+C to exit)" -ForegroundColor DarkYellow
Wait-Process -Id $backendJob.Id
Wait-Process -Id $mobileJob.Id
