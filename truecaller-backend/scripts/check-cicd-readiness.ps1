# CI/CD Readiness Check Script (PowerShell)
# Verifies that all prerequisites are met for GitHub Actions deployment

$ErrorActionPreference = "Continue"

$script:ERRORS = 0
$script:WARNINGS = 0

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
    $script:WARNINGS++
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    $script:ERRORS++
}

function Test-Command {
    param([string]$Command)
    
    if (Get-Command $Command -ErrorAction SilentlyContinue) {
        Write-Success "$Command is installed"
        return $true
    }
    else {
        Write-Error "$Command is not installed"
        return $false
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "     CI/CD Readiness Check                    " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# 1. Check required commands
Write-Info "Checking required tools..."
Test-Command "aws"
Test-Command "terraform"
Test-Command "docker"
Test-Command "git"
Write-Host ""

# 2. Check AWS credentials
Write-Info "Checking AWS credentials..."
try {
    $accountId = aws sts get-caller-identity --query Account --output text 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "AWS credentials configured (Account: $accountId)"
    }
    else {
        Write-Error "AWS credentials not configured or invalid"
        Write-Info "Run: aws configure"
    }
}
catch {
    Write-Error "AWS credentials not configured or invalid"
    Write-Info "Run: aws configure"
}
Write-Host ""

# 3. Check Terraform state
Write-Info "Checking Terraform infrastructure..."
if (Test-Path "terraform") {
    Push-Location terraform
    
    if (Test-Path "terraform.tfstate") {
        Write-Success "Terraform state exists"
        
        # Check key outputs
        $ecrUrl = terraform output -raw ecr_repository_url 2>$null
        if ($LASTEXITCODE -eq 0 -and $ecrUrl) {
            Write-Success "ECR repository configured"
        }
        else {
            Write-Error "ECR repository not found in Terraform state"
        }
        
        $ollamaDns = terraform output -raw ollama_alb_dns_name 2>$null
        if ($LASTEXITCODE -eq 0 -and $ollamaDns) {
            Write-Success "Ollama service configured (DNS: $ollamaDns)"
        }
        else {
            Write-Error "Ollama service not found in Terraform state"
            Write-Info "Ollama must be deployed before backend CI/CD can work"
        }
        
        $clusterName = terraform output -raw ecs_cluster_name 2>$null
        if ($LASTEXITCODE -eq 0 -and $clusterName) {
            Write-Success "ECS cluster configured"
        }
        else {
            Write-Error "ECS cluster not found in Terraform state"
        }
    }
    else {
        Write-Error "Terraform state not found"
        Write-Info "Run: cd terraform && terraform init && terraform apply"
    }
    
    Pop-Location
}
else {
    Write-Error "Terraform directory not found"
}
Write-Host ""

# 4. Check secrets in AWS
Write-Info "Checking AWS Secrets Manager..."
$secrets = @(
    "truecaller/database-url",
    "truecaller/redis-url",
    "truecaller/jwt-secret",
    "truecaller/firebase-credentials"
)

foreach ($secret in $secrets) {
    try {
        aws secretsmanager describe-secret --secret-id $secret 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            # Check if secret has a value
            aws secretsmanager get-secret-value --secret-id $secret 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Secret '$secret' exists and has a value"
            }
            else {
                Write-Warning "Secret '$secret' exists but has no value"
                Write-Info "Run: .\scripts\populate-secrets.ps1"
            }
        }
        else {
            Write-Error "Secret '$secret' not found"
            Write-Info "Run: cd terraform && terraform apply (creates empty secrets)"
        }
    }
    catch {
        Write-Error "Secret '$secret' not found"
    }
}
Write-Host ""

# 5. Check Docker daemon
Write-Info "Checking Docker..."
try {
    docker info 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker daemon is running"
    }
    else {
        Write-Error "Docker daemon is not running"
        Write-Info "Start Docker Desktop"
    }
}
catch {
    Write-Error "Docker daemon is not running"
    Write-Info "Start Docker Desktop"
}
Write-Host ""

# 6. Check GitHub repository
Write-Info "Checking Git repository..."
if (Test-Path ".git") {
    Write-Success "Git repository initialized"
    
    # Check remote
    $remote = git remote get-url origin 2>$null
    if ($remote -and $remote -match "github.com") {
        Write-Success "GitHub remote configured: $remote"
    }
    else {
        Write-Warning "No GitHub remote found"
        Write-Info "Add remote: git remote add origin <your-repo-url>"
    }
    
    # Check branch
    $branch = git rev-parse --abbrev-ref HEAD 2>$null
    Write-Info "Current branch: $branch"
}
else {
    Write-Error "Not a Git repository"
}
Write-Host ""

# 7. Check workflow files
Write-Info "Checking GitHub Actions workflows..."
if (Test-Path ".github\workflows\deploy.yml") {
    Write-Success "Deploy workflow exists"
}
else {
    Write-Error "Deploy workflow not found"
}

if (Test-Path ".github\workflows\pr-check.yml") {
    Write-Success "PR check workflow exists"
}
else {
    Write-Error "PR check workflow not found"
}
Write-Host ""

# 8. Check Node.js and dependencies
Write-Info "Checking Node.js environment..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Success "Node.js installed: $nodeVersion"
    
    if (Test-Path "package.json") {
        Write-Success "package.json exists"
        
        if (Test-Path "node_modules") {
            Write-Success "Dependencies installed"
        }
        else {
            Write-Warning "Dependencies not installed"
            Write-Info "Run: npm install"
        }
    }
}
else {
    Write-Error "Node.js not installed"
}
Write-Host ""

# 9. Check Prisma
Write-Info "Checking Prisma..."
if (Test-Path "prisma\schema.prisma") {
    Write-Success "Prisma schema exists"
    
    if (Test-Path "node_modules\.prisma") {
        Write-Success "Prisma client generated"
    }
    else {
        Write-Warning "Prisma client not generated"
        Write-Info "Run: npx prisma generate"
    }
}
else {
    Write-Error "Prisma schema not found"
}
Write-Host ""

# Summary
Write-Host "================================================" -ForegroundColor Green
Write-Host "           Readiness Summary                  " -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

if ($script:ERRORS -eq 0 -and $script:WARNINGS -eq 0) {
    Write-Success "All checks passed! Ready for CI/CD deployment"
    Write-Host ""
    Write-Info "Next steps:"
    Write-Host "  1. Push code to GitHub: git push origin main"
    Write-Host "  2. Go to GitHub Actions to see deployment"
    Write-Host "  3. Monitor: https://github.com/<your-repo>/actions"
    exit 0
}
elseif ($script:ERRORS -eq 0) {
    Write-Host "⚠ $($script:WARNINGS) warning(s) found" -ForegroundColor Yellow
    Write-Host ""
    Write-Info "You can proceed, but resolve warnings for best results"
    exit 0
}
else {
    Write-Host "✗ $($script:ERRORS) error(s) found" -ForegroundColor Red
    Write-Host "⚠ $($script:WARNINGS) warning(s) found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "[ERROR] Please fix errors before proceeding with CI/CD" -ForegroundColor Red
    exit 1
}
