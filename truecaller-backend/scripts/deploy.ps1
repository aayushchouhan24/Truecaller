# Truecaller Backend - AWS ECS Deployment Script (PowerShell)
# This script automates the deployment process for Windows users

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
    Pop-Location
    return $output
}

# Main deployment
function Start-Deployment {
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "  Truecaller Backend - AWS ECS Deployment     " -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    
    Test-Prerequisites
    
    # Step 1: Initialize Terraform (if needed)
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
    
    # Step 2: Terraform Plan
    Write-Info "Creating Terraform plan..."
    Push-Location terraform
    terraform plan -out deployment.tfplan
    Pop-Location
    Write-Success "Plan created"
    
    # Ask for confirmation
    Write-Host ""
    $response = Read-Host "Do you want to apply this plan? (yes/no)"
    Write-Host ""
    if ($response -ne "yes") {
        Write-Warning "Deployment cancelled"
        exit 0
    }
    
    # Step 3: Apply Terraform
    Write-Info "Applying Terraform configuration..."
    Push-Location terraform
    terraform apply deployment.tfplan
    Remove-Item deployment.tfplan -ErrorAction SilentlyContinue
    Pop-Location
    Write-Success "Infrastructure deployed"
    
    # Get outputs
    $ECR_URL = Get-TerraformOutput "ecr_repository_url"
    $AWS_REGION = Get-TerraformOutput "aws_region"
    $AWS_ACCOUNT = Get-TerraformOutput "aws_account_id"
    $CLUSTER_NAME = Get-TerraformOutput "ecs_cluster_name"
    $SERVICE_NAME = Get-TerraformOutput "ecs_service_name"
    $ALB_DNS = Get-TerraformOutput "alb_dns_name"
    
    Write-Host ""
    Write-Info "Deployment Summary:"
    Write-Host "  ECR Repository: $ECR_URL"
    Write-Host "  ECS Cluster: $CLUSTER_NAME"
    Write-Host "  ECS Service: $SERVICE_NAME"
    Write-Host "  ALB DNS: $ALB_DNS"
    Write-Host ""
    
    # Step 4: Check database migrations
    Write-Warning "IMPORTANT: Ensure database schema is set up!"
    Write-Info "For first deployment, run: npx prisma migrate deploy"
    Write-Info "For existing database, ensure schema matches prisma/schema.prisma"
    Write-Host ""
    $response = Read-Host "Is database schema ready? (yes/no)"
    Write-Host ""
    if ($response -ne "yes") {
        Write-Warning "Please set up database schema before continuing"
        exit 0
    }
    
    # Step 5: Check if secrets are populated
    Write-Warning "IMPORTANT: Ensure all secrets are populated in AWS Secrets Manager!"
    Write-Info "Run '.\scripts\populate-secrets.ps1' if you haven't already"
    Write-Host ""
    $response = Read-Host "Have you populated all secrets? (yes/no)"
    Write-Host ""
    if ($response -ne "yes") {
        Write-Warning "Please populate secrets before continuing"
        Write-Info "See README.md for instructions"
        exit 0
    }
    
    # Step 6: Build Docker image
    Write-Info "Building Docker image..."
    docker build -t truecaller-backend:latest .
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker build failed"
        exit 1
    }
    Write-Success "Docker image built"
    
    # Step 7: Verify ECR repository exists (should be created by Terraform)
    Write-Info "Verifying ECR repository..."
    $ecrCheck = aws ecr describe-repositories --repository-names truecaller-backend --region $AWS_REGION 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ECR repository not found. Terraform may have failed to create it."
        Write-Info "Run: cd terraform && terraform apply"
        exit 1
    }
    Write-Success "ECR repository verified"
    
    # Step 8: Login to ECR
    Write-Info "Logging into Amazon ECR..."
    Write-Host "  Command: aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com" -ForegroundColor DarkGray
    
    # Use cmd.exe for proper pipe handling in PowerShell
    cmd /c "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ECR login failed."
        Write-Info "Troubleshooting:"
        Write-Host "  1. Verify AWS credentials: aws sts get-caller-identity"
        Write-Host "  2. Check ECR permissions: aws ecr describe-repositories --region $AWS_REGION"
        Write-Host "  3. Ensure Docker is running: docker info"
        exit 1
    }
    Write-Success "Logged into ECR"
    
    # Step 9: Tag and push image
    Write-Info "Tagging image..."
    docker tag truecaller-backend:latest "${ECR_URL}:latest"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to tag image"
        exit 1
    }
    
    Write-Info "Pushing image to ECR (this may take a few minutes)..."
    docker push "${ECR_URL}:latest"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push image to ECR"
        exit 1
    }
    Write-Success "Image pushed to ECR"
    
    # Step 10: Force new deployment
    Write-Info "Triggering ECS service deployment..."
    aws ecs update-service `
        --cluster $CLUSTER_NAME `
        --service $SERVICE_NAME `
        --force-new-deployment `
        --region $AWS_REGION | Out-Null
    Write-Success "Deployment triggered"
    
    # Final message
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "          Deployment Completed!                " -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    Write-Info "Your application will be available at:"
    Write-Host "  http://$ALB_DNS/api" -ForegroundColor Blue
    Write-Host ""
    Write-Info "Monitor deployment progress:"
    Write-Host "  aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION"
    Write-Host ""
    Write-Info "View logs:"
    Write-Host "  aws logs tail /ecs/truecaller-backend --follow --region $AWS_REGION"
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
