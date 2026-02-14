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

# Force cleanup VPC and dependencies
function Invoke-ForceVPCCleanup {
    param(
        [string]$VpcId,
        [string]$Region
    )
    
    if (-not $VpcId -or $VpcId -eq "") {
        Write-Warning "No VPC ID provided, skipping force cleanup"
        return
    }
    
    Write-Info "Force cleaning VPC: $VpcId"
    
    # Delete ENIs (Network Interfaces)
    Write-Info "Checking for ENIs..."
    $enis = aws ec2 describe-network-interfaces --filters "Name=vpc-id,Values=$VpcId" --query 'NetworkInterfaces[*].NetworkInterfaceId' --output text --region $Region 2>$null
    if ($enis -and $enis.Trim() -ne "") {
        Write-Info "Found ENIs, detaching and deleting..."
        foreach ($eni in $enis.Split()) {
            if ($eni.Trim() -ne "") {
                # Detach if attached
                $attachment = aws ec2 describe-network-interfaces --network-interface-ids $eni --query 'NetworkInterfaces[0].Attachment.AttachmentId' --output text --region $Region 2>$null
                if ($attachment -and $attachment -ne "None" -and $attachment.Trim() -ne "") {
                    aws ec2 detach-network-interface --attachment-id $attachment --force --region $Region --no-cli-pager 2>$null | Out-Null
                    Start-Sleep -Seconds 3
                }
                
                # Delete ENI
                aws ec2 delete-network-interface --network-interface-id $eni --region $Region --no-cli-pager 2>$null | Out-Null
            }
        }
        Start-Sleep -Seconds 5
    }
    
    # Delete NAT Gateways
    Write-Info "Checking for NAT Gateways..."
    $natGateways = aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VpcId" --query 'NatGateways[?State!=`deleted`].NatGatewayId' --output text --region $Region 2>$null
    if ($natGateways -and $natGateways.Trim() -ne "") {
        Write-Info "Deleting NAT Gateways..."
        foreach ($nat in $natGateways.Split()) {
            if ($nat.Trim() -ne "") {
                aws ec2 delete-nat-gateway --nat-gateway-id $nat --region $Region --no-cli-pager 2>$null | Out-Null
            }
        }
        Write-Info "Waiting 30 seconds for NAT Gateways..."
        Start-Sleep -Seconds 30
    }
    
    # Delete Load Balancers
    Write-Info "Checking for Load Balancers..."
    $albs = aws elbv2 describe-load-balancers --query "LoadBalancers[?VpcId=='$VpcId'].LoadBalancerArn" --output text --region $Region 2>$null
    if ($albs -and $albs.Trim() -ne "") {
        Write-Info "Deleting Load Balancers..."
        foreach ($alb in $albs.Split()) {
            if ($alb.Trim() -ne "") {
                aws elbv2 delete-load-balancer --load-balancer-arn $alb --region $Region --no-cli-pager 2>$null | Out-Null
            }
        }
        Write-Info "Waiting 45 seconds for Load Balancers..."
        Start-Sleep -Seconds 45
    }
    
    # Delete Internet Gateway
    Write-Info "Checking for Internet Gateways..."
    $igws = aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VpcId" --query 'InternetGateways[*].InternetGatewayId' --output text --region $Region 2>$null
    if ($igws -and $igws.Trim() -ne "") {
        foreach ($igw in $igws.Split()) {
            if ($igw.Trim() -ne "") {
                aws ec2 detach-internet-gateway --internet-gateway-id $igw --vpc-id $VpcId --region $Region --no-cli-pager 2>$null | Out-Null
                aws ec2 delete-internet-gateway --internet-gateway-id $igw --region $Region --no-cli-pager 2>$null | Out-Null
            }
        }
    }
    
    Write-Success "Force cleanup completed"
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
    
    # Step 1: Clean up ECR repositories (force delete with all images)
    Write-Host ""
    Write-Info "Step 1: Cleaning up ECR repositories..."
    
    $AWS_REGION = Get-TerraformOutput "aws_region"
    if (-not $AWS_REGION) {
        $AWS_REGION = "eu-central-1"
    }
    
    # Delete Backend ECR Repository
    $ECR_BACKEND = "truecaller-backend"
    try {
        $null = aws ecr describe-repositories --repository-name $ECR_BACKEND --region $AWS_REGION 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Force deleting Backend ECR repository with all images..."
            aws ecr delete-repository --repository-name $ECR_BACKEND --region $AWS_REGION --force 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Backend ECR repository deleted"
            } else {
                Write-Warning "Failed to delete Backend ECR repository"
            }
        } else {
            Write-Info "Backend ECR repository does not exist"
        }
    } catch {
        Write-Warning "Could not check/delete Backend ECR repository"
    }
    
    # Delete Ollama ECR Repository
    $ECR_OLLAMA = "truecaller-backend-ollama"
    try {
        $null = aws ecr describe-repositories --repository-name $ECR_OLLAMA --region $AWS_REGION 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Force deleting Ollama ECR repository with all images..."
            aws ecr delete-repository --repository-name $ECR_OLLAMA --region $AWS_REGION --force 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Ollama ECR repository deleted"
            } else {
                Write-Warning "Failed to delete Ollama ECR repository"
            }
        } else {
            Write-Info "Ollama ECR repository does not exist"
        }
    } catch {
        Write-Warning "Could not check/delete Ollama ECR repository"
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
    
    # Step 3: Pre-cleanup resources that might block destruction
    Write-Host ""
    Write-Info "Pre-cleaning resources that might block Terraform destroy..."
    
    $AWS_REGION = Get-TerraformOutput "aws_region"
    if (-not $AWS_REGION) {
        $AWS_REGION = "eu-central-1"
    }
    
    # Stop all ECS tasks first
    $CLUSTER_NAME = Get-TerraformOutput "ecs_cluster_name"
    if ($CLUSTER_NAME) {
        Write-Info "Stopping ECS tasks..."
        try {
            $tasksJson = aws ecs list-tasks --cluster $CLUSTER_NAME --region $AWS_REGION --query 'taskArns[*]' --output json 2>$null
            if ($LASTEXITCODE -eq 0 -and $tasksJson) {
                $tasks = $tasksJson | ConvertFrom-Json
                if ($tasks -and $tasks.Count -gt 0) {
                    Write-Info "Found $($tasks.Count) task(s) to stop..."
                    foreach ($task in $tasks) {
                        aws ecs stop-task --cluster $CLUSTER_NAME --task $task --region $AWS_REGION 2>$null | Out-Null
                    }
                    Write-Info "Waiting 20 seconds for tasks to stop..."
                    Start-Sleep -Seconds 20
                } else {
                    Write-Info "No running tasks found"
                }
            }
        } catch {
            Write-Warning "Could not stop ECS tasks (may already be stopped)"
        }
        
        # Scale services to 0
        Write-Info "Scaling services to 0..."
        try {
            $BACKEND_SERVICE = Get-TerraformOutput "ecs_service_name"
            $OLLAMA_SERVICE = Get-TerraformOutput "ollama_service_name"
            
            if ($BACKEND_SERVICE) {
                aws ecs update-service --cluster $CLUSTER_NAME --service $BACKEND_SERVICE --desired-count 0 --region $AWS_REGION 2>$null | Out-Null
            }
            if ($OLLAMA_SERVICE) {
                aws ecs update-service --cluster $CLUSTER_NAME --service $OLLAMA_SERVICE --desired-count 0 --region $AWS_REGION 2>$null | Out-Null
            }
            Start-Sleep -Seconds 10
        } catch {
            Write-Warning "Could not scale services (may already be stopped)"
        }
    } else {
        Write-Info "No ECS cluster found (infrastructure may be partially destroyed)"
    }
    
    # Step 4: Apply destruction with timeout
    Write-Host ""
    Write-Info "Destroying infrastructure (this takes 3-5 minutes)..."
    Write-Host ""
    
    Push-Location terraform
    
    # Start terraform destroy as background job with timeout
    $destroyJob = Start-Job -ScriptBlock {
        param($tfPath)
        Set-Location $tfPath
        terraform apply destroy.tfplan 2>&1
        return $LASTEXITCODE
    } -ArgumentList (Get-Location).Path
    
    # Wait for job with timeout (15 minutes)
    $timeout = 900
    $elapsed = 0
    $checkInterval = 10
    
    Write-Info "Monitoring destruction (timeout: 15 minutes)..."
    while ($destroyJob.State -eq 'Running' -and $elapsed -lt $timeout) {
        Start-Sleep -Seconds $checkInterval
        $elapsed += $checkInterval
        
        if ($elapsed % 60 -eq 0) {
            Write-Host "  Progress: $([int]($elapsed/60)) minute(s) elapsed..." -ForegroundColor Gray
        }
    }
    
    if ($destroyJob.State -eq 'Running') {
        Write-Warning "Terraform destroy timed out after $([int]($timeout/60)) minutes!"
        Write-Info "Stopping terraform process..."
        Stop-Job $destroyJob -PassThru | Remove-Job -Force
        
        # Force cleanup stuck resources
        Write-Warning "Attempting force cleanup of stuck resources..."
        Pop-Location
        
        # Get VPC ID before cleanup
        $VPC_ID = Get-TerraformOutput "vpc_id"
        
        # Call force cleanup function
        Invoke-ForceVPCCleanup -VpcId $VPC_ID -Region $AWS_REGION
        
        Push-Location terraform
        
        # Try destroy again after force cleanup
        Write-Info "Retrying terraform destroy..."
        terraform destroy -auto-approve
        $destroyExitCode = $LASTEXITCODE
    } else {
        # Job completed normally
        $destroyExitCode = Receive-Job $destroyJob
        Remove-Job $destroyJob
    }
    
    Remove-Item destroy.tfplan -ErrorAction SilentlyContinue
    Pop-Location
    
    # If destruction failed, try auto-approve
    if ($destroyExitCode -ne 0) {
        Write-Warning "Initial destruction encountered issues"
        Write-Info "Attempting force destroy..."
        
        Push-Location terraform
        terraform destroy -auto-approve
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Terraform destroy failed. Manual cleanup may be required."
            Pop-Location
            
            # Show manual cleanup instructions
            Write-Host ""
            Write-Warning "Manual cleanup required. Run:"
            Write-Host "  .\scripts\force-cleanup-vpc.ps1" -ForegroundColor Cyan
            exit 1
        }
        Pop-Location
    }
    
    Write-Success "Infrastructure destroyed successfully"
    
    # Step 5: Force cleanup any remaining resources
    Write-Host ""
    Write-Info "Checking for any remaining AWS resources..."
    if (-not $AWS_REGION) {
        $AWS_REGION = "eu-central-1"
    }
    
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
    
    # Step 6: Clean up deployment files
    Write-Info "Cleaning up temporary files..."
    if (Test-Path "terraform\destroy.tfplan") {
        Remove-Item "terraform\destroy.tfplan" -ErrorAction SilentlyContinue
    }
    if (Test-Path "terraform\deployment.tfplan") {
        Remove-Item "terraform\deployment.tfplan" -ErrorAction SilentlyContinue
    }
    
    # Step 7: Check and handle secrets
    Write-Host ""
    Write-Info "Checking secrets status..."
    if (-not $AWS_REGION) {
        $AWS_REGION = "eu-central-1"  # Default region
    }
    
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
    
    # Step 8: Final Summary
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
