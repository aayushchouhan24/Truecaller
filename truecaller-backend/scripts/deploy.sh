#!/bin/bash

# Truecaller Backend - AWS ECS Deployment Script
# This script automates the deployment process

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
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install it first."
        exit 1
    fi
    
    log_success "All prerequisites found"
}

# Get Terraform outputs
get_terraform_output() {
    cd terraform
    terraform output -raw $1 2>/dev/null || echo ""
    cd ..
}

# Main deployment
main() {
    echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  Truecaller Backend - AWS ECS Deployment    ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    
    check_prerequisites
    
    # Step 1: Initialize Terraform (if needed)
    if [ ! -d "terraform/.terraform" ]; then
        log_info "Initializing Terraform..."
        cd terraform
        terraform init
        cd ..
        log_success "Terraform initialized"
    else
        log_info "Terraform already initialized"
    fi
    
    # Step 2: Terraform Plan
    log_info "Creating Terraform plan..."
    cd terraform
    terraform plan -out=deployment.tfplan
    cd ..
    log_success "Plan created"
    
    # Ask for confirmation
    echo ""
    read -p "Do you want to apply this plan? (yes/no): " -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_warning "Deployment cancelled"
        exit 0
    fi
    
    # Step 3: Apply Terraform
    log_info "Applying Terraform configuration..."
    cd terraform
    terraform apply deployment.tfplan
    rm -f deployment.tfplan
    cd ..
    log_success "Infrastructure deployed"
    
    # Get outputs
    ECR_URL=$(get_terraform_output ecr_repository_url)
    AWS_REGION=$(get_terraform_output aws_region)
    AWS_ACCOUNT=$(get_terraform_output aws_account_id)
    CLUSTER_NAME=$(get_terraform_output ecs_cluster_name)
    SERVICE_NAME=$(get_terraform_output ecs_service_name)
    ALB_DNS=$(get_terraform_output alb_dns_name)
    
    echo ""
    log_info "Deployment Summary:"
    echo "  ECR Repository: $ECR_URL"
    echo "  ECS Cluster: $CLUSTER_NAME"
    echo "  ECS Service: $SERVICE_NAME"
    echo "  ALB DNS: $ALB_DNS"
    echo ""
    
    # Step 4: Check database migrations
    log_warning "IMPORTANT: Ensure database schema is set up!"
    log_info "For first deployment, run: npx prisma migrate deploy"
    log_info "For existing database, ensure schema matches prisma/schema.prisma"
    echo ""
    read -p "Is database schema ready? (yes/no): " -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_warning "Please set up database schema before continuing"
        exit 0
    fi
    
    # Step 5: Check if secrets are populated
    log_warning "IMPORTANT: Ensure all secrets are populated in AWS Secrets Manager!"
    log_info "Run './scripts/populate-secrets.sh' if you haven't already"
    echo ""
    read -p "Have you populated all secrets? (yes/no): " -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_warning "Please populate secrets before continuing"
        log_info "See README.md for instructions"
        exit 0
    fi
    
    # Step 6: Build Docker image
    log_info "Building Docker image..."
    docker build -t truecaller-backend:latest .
    log_success "Docker image built"
    
    # Step 7: Verify ECR repository exists (should be created by Terraform)
    log_info "Verifying ECR repository..."
    if ! aws ecr describe-repositories --repository-names truecaller-backend --region $AWS_REGION &>/dev/null; then
        log_error "ECR repository not found. Terraform may have failed to create it."
        log_info "Run: cd terraform && terraform apply"
        exit 1
    fi
    log_success "ECR repository verified"
    
    # Step 8: Login to ECR
    log_info "Logging into Amazon ECR..."
    echo "  Command: aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
    
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
    if [ $? -ne 0 ]; then
        log_error "ECR login failed."
        log_info "Troubleshooting:"
        echo "  1. Verify AWS credentials: aws sts get-caller-identity"
        echo "  2. Check ECR permissions: aws ecr describe-repositories --region $AWS_REGION"
        echo "  3. Ensure Docker is running: docker info"
        exit 1
    fi
    log_success "Logged into ECR"
    
    # Step 9: Tag and push image
    log_info "Pushing image to ECR..."
    docker tag truecaller-backend:latest $ECR_URL:latest
    docker push $ECR_URL:latest
    log_success "Image pushed to ECR"
    
    # Step 10: Force new deployment
    log_info "Triggering ECS service deployment..."
    aws ecs update-service \
        --cluster $CLUSTER_NAME \
        --service $SERVICE_NAME \
        --force-new-deployment \
        --region $AWS_REGION \
        > /dev/null
    log_success "Deployment triggered"
    
    # Final message
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Deployment Completed!              ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    log_info "Your application will be available at:"
    echo -e "  ${BLUE}http://$ALB_DNS/api${NC}"
    echo ""
    log_info "Monitor deployment progress:"
    echo "  aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION"
    echo ""
    log_info "View logs:"
    echo "  aws logs tail /ecs/truecaller-backend --follow --region $AWS_REGION"
    echo ""
}

# Run main function
main
