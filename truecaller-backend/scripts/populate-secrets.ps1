# Truecaller Backend - Secrets Populator Script (PowerShell)
# This script helps populate AWS Secrets Manager with required values

$ErrorActionPreference = "Stop"

# Functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Check if AWS CLI is installed
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI not found. Please install it first."
    exit 1
}

Write-Host "================================================" -ForegroundColor Green
Write-Host "   Truecaller Backend - Secrets Setup         " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# Get AWS region from Terraform output or use default
if (Test-Path "terraform\terraform.tfvars") {
    $AWS_REGION = (Get-Content "terraform\terraform.tfvars" | Select-String 'aws_region\s*=\s*"([^"]+)"').Matches.Groups[1].Value
    if (-not $AWS_REGION) {
        $AWS_REGION = "eu-central-1"
    }
}
else {
    $AWS_REGION = "eu-central-1"
}

Write-Info "Using AWS Region: $AWS_REGION"
Write-Host ""

# Define secret names
$SECRET_DATABASE = "truecaller/database-url"
$SECRET_REDIS = "truecaller/redis-url"
$SECRET_JWT = "truecaller/jwt-secret"
$SECRET_FIREBASE = "truecaller/firebase-credentials"

# Function to check if secret exists and has value
function Test-SecretExists {
    param([string]$SecretName)
    
    try {
        aws secretsmanager describe-secret --secret-id $SecretName --region $AWS_REGION 2>$null | Out-Null
        try {
            aws secretsmanager get-secret-value --secret-id $SecretName --region $AWS_REGION 2>$null | Out-Null
            return "exists_with_value"
        }
        catch {
            return "exists_no_value"
        }
    }
    catch {
        return "not_exists"
    }
}

# Function to update secret
function Update-Secret {
    param(
        [string]$SecretName,
        [string]$SecretValue
    )
    
    try {
        aws secretsmanager put-secret-value `
            --secret-id $SecretName `
            --secret-string $SecretValue `
            --region $AWS_REGION 2>$null | Out-Null
        Write-Success "Updated: $SecretName"
        return $true
    }
    catch {
        Write-Error "Failed to update: $SecretName"
        return $false
    }
}

# Function to generate random JWT secret
function New-JwtSecret {
    $bytes = New-Object byte[] 64
    [Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

# 1. Database URL
Write-Host "------------------------------------------------" -ForegroundColor Blue
Write-Host "1. Database URL (PostgreSQL - Neon)"
Write-Host "------------------------------------------------" -ForegroundColor Blue

$status = Test-SecretExists $SECRET_DATABASE
if ($status -eq "exists_with_value") {
    Write-Info "Secret already has a value"
    $response = Read-Host "Do you want to update it? (yes/no)"
    if ($response -ne "yes") {
        Write-Info "Skipping database URL"
    }
    else {
        Write-Host ""
        Write-Host "Enter your Neon PostgreSQL connection URL:"
        Write-Host "Format: postgresql://user:password@ep-xxx.region.aws.neon.tech:5432/dbname?sslmode=require"
        $DATABASE_URL = Read-Host "Database URL" -AsSecureString
        $DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($DATABASE_URL))
        if ($DATABASE_URL) {
            Update-Secret $SECRET_DATABASE $DATABASE_URL
        }
    }
}
else {
    Write-Host ""
    Write-Host "Enter your Neon PostgreSQL connection URL:"
    Write-Host "Format: postgresql://user:password@ep-xxx.region.aws.neon.tech:5432/dbname?sslmode=require"
    $DATABASE_URL = Read-Host "Database URL" -AsSecureString
    $DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($DATABASE_URL))
    if ($DATABASE_URL) {
        Update-Secret $SECRET_DATABASE $DATABASE_URL
    }
    else {
        Write-Warning "Skipped: Database URL"
    }
}
Write-Host ""

# 2. Redis URL
Write-Host "------------------------------------------------" -ForegroundColor Blue
Write-Host "2. Redis URL (Aiven or other provider)"
Write-Host "------------------------------------------------" -ForegroundColor Blue

$status = Test-SecretExists $SECRET_REDIS
if ($status -eq "exists_with_value") {
    Write-Info "Secret already has a value"
    $response = Read-Host "Do you want to update it? (yes/no)"
    if ($response -ne "yes") {
        Write-Info "Skipping Redis URL"
    }
    else {
        Write-Host ""
        Write-Host "Enter your Redis connection URL:"
        Write-Host "Format: rediss://default:password@redis-xxx.aivencloud.com:12345"
        $REDIS_URL = Read-Host "Redis URL" -AsSecureString
        $REDIS_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($REDIS_URL))
        if ($REDIS_URL) {
            Update-Secret $SECRET_REDIS $REDIS_URL
        }
    }
}
else {
    Write-Host ""
    Write-Host "Enter your Redis connection URL:"
    Write-Host "Format: rediss://default:password@redis-xxx.aivencloud.com:12345"
    $REDIS_URL = Read-Host "Redis URL" -AsSecureString
    $REDIS_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($REDIS_URL))
    if ($REDIS_URL) {
        Update-Secret $SECRET_REDIS $REDIS_URL
    }
    else {
        Write-Warning "Skipped: Redis URL"
    }
}
Write-Host ""

# 3. JWT Secret
Write-Host "------------------------------------------------" -ForegroundColor Blue
Write-Host "3. JWT Secret"
Write-Host "------------------------------------------------" -ForegroundColor Blue

$status = Test-SecretExists $SECRET_JWT
if ($status -eq "exists_with_value") {
    Write-Info "Secret already has a value"
    $response = Read-Host "Do you want to regenerate it? (yes/no)"
    if ($response -ne "yes") {
        Write-Info "Skipping JWT secret"
    }
    else {
        Write-Warning "WARNING: Changing JWT secret will invalidate all existing tokens!"
        $JWT_SECRET = New-JwtSecret
        Update-Secret $SECRET_JWT $JWT_SECRET
    }
}
else {
    Write-Info "Generating random JWT secret..."
    $JWT_SECRET = New-JwtSecret
    Update-Secret $SECRET_JWT $JWT_SECRET
}
Write-Host ""

# 4. Firebase Service Account
Write-Host "------------------------------------------------" -ForegroundColor Blue
Write-Host "4. Firebase Service Account JSON"
Write-Host "------------------------------------------------" -ForegroundColor Blue

$status = Test-SecretExists $SECRET_FIREBASE
if ($status -eq "exists_with_value") {
    Write-Info "Secret already has a value"
    $response = Read-Host "Do you want to update it? (yes/no)"
    if ($response -ne "yes") {
        Write-Info "Skipping Firebase credentials"
    }
    else {
        Write-Host ""
        $DEFAULT_PATH = ".\firebase-service-account.json"
        $FIREBASE_PATH = Read-Host "Enter path to firebase-service-account.json [$DEFAULT_PATH]"
        if (-not $FIREBASE_PATH) {
            $FIREBASE_PATH = $DEFAULT_PATH
        }
        
        if (Test-Path $FIREBASE_PATH) {
            $FIREBASE_JSON = Get-Content $FIREBASE_PATH -Raw
            Update-Secret $SECRET_FIREBASE $FIREBASE_JSON
        }
        else {
            Write-Error "File not found: $FIREBASE_PATH"
        }
    }
}
else {
    Write-Host ""
    $DEFAULT_PATH = ".\firebase-service-account.json"
    $FIREBASE_PATH = Read-Host "Enter path to firebase-service-account.json [$DEFAULT_PATH]"
    if (-not $FIREBASE_PATH) {
        $FIREBASE_PATH = $DEFAULT_PATH
    }
    
    if (Test-Path $FIREBASE_PATH) {
        Write-Info "Reading Firebase credentials from: $FIREBASE_PATH"
        $FIREBASE_JSON = Get-Content $FIREBASE_PATH -Raw
        Update-Secret $SECRET_FIREBASE $FIREBASE_JSON
    }
    else {
        Write-Error "File not found: $FIREBASE_PATH"
        Write-Warning "Skipped: Firebase credentials"
    }
}
Write-Host ""

# Summary
Write-Host "================================================" -ForegroundColor Green
Write-Host "          Secrets Setup Complete!              " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Info "Verifying secrets..."
Write-Host ""

# Verify all secrets
$ALL_SET = $true

foreach ($SECRET in @($SECRET_DATABASE, $SECRET_REDIS, $SECRET_JWT, $SECRET_FIREBASE)) {
    try {
        aws secretsmanager get-secret-value --secret-id $SECRET --region $AWS_REGION 2>$null | Out-Null
        Write-Success $SECRET
    }
    catch {
        Write-Error "$SECRET (NOT SET)"
        $ALL_SET = $false
    }
}

Write-Host ""
if ($ALL_SET) {
    Write-Success "All secrets are configured!"
    Write-Host ""
    Write-Info "You can now proceed with deployment:"
    Write-Host "  .\scripts\deploy.ps1"
}
else {
    Write-Warning "Some secrets are missing. Please configure them before deployment."
}
Write-Host ""
