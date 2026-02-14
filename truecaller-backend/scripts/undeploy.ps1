# Truecaller Backend - AWS ECS Undeploy Script (PowerShell)
# This script safely destroys all AWS infrastructure created by Terraform

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
    
    if (-not (Test-Path "terraform\.terraform")) {
        Write-Error "Terraform not initialized. Run 'terraform init' first."
        exit 1
    }
    
    Write-Success "Prerequisites check passed"
}

# Get Terraform output
function Get-TerraformOutput {
    param([string]$OutputName)
    Push-Location terraform
    $output = terraform output -raw $OutputName 2>$null
    Pop-Location
    return $output
}

# Show what will be destroyed
function Show-DestructionPlan {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host "  RESOURCES TO BE DESTROYED" -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host ""
    
    $AWS_REGION = Get-TerraformOutput "aws_region"
    $CLUSTER_NAME = Get-TerraformOutput "ecs_cluster_name"
    $SERVICE_NAME = Get-TerraformOutput "ecs_service_name"
    $ECR_URL = Get-TerraformOutput "ecr_repository_url"
    $ALB_DNS = Get-TerraformOutput "alb_dns_name"
    
    Write-Host "Region: $AWS_REGION"
    Write-Host "ECS Cluster: $CLUSTER_NAME"
    Write-Host "ECS Service: $SERVICE_NAME"
    Write-Host "ECR Repository: $ECR_URL"
    Write-Host "ALB: $ALB_DNS"
    Write-Host ""
    Write-Host "Total Resources to Destroy: ~35" -ForegroundColor Yellow
    Write-Host ""
    Write-Warning "This will destroy:"
    Write-Host "  - ECS Service & Tasks"
    Write-Host "  - ECS Cluster"
    Write-Host "  - Application Load Balancer"
    Write-Host "  - ECR Repository (and all images)"
    Write-Host "  - VPC, Subnets, NAT Gateway"
    Write-Host "  - Security Groups"
    Write-Host "  - IAM Roles & Policies"
    Write-Host "  - CloudWatch Log Groups"
    Write-Host "  - Secrets Manager Secrets (marked for deletion)"
    Write-Host ""
    Write-Success "What will NOT be affected:"
    Write-Host "  + Neon PostgreSQL database (external)"
    Write-Host "  + Aiven Redis (external)"
    Write-Host "  + Your source code"
    Write-Host ""
}

# Check for running tasks
function Test-RunningTasks {
    $AWS_REGION = Get-TerraformOutput "aws_region"
    $CLUSTER_NAME = Get-TerraformOutput "ecs_cluster_name"
    
    if ($CLUSTER_NAME) {
        Write-Info "Checking for running ECS tasks..."
        $tasks = aws ecs list-tasks --cluster $CLUSTER_NAME --region $AWS_REGION --query 'taskArns' --output json 2>$null | ConvertFrom-Json
        
        if ($tasks.Count -gt 0) {
            Write-Warning "Found $($tasks.Count) running task(s) in cluster"
            Write-Info "These will be stopped during destruction"
        } else {
            Write-Info "No running tasks found"
        }
    }
}

# Main undeploy function
function Start-Undeploy {
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host "  Truecaller Backend - UNDEPLOY SCRIPT  " -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host ""
    
    Test-Prerequisites
    
    # Show what will be destroyed
    Show-DestructionPlan
    
    # Check for running tasks
    Test-RunningTasks
    
    # Final confirmation
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host "  WARNING: THIS CANNOT BE UNDONE!" -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Red
    Write-Host ""
    Write-Warning "All infrastructure will be permanently deleted"
    Write-Warning "CloudWatch logs will be lost"
    Write-Warning "ECR images will be deleted"
    Write-Host ""
    
    $confirmation = Read-Host "Type 'DESTROY' (in caps) to confirm destruction"
    Write-Host ""
    
    if ($confirmation -ne "DESTROY") {
        Write-Info "Destruction cancelled - confirmation not received"
        exit 0
    }
    
    # Second confirmation
    $response = Read-Host "Are you absolutely sure? This will cost ~`$60/month if recreated (yes/no)"
    Write-Host ""
    
    if ($response -ne "yes") {
        Write-Info "Destruction cancelled"
        exit 0
    }
    
    # Step 1: Clean up ECR repository (force delete with all images)
    Write-Info "Cleaning up ECR repository..."
    $ECR_REPO = "truecaller-backend"
    $AWS_REGION = Get-TerraformOutput "aws_region"
    
    if (-not $AWS_REGION) {
        $AWS_REGION = "eu-central-1"
    }
    
    try {
        Write-Info "Checking if ECR repository exists..."
        $null = aws ecr describe-repositories --repository-name $ECR_REPO --region $AWS_REGION 2>$null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Force deleting ECR repository with all images..."
            aws ecr delete-repository --repository-name $ECR_REPO --region $AWS_REGION --force 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "ECR repository deleted"
            } else {
                Write-Warning "Failed to delete ECR repository (may require manual cleanup)"
            }
        } else {
            Write-Info "ECR repository does not exist or already deleted"
        }
    }
    catch {
        Write-Warning "Could not check/delete ECR repository"
    }
    
    # Step 2: Create destroy plan
    Write-Info "Creating destruction plan..."
    Push-Location terraform
    terraform plan -destroy -out destroy.tfplan
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create destruction plan"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Success "Destruction plan created"
    
    # Step 3: Apply destruction
    Write-Host ""
    Write-Info "Destroying infrastructure (this takes 3-5 minutes)..."
    Write-Host ""
    
    Push-Location terraform
    terraform apply destroy.tfplan
    $destroyExitCode = $LASTEXITCODE
    Remove-Item destroy.tfplan -ErrorAction SilentlyContinue
    Pop-Location
    
    # If destruction failed (likely due to ECR not being empty), complete it
    if ($destroyExitCode -ne 0) {
        Write-Warning "Initial destruction encountered an issue (likely ECR repository not empty)"
        Write-Info "Completing destruction with auto-approve..."
        
        Push-Location terraform
        terraform destroy -auto-approve
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Destruction failed"
            Pop-Location
            exit 1
        }
        Pop-Location
    }
    
    Write-Success "Infrastructure destroyed successfully"
    
    # Step 3.5: Force cleanup any remaining resources
    Write-Host ""
    Write-Info "Checking for any remaining AWS resources..."
    $AWS_REGION = "eu-central-1"
    
    # Clean up Load Balancers
    Write-Info "Checking for leftover load balancers..."
    try {
        $albs = aws elbv2 describe-load-balancers --region $AWS_REGION --query "LoadBalancers[?starts_with(LoadBalancerName, 'truecaller-backend')].LoadBalancerArn" --output text 2>$null
        if ($albs) {
            foreach ($alb in $albs -split "`n") {
                if ($alb.Trim()) {
                    Write-Info "Deleting load balancer: $alb"
                    aws elbv2 delete-load-balancer --load-balancer-arn $alb.Trim() --region $AWS_REGION 2>$null | Out-Null
                    Start-Sleep -Seconds 5  # Wait for ALB to start deleting
                }
            }
        }
    }
    catch {
        Write-Info "No load balancers to clean up"
    }
    
    # Clean up Target Groups
    Write-Info "Checking for leftover target groups..."
    try {
        $tgs = aws elbv2 describe-target-groups --region $AWS_REGION --query "TargetGroups[?starts_with(TargetGroupName, 'truecaller-backend')].TargetGroupArn" --output text 2>$null
        if ($tgs) {
            Start-Sleep -Seconds 10  # Wait for ALB deletion to propagate
            foreach ($tg in $tgs -split "`n") {
                if ($tg.Trim()) {
                    Write-Info "Deleting target group: $tg"
                    aws elbv2 delete-target-group --target-group-arn $tg.Trim() --region $AWS_REGION 2>$null | Out-Null
                }
            }
        }
    }
    catch {
        Write-Info "No target groups to clean up"
    }
    
    # Clean up NAT Gateways
    Write-Info "Checking for leftover NAT gateways..."
    try {
        $natGateways = aws ec2 describe-nat-gateways --region $AWS_REGION --filter "Name=tag:Name,Values=*truecaller-backend*" --query "NatGateways[?State=='available'].NatGatewayId" --output text 2>$null
        if ($natGateways) {
            foreach ($nat in $natGateways -split "`n") {
                if ($nat.Trim()) {
                    Write-Info "Deleting NAT gateway: $nat"
                    aws ec2 delete-nat-gateway --nat-gateway-id $nat.Trim() --region $AWS_REGION 2>$null | Out-Null
                }
            }
            Write-Info "Waiting 30 seconds for NAT gateways to delete..."
            Start-Sleep -Seconds 30
        }
    }
    catch {
        Write-Info "No NAT gateways to clean up"
    }
    
    # Clean up Elastic IPs
    Write-Info "Checking for leftover Elastic IPs..."
    try {
        $eips = aws ec2 describe-addresses --region $AWS_REGION --filters "Name=tag:Name,Values=*truecaller-backend*" --query "Addresses[].AllocationId" --output text 2>$null
        if ($eips) {
            foreach ($eip in $eips -split "`n") {
                if ($eip.Trim()) {
                    Write-Info "Releasing Elastic IP: $eip"
                    aws ec2 release-address --allocation-id $eip.Trim() --region $AWS_REGION 2>$null | Out-Null
                }
            }
        }
    }
    catch {
        Write-Info "No Elastic IPs to clean up"
    }
    
    Write-Success "Resource cleanup completed"
    
    # Step 4: Clean up deployment files
    Write-Info "Cleaning up temporary files..."
    if (Test-Path "terraform\destroy.tfplan") {
        Remove-Item "terraform\destroy.tfplan" -ErrorAction SilentlyContinue
    }
    if (Test-Path "terraform\deployment.tfplan") {
        Remove-Item "terraform\deployment.tfplan" -ErrorAction SilentlyContinue
    }
    
    # Step 5: Check and handle secrets
    Write-Host ""
    Write-Info "Checking secrets status..."
    $AWS_REGION = "eu-central-1"  # Default region
    
    $secrets = @(
        "truecaller/database-url",
        "truecaller/redis-url",
        "truecaller/jwt-secret",
        "truecaller/firebase-credentials"
    )
    
    $secretCount = 0
    foreach ($secret in $secrets) {
        try {
            $null = aws secretsmanager describe-secret --secret-id $secret --region $AWS_REGION 2>$null
            if ($LASTEXITCODE -eq 0) {
                $secretCount++
            }
        }
        catch {
            # Secret doesn't exist or is already deleted
        }
    }
    
    if ($secretCount -gt 0) {
        Write-Info "$secretCount secrets are in 'pending deletion' state (recovery window)"
        Write-Host ""
        $deleteSecrets = Read-Host "Force delete secrets immediately? (yes/no)"
        Write-Host ""
        
        if ($deleteSecrets -eq "yes") {
            Write-Info "Force deleting secrets..."
            
            foreach ($secret in $secrets) {
                try {
                    aws secretsmanager delete-secret `
                        --secret-id $secret `
                        --force-delete-without-recovery `
                        --region $AWS_REGION 2>$null | Out-Null
                        
                    if ($LASTEXITCODE -eq 0) {
                        Write-Success "Deleted: $secret"
                    }
                }
                catch {
                    # Secret already deleted or doesn't exist
                }
            }
        }
        else {
            Write-Info "Secrets will remain in deletion pending state"
            Write-Info "You can recover them or force delete later"
        }
    } else {
        Write-Info "All secrets already deleted"
    }
    
    # Step 6: Final Summary
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "  UNDEPLOY COMPLETED" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host ""
    
    # Verify critical resources are deleted
    Write-Info "Verifying resources are deleted..."
    $verificationFailed = $false
    
    # Check ECR
    try {
        $null = aws ecr describe-repositories --repository-names truecaller-backend --region $AWS_REGION 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Warning "ECR repository still exists!"
            Write-Host "  Manual cleanup: aws ecr delete-repository --repository-name truecaller-backend --region $AWS_REGION --force" -ForegroundColor Yellow
            $verificationFailed = $true
        } else {
            Write-Success "ECR repository deleted"
        }
    }
    catch {
        Write-Success "ECR repository deleted"
    }
    
    # Check ECS Cluster
    $CLUSTER_NAME = "truecaller-backend-cluster"
    try {
        $clusterCheck = aws ecs describe-clusters --clusters $CLUSTER_NAME --region $AWS_REGION --query 'clusters[0].status' --output text 2>$null
        if ($LASTEXITCODE -eq 0 -and $clusterCheck -eq "ACTIVE") {
            Write-Warning "ECS cluster still exists!"
            Write-Host "  Manual cleanup: aws ecs delete-cluster --cluster $CLUSTER_NAME --region $AWS_REGION" -ForegroundColor Yellow
            $verificationFailed = $true
        } else {
            Write-Success "ECS cluster deleted"
        }
    }
    catch {
        Write-Success "ECS cluster deleted"
    }
    
    if ($verificationFailed) {
        Write-Host ""
        Write-Warning "Some resources were not deleted. See above for manual cleanup commands."
    }
    
    Write-Host ""
    Write-Host "[OK] Terraform destroy completed" -ForegroundColor Green
    if ($secretCount -gt 0 -and $deleteSecrets -eq "yes") {
        Write-Host "[OK] Secrets permanently deleted" -ForegroundColor Green
    } elseif ($secretCount -gt 0) {
        Write-Host "[OK] Secrets marked for deletion (30-day recovery)" -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Secrets already deleted" -ForegroundColor Green
    }
    Write-Host "[OK] Monthly savings: ~`$60-65" -ForegroundColor Green
    Write-Host ""
    Write-Host "Safe & Intact:" -ForegroundColor Cyan
    Write-Host "  + Neon PostgreSQL database" -ForegroundColor White
    Write-Host "  + Aiven Redis instance" -ForegroundColor White
    Write-Host "  + Source code & configuration" -ForegroundColor White
    Write-Host ""
    Write-Host "To redeploy later:" -ForegroundColor Cyan
    Write-Host "  1. .\\scripts\\deploy.ps1" -ForegroundColor White
    Write-Host "  2. Ensure secrets are populated when prompted" -ForegroundColor White
    Write-Host ""
}

# Run main function
try {
    Start-Undeploy
}
catch {
    Write-Error "Undeploy failed: $_"
    exit 1
}
