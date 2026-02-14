#!/bin/bash

# Truecaller Backend - AWS ECS Undeploy Script
# This script safely destroys all AWS infrastructure created by Terraform

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install it first."
        exit 1
    fi
    
    if ! command -v terraform &> /dev/null; then
        log_error "Terraform not found. Please install it first."
        exit 1
    fi
    
    if [ ! -d "terraform/.terraform" ]; then
        log_error "Terraform not initialized. Run 'terraform init' first."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Get Terraform outputs
get_terraform_output() {
    cd terraform
    terraform output -raw $1 2>/dev/null || echo ""
    cd ..
}

# Show what will be destroyed
show_destruction_plan() {
    echo ""
    echo -e "${RED}==========================================${NC}"
    echo -e "${RED}  RESOURCES TO BE DESTROYED${NC}"
    echo -e "${RED}==========================================${NC}"
    echo ""
    
    AWS_REGION=$(get_terraform_output aws_region)
    CLUSTER_NAME=$(get_terraform_output ecs_cluster_name)
    SERVICE_NAME=$(get_terraform_output ecs_service_name)
    ECR_URL=$(get_terraform_output ecr_repository_url)
    ALB_DNS=$(get_terraform_output alb_dns_name)
    
    echo "Region: $AWS_REGION"
    echo "ECS Cluster: $CLUSTER_NAME"
    echo "ECS Service: $SERVICE_NAME"
    echo "ECR Repository: $ECR_URL"
    echo "ALB: $ALB_DNS"
    echo ""
    echo -e "${YELLOW}Total Resources to Destroy: ~35${NC}"
    echo ""
    log_warning "This will destroy:"
    echo "  - ECS Service & Tasks"
    echo "  - ECS Cluster"
    echo "  - Application Load Balancer"
    echo "  - ECR Repository (and all images)"
    echo "  - VPC, Subnets, NAT Gateway"
    echo "  - Security Groups"
    echo "  - IAM Roles & Policies"
    echo "  - CloudWatch Log Groups"
    echo "  - Secrets Manager Secrets (marked for deletion)"
    echo ""
    log_success "What will NOT be affected:"
    echo "  + Neon PostgreSQL database (external)"
    echo "  + Aiven Redis (external)"
    echo "  + Your source code"
    echo ""
}

# Check for running tasks
check_running_tasks() {
    AWS_REGION=$(get_terraform_output aws_region)
    CLUSTER_NAME=$(get_terraform_output ecs_cluster_name)
    
    if [ -n "$CLUSTER_NAME" ]; then
        log_info "Checking for running ECS tasks..."
        TASK_COUNT=$(aws ecs list-tasks --cluster $CLUSTER_NAME --region $AWS_REGION --query 'length(taskArns)' --output text 2>/dev/null || echo "0")
        
        if [ "$TASK_COUNT" -gt 0 ]; then
            log_warning "Found $TASK_COUNT running task(s) in cluster"
            log_info "These will be stopped during destruction"
        else
            log_info "No running tasks found"
        fi
    fi
}

# Main undeploy function
main() {
    echo -e "${RED}==========================================${NC}"
    echo -e "${RED}  Truecaller Backend - UNDEPLOY SCRIPT  ${NC}"
    echo -e "${RED}==========================================${NC}"
    echo ""
    
    check_prerequisites
    
    # Show what will be destroyed
    show_destruction_plan
    
    # Check for running tasks
    check_running_tasks
    
    # Final confirmation
    echo ""
    echo -e "${RED}==========================================${NC}"
    echo -e "${RED}  WARNING: THIS CANNOT BE UNDONE!${NC}"
    echo -e "${RED}==========================================${NC}"
    echo ""
    log_warning "All infrastructure will be permanently deleted"
    log_warning "CloudWatch logs will be lost"
    log_warning "ECR images will be deleted"
    echo ""
    
    read -p "Type 'DESTROY' (in caps) to confirm destruction: " confirmation
    echo ""
    
    if [ "$confirmation" != "DESTROY" ]; then
        log_info "Destruction cancelled - confirmation not received"
        exit 0
    fi
    
    # Second confirmation
    read -p "Are you absolutely sure? This will cost ~\$60/month if recreated (yes/no): " response
    echo ""
    
    if [ "$response" != "yes" ]; then
        log_info "Destruction cancelled"
        exit 0
    fi
    
    # Step 1: Clean up ECR repository (force delete with all images)
    log_info "Cleaning up ECR repository..."
    ECR_REPO="truecaller-backend"
    AWS_REGION=$(get_terraform_output aws_region)
    
    if [ -z "$AWS_REGION" ]; then
        AWS_REGION="eu-central-1"
    fi
    
    log_info "Checking if ECR repository exists..."
    if aws ecr describe-repositories --repository-name $ECR_REPO --region $AWS_REGION &>/dev/null; then
        log_info "Force deleting ECR repository with all images..."
        if aws ecr delete-repository --repository-name $ECR_REPO --region $AWS_REGION --force &>/dev/null; then
            log_success "ECR repository deleted"
        else
            log_warning "Failed to delete ECR repository (may require manual cleanup)"
        fi
    else
        log_info "ECR repository does not exist or already deleted"
    fi
    
    # Step 2: Create destroy plan
    log_info "Creating destruction plan..."
    cd terraform
    terraform plan -destroy -out destroy.tfplan
    cd ..
    log_success "Destruction plan created"
    
    # Step 3: Apply destruction
    echo ""
    log_info "Destroying infrastructure (this takes 3-5 minutes)..."
    echo ""
    
    cd terraform
    terraform apply destroy.tfplan
    DESTROY_EXIT_CODE=$?
    rm -f destroy.tfplan
    cd ..
    
    # If destruction failed (likely due to ECR not being empty), complete it
    if [ $DESTROY_EXIT_CODE -ne 0 ]; then
        log_warning "Initial destruction encountered an issue (likely ECR repository not empty)"
        log_info "Completing destruction with auto-approve..."
        
        cd terraform
        terraform destroy -auto-approve
        if [ $? -ne 0 ]; then
            log_error "Destruction failed"
            cd ..
            exit 1
        fi
        cd ..
    fi
    
    log_success "Infrastructure destroyed successfully"
    
    # Step 3.5: Force cleanup any remaining resources
    echo ""
    log_info "Checking for any remaining AWS resources..."
    AWS_REGION="eu-central-1"
    
    # Clean up Load Balancers
    log_info "Checking for leftover load balancers..."
    ALBS=$(aws elbv2 describe-load-balancers --region $AWS_REGION --query "LoadBalancers[?starts_with(LoadBalancerName, 'truecaller-backend')].LoadBalancerArn" --output text 2>/dev/null)
    if [ ! -z "$ALBS" ]; then
        echo "$ALBS" | while read alb; do
            if [ ! -z "$alb" ]; then
                log_info "Deleting load balancer: $alb"
                aws elbv2 delete-load-balancer --load-balancer-arn $alb --region $AWS_REGION &>/dev/null
                sleep 5  # Wait for ALB to start deleting
            fi
        done
    fi
    
    # Clean up Target Groups
    log_info "Checking for leftover target groups..."
    TGS=$(aws elbv2 describe-target-groups --region $AWS_REGION --query "TargetGroups[?starts_with(TargetGroupName, 'truecaller-backend')].TargetGroupArn" --output text 2>/dev/null)
    if [ ! -z "$TGS" ]; then
        sleep 10  # Wait for ALB deletion to propagate
        echo "$TGS" | while read tg; do
            if [ ! -z "$tg" ]; then
                log_info "Deleting target group: $tg"
                aws elbv2 delete-target-group --target-group-arn $tg --region $AWS_REGION &>/dev/null
            fi
        done
    fi
    
    # Clean up NAT Gateways
    log_info "Checking for leftover NAT gateways..."
    NAT_GWS=$(aws ec2 describe-nat-gateways --region $AWS_REGION --filter "Name=tag:Name,Values=*truecaller-backend*" --query "NatGateways[?State=='available'].NatGatewayId" --output text 2>/dev/null)
    if [ ! -z "$NAT_GWS" ]; then
        echo "$NAT_GWS" | while read nat; do
            if [ ! -z "$nat" ]; then
                log_info "Deleting NAT gateway: $nat"
                aws ec2 delete-nat-gateway --nat-gateway-id $nat --region $AWS_REGION &>/dev/null
            fi
        done
        log_info "Waiting 30 seconds for NAT gateways to delete..."
        sleep 30
    fi
    
    # Clean up Elastic IPs
    log_info "Checking for leftover Elastic IPs..."
    EIPS=$(aws ec2 describe-addresses --region $AWS_REGION --filters "Name=tag:Name,Values=*truecaller-backend*" --query "Addresses[].AllocationId" --output text 2>/dev/null)
    if [ ! -z "$EIPS" ]; then
        echo "$EIPS" | while read eip; do
            if [ ! -z "$eip" ]; then
                log_info "Releasing Elastic IP: $eip"
                aws ec2 release-address --allocation-id $eip --region $AWS_REGION &>/dev/null
            fi
        done
    fi
    
    log_success "Resource cleanup completed"
    
    # Step 4: Clean up deployment files
    log_info "Cleaning up temporary files..."
    rm -f terraform/destroy.tfplan terraform/deployment.tfplan
    
    # Step 5: Check and handle secrets
    echo ""
    log_info "Checking secrets status..."
    AWS_REGION="eu-central-1"  # Default region
    
    secrets=(
        "truecaller/database-url"
        "truecaller/redis-url"
        "truecaller/jwt-secret"
        "truecaller/firebase-credentials"
    )
    
    SECRET_COUNT=0
    for secret in "${secrets[@]}"; do
        if aws secretsmanager describe-secret --secret-id $secret --region $AWS_REGION &>/dev/null; then
            SECRET_COUNT=$((SECRET_COUNT + 1))
        fi
    done
    
    if [ $SECRET_COUNT -gt 0 ]; then
        log_info "$SECRET_COUNT secrets are in 'pending deletion' state (30-day recovery window)"
        echo ""
        read -p "Force delete secrets immediately? (yes/no): " delete_secrets
        echo ""
        
        if [ "$delete_secrets" = "yes" ]; then
            log_info "Force deleting secrets..."
            
            for secret in "${secrets[@]}"; do
                if aws secretsmanager delete-secret \
                    --secret-id $secret \
                    --force-delete-without-recovery \
                    --region $AWS_REGION &>/dev/null; then
                    log_success "Deleted: $secret"
                fi
            done
        else
            log_info "Secrets will remain in deletion pending state for 30 days"
            log_info "You can recover them or force delete later"
        fi
    else
        log_info "All secrets already deleted"
    fi
    
    # Step 6: Final Summary
    echo ""
    echo -e "${GREEN}==========================================${NC}"
    echo -e "${GREEN}  UNDEPLOY COMPLETED${NC}"
    echo -e "${GREEN}==========================================${NC}"
    echo ""
    
    # Verify critical resources are deleted
    log_info "Verifying resources are deleted..."
    VERIFICATION_FAILED=false
    
    # Check ECR
    if aws ecr describe-repositories --repository-names truecaller-backend --region $AWS_REGION &>/dev/null; then
        log_warning "ECR repository still exists!"
        echo -e "${YELLOW}  Manual cleanup: aws ecr delete-repository --repository-name truecaller-backend --region $AWS_REGION --force${NC}"
        VERIFICATION_FAILED=true
    else
        log_success "ECR repository deleted"
    fi
    
    # Check ECS Cluster
    CLUSTER_NAME="truecaller-backend-cluster"
    CLUSTER_STATUS=$(aws ecs describe-clusters --clusters $CLUSTER_NAME --region $AWS_REGION --query 'clusters[0].status' --output text 2>/dev/null)
    if [ "$CLUSTER_STATUS" = "ACTIVE" ]; then
        log_warning "ECS cluster still exists!"
        echo -e "${YELLOW}  Manual cleanup: aws ecs delete-cluster --cluster $CLUSTER_NAME --region $AWS_REGION${NC}"
        VERIFICATION_FAILED=true
    else
        log_success "ECS cluster deleted"
    fi
    
    if [ "$VERIFICATION_FAILED" = true ]; then
        echo ""
        log_warning "Some resources were not deleted. See above for manual cleanup commands."
    fi
    
    echo ""
    echo -e "${GREEN}✓${NC} Terraform destroy completed"
    if [ "$delete_secrets" = "yes" ]; then
        echo -e "${GREEN}✓${NC} Secrets permanently deleted"
    else
        echo -e "${YELLOW}✓${NC} Secrets marked for deletion (30-day recovery)"
    fi
    echo -e "${GREEN}✓${NC} Monthly savings: ~\$60-65"
    echo ""
    echo -e "${BLUE}Safe & Intact:${NC}"
    echo "  • Neon PostgreSQL database"
    echo "  • Aiven Redis instance"
    echo "  • Source code & configuration"
    echo ""
    echo -e "${BLUE}To redeploy later:${NC}"
    echo "  1. ./scripts/deploy.sh"
    echo "  2. Ensure secrets are populated when prompted"
    echo ""
}

# Run main function
main
