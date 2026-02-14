# Truecaller Backend + Ollama - AWS ECS Deployment Script (PowerShell)
# This script automates the deployment process for both services

param(
    [switch]$BackendOnly,
    [switch]$OllamaOnly,
    [switch]$SkipBuild,
    [switch]$SkipTerraform
)

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

# Check prerequisites
function Test-Prerequisites {
    Write-Info "Checking prerequisites..."
    
    if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
        Write-Error "AWS CLI not found. Please install it first."
        exit 1
    }
    
    if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
        Write-Error "Terraform not found. Please install it first."
        exit 1
    }
    
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error "Docker not found. Please install it first."
        exit 1
    }
    
    Write-Success "All prerequisites found"
}

# Get Terraform output
function Get-TerraformOutput {
    param([string]$OutputName)
    Push-Location terraform
    $output = terraform output -raw $OutputName 2>$null
    $exitCode = $LASTEXITCODE
    Pop-Location
    
    if ($exitCode -ne 0) {
        Write-Warning "Failed to get Terraform output: $OutputName"
        return $null
    }
    return $output
}

# Check if infrastructure already exists
function Test-ExistingInfrastructure {
    Write-Info "Checking for existing infrastructure conflicts..."
    
    Push-Location terraform
    $stateExists = Test-Path "terraform.tfstate"
    Pop-Location
    
    if ($stateExists) {
        Write-Info "Terraform state exists - checking for conflicts..."
        
        # Check for existing VPC subnets
        try {
            $existingSubnets = aws ec2 describe-subnets `
                --filters "Name=cidr-block,Values=10.0.1.0/24,10.0.2.0/24" `
                --query 'Subnets[*].SubnetId' `
                --output text 2>&1
            
            if ($LASTEXITCODE -eq 0 -and $existingSubnets -and $existingSubnets.Trim() -ne "") {
                Write-Warning "Found existing subnets with conflicting CIDR blocks!"
                Write-Host "  Subnet IDs: $existingSubnets" -ForegroundColor Yellow
                return $true
            }
        } catch {
            # Ignore AWS CLI errors
        }
    }
    
    return $false
}

# Build Docker image
function Build-DockerImage {
    param(
        [string]$ImageName,
        [string]$Dockerfile = "Dockerfile",
        [string]$Tag = "latest"
    )
    
    Write-Info "Building Docker image: $ImageName..."
    docker build -t "${ImageName}:${Tag}" -f $Dockerfile .
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker build failed for $ImageName"
        throw "Build failed"
    }
    Write-Success "Docker image built: ${ImageName}:${Tag}"
}

# Tag and push Docker image to ECR
function Push-ToECR {
    param(
        [string]$LocalImage,
        [string]$ECRUrl,
        [string]$Tag = "latest"
    )
    
    Write-Info "Tagging image: ${LocalImage}:${Tag} -> ${ECRUrl}:${Tag}"
    docker tag "${LocalImage}:${Tag}" "${ECRUrl}:${Tag}"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to tag image"
        throw "Tag failed"
    }
    
    Write-Info "Pushing image to ECR: ${ECRUrl}:${Tag}"
    Write-Host "  (This may take several minutes...)" -ForegroundColor DarkGray
    docker push "${ECRUrl}:${Tag}"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push image to ECR"
        throw "Push failed"
    }
    Write-Success "Image pushed to ECR: ${ECRUrl}:${Tag}"
}

# Main deployment
function Start-Deployment {
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "  Truecaller Backend + Ollama - AWS ECS Deployment" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    
    Test-Prerequisites
    
    # Determine deployment mode
    $deployBackend = (-not $OllamaOnly) -or $BackendOnly
    $deployOllama = (-not $BackendOnly) -or $OllamaOnly
    
    if ($BackendOnly) {
        Write-Warning "Deploying BACKEND ONLY (Ollama will be skipped)"
    } elseif ($OllamaOnly) {
        Write-Warning "Deploying OLLAMA ONLY (Backend will be skipped)"
    } else {
        Write-Info "Deploying BOTH Backend and Ollama services"
    }
    
    # Step 1: Terraform Infrastructure
    if (-not $SkipTerraform) {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host "  Step 1: Terraform Infrastructure        " -ForegroundColor Cyan
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host ""
        
        # Check if terraform.tfvars exists
        if (-not (Test-Path "terraform\terraform.tfvars")) {
            Write-Error "terraform.tfvars not found!"
            Write-Host ""
            Write-Info "Create it from the example:"
            Write-Host "  cp terraform/terraform.tfvars.example terraform/terraform.tfvars" -ForegroundColor Cyan
            Write-Host "  notepad terraform/terraform.tfvars" -ForegroundColor Cyan
            Write-Host ""
            throw "Missing terraform.tfvars"
        }
        
        # Check for existing infrastructure conflicts
        $hasConflicts = Test-ExistingInfrastructure
        if ($hasConflicts) {
            Write-Host ""
            Write-Warning "Existing infrastructure detected that may conflict!"
            Write-Host ""
            Write-Info "Options:"
            Write-Host "  1. Run cleanup script: .\scripts\cleanup-terraform.ps1" -ForegroundColor Cyan
            Write-Host "  2. Continue anyway (may fail)" -ForegroundColor Yellow
            Write-Host ""
            $response = Read-Host "Continue anyway? (yes/no)"
            if ($response -ne "yes") {
                Write-Warning "Deployment cancelled. Run cleanup script first."
                exit 0
            }
        }
        
        if (-not (Test-Path "terraform\.terraform")) {
            Write-Info "Initializing Terraform..."
            Push-Location terraform
            terraform init
            Pop-Location
            Write-Success "Terraform initialized"
        }
        else {
            Write-Info "Terraform already initialized"
        }
        
        Write-Info "Creating Terraform plan..."
        Push-Location terraform
        terraform plan -out deployment.tfplan
        $planExitCode = $LASTEXITCODE
        Pop-Location
        
        if ($planExitCode -ne 0) {
            Write-Error "Terraform plan failed"
            Write-Host ""
            Write-Info "Common issues:"
            Write-Host "  1. AWS credentials not configured: aws configure"
            Write-Host "  2. Invalid terraform.tfvars values"
            Write-Host "  3. Required provider plugins not installed"
            throw "Terraform plan failed"
        }
        Write-Success "Plan created"
        
        Write-Host ""
        $response = Read-Host "Apply Terraform changes? (yes/no)"
        Write-Host ""
        if ($response -ne "yes") {
            Write-Warning "Skipping Terraform apply. Ensure infrastructure is up-to-date!"
        } else {
            Write-Info "Applying Terraform configuration..."
            Push-Location terraform
            terraform apply deployment.tfplan 2>&1 | Tee-Object -Variable terraformOutput
            $applyExitCode = $LASTEXITCODE
            Remove-Item deployment.tfplan -ErrorAction SilentlyContinue
            Pop-Location
            
            if ($applyExitCode -ne 0) {
                Write-Error "Terraform apply failed!"
                Write-Host ""
                
                # Check for specific errors
                $outputStr = $terraformOutput -join "`n"
                
                if ($outputStr -match "InvalidSubnet.Conflict|conflicts with another subnet") {
                    Write-Warning "Subnet conflicts detected - Resources already exist!"
                    Write-Host ""
                    Write-Info "Run cleanup script:"
                    Write-Host "  .\scripts\cleanup-terraform.ps1" -ForegroundColor Cyan
                }
                
                if ($outputStr -match "ConflictingDomainExists|has already been associated") {
                    Write-Warning "Service Discovery namespace already exists!"
                    Write-Host ""
                    Write-Info "Run cleanup script:"
                    Write-Host "  .\scripts\cleanup-terraform.ps1" -ForegroundColor Cyan
                }
                
                Write-Host ""
                Write-Error "Cannot proceed without successful Terraform apply"
                throw "Terraform apply failed with exit code $applyExitCode"
            }
            Write-Success "Infrastructure deployed"
        }
    } else {
        Write-Warning "Skipping Terraform (--SkipTerraform)"
    }
    
    # Get infrastructure outputs
    Write-Info "Retrieving infrastructure details..."
    $AWS_REGION = Get-TerraformOutput "aws_region"
    $AWS_ACCOUNT = Get-TerraformOutput "aws_account_id"
    $CLUSTER_NAME = Get-TerraformOutput "ecs_cluster_name"
    $BACKEND_SERVICE_NAME = Get-TerraformOutput "ecs_service_name"
    $OLLAMA_SERVICE_NAME = Get-TerraformOutput "ollama_service_name"
    $BACKEND_ECR_URL = Get-TerraformOutput "ecr_repository_url"
    $OLLAMA_ECR_URL = Get-TerraformOutput "ollama_ecr_repository_url"
    $ALB_DNS = Get-TerraformOutput "alb_dns_name"
    $OLLAMA_URL = Get-TerraformOutput "ollama_service_discovery_url"
    
    # Verify critical outputs exist
    if (-not $AWS_REGION -or -not $AWS_ACCOUNT) {
        Write-Error "Failed to retrieve AWS region or account ID from Terraform outputs"
        Write-Info "This usually means Terraform apply didn't complete successfully"
        Write-Host ""
        Write-Info "Try running:"
        Write-Host "  cd terraform && terraform apply" -ForegroundColor Cyan
        throw "Missing Terraform outputs"
    }
    
    if (-not $CLUSTER_NAME -or -not $BACKEND_ECR_URL) {
        Write-Error "Failed to retrieve required Terraform outputs (cluster, ECR)"
        Write-Info "Infrastructure may not be fully deployed"
        throw "Missing Terraform outputs"
    }
    
    Write-Host ""
    Write-Success "Infrastructure Details:"
    Write-Host "  Region: $AWS_REGION" -ForegroundColor Gray
    Write-Host "  Account: $AWS_ACCOUNT" -ForegroundColor Gray
    Write-Host "  Cluster: $CLUSTER_NAME" -ForegroundColor Gray
    if ($deployBackend) {
        Write-Host "  Backend ECR: $BACKEND_ECR_URL" -ForegroundColor Gray
    }
    if ($deployOllama) {
        Write-Host "  Ollama ECR: $OLLAMA_ECR_URL" -ForegroundColor Gray
        Write-Host "  Ollama Internal URL: $OLLAMA_URL" -ForegroundColor Gray
    }
    Write-Host "  ALB DNS: $ALB_DNS" -ForegroundColor Gray
    Write-Host ""
    
    # Step 2: Pre-Flight Checks
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Step 2: Pre-Flight Checks              " -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Database check
    Write-Warning "IMPORTANT: Ensure database schema is ready!"
    Write-Info "For first deployment: npx prisma migrate deploy"
    Write-Host ""
    $response = Read-Host "Is database schema ready? (yes/no)"
    if ($response -ne "yes") {
        Write-Error "Please set up database schema before continuing"
        exit 1
    }
    
    # Secrets check
    Write-Warning "IMPORTANT: Ensure all secrets are populated!"
    Write-Info "Run '.\scripts\populate-secrets.ps1' if needed"
    Write-Host ""
    $response = Read-Host "Are all secrets populated? (yes/no)"
    if ($response -ne "yes") {
        Write-Error "Please populate secrets before continuing"
        exit 1
    }
    
    # Step 3: ECR Login
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Step 3: Amazon ECR Login              " -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    
    Write-Info "Logging into Amazon ECR..."
    cmd /c "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ECR login failed"
        exit 1
    }
    Write-Success "Logged into ECR"
    
    # Step 4: Build and Push Backend
    if ($deployBackend) {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host "  Step 4: Backend Docker Image          " -ForegroundColor Cyan
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host ""
        
        if (-not $SkipBuild) {
            Build-DockerImage -ImageName "truecaller-backend" -Dockerfile "Dockerfile"
        } else {
            Write-Warning "Skipping build (--SkipBuild), using existing image"
        }
        
        Push-ToECR -LocalImage "truecaller-backend" -ECRUrl $BACKEND_ECR_URL
    } else {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Yellow
        Write-Host "  Step 4: Backend - SKIPPED              " -ForegroundColor Yellow
        Write-Host "============================================" -ForegroundColor Yellow
    }
    
    # Step 5: Build and Push Ollama
    if ($deployOllama) {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host "  Step 5: Ollama Docker Image           " -ForegroundColor Cyan
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host ""
        
        if (-not $SkipBuild) {
            Write-Warning "Building Ollama image (this will take 5-10 minutes to pre-pull model)..."
            Build-DockerImage -ImageName "truecaller-ollama" -Dockerfile "Dockerfile.ollama"
        } else {
            Write-Warning "Skipping build (--SkipBuild), using existing image"
        }
        
        Push-ToECR -LocalImage "truecaller-ollama" -ECRUrl $OLLAMA_ECR_URL
    } else {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Yellow
        Write-Host "  Step 5: Ollama - SKIPPED               " -ForegroundColor Yellow
        Write-Host "============================================" -ForegroundColor Yellow
    }
    
    # Step 6: Deploy to ECS
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Step 6: ECS Service Deployment        " -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    
    if ($deployOllama) {
        Write-Info "Deploying Ollama service first (backend depends on it)..."
        aws ecs update-service `
            --cluster $CLUSTER_NAME `
            --service $OLLAMA_SERVICE_NAME `
            --force-new-deployment `
            --region $AWS_REGION | Out-Null
        Write-Success "Ollama deployment triggered"
    }
    
    if ($deployBackend) {
        Write-Info "Deploying Backend service..."
        aws ecs update-service `
            --cluster $CLUSTER_NAME `
            --service $BACKEND_SERVICE_NAME `
            --force-new-deployment `
            --region $AWS_REGION | Out-Null
        Write-Success "Backend deployment triggered"
    }
    
    Write-Success "All deployments triggered"
    
    # Final Summary
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "          Deployment Complete!                 " -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    
    Write-Success "Services deployed successfully"
    Write-Host ""
    
    if ($deployBackend) {
        Write-Info "Backend API:"
        Write-Host "  http://$ALB_DNS/api" -ForegroundColor Blue
        Write-Host "  Health: http://$ALB_DNS/health" -ForegroundColor Blue
    }
    
    if ($deployOllama) {
        Write-Host ""
        Write-Info "Ollama Service:"
        Write-Host "  Internal URL: $OLLAMA_URL" -ForegroundColor Blue
        Write-Host "  Status: Internal only (not publicly accessible)" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Info "Useful Commands:"
    Write-Host ""
    if ($deployBackend) {
        Write-Host "  # View Backend logs:" -ForegroundColor Gray
        Write-Host "  aws logs tail /ecs/truecaller-backend --follow --region $AWS_REGION" -ForegroundColor Cyan
        Write-Host "" 
    }
    if ($deployOllama) {
        Write-Host "  # View Ollama logs:" -ForegroundColor Gray
        Write-Host "  aws logs tail /ecs/truecaller-ollama --follow --region $AWS_REGION" -ForegroundColor Cyan
        Write-Host ""
    }
    Write-Host "  # Check service status:" -ForegroundColor Gray
    Write-Host "  aws ecs describe-services --cluster $CLUSTER_NAME --services $BACKEND_SERVICE_NAME $OLLAMA_SERVICE_NAME --region $AWS_REGION" -ForegroundColor Cyan
    Write-Host ""
}

# Run main function
try {
    Start-Deployment
}
catch {
    Write-Error "Deployment failed: $_"
    exit 1
}
