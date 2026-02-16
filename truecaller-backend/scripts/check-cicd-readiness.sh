#!/bin/bash

# CI/CD Readiness Check Script
# Verifies that all prerequisites are met for GitHub Actions deployment

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

log_error() {
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
}

check_command() {
    if command -v $1 &> /dev/null; then
        log_success "$1 is installed"
        return 0
    else
        log_error "$1 is not installed"
        return 1
    fi
}

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     CI/CD Readiness Check                    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# 1. Check required commands
log_info "Checking required tools..."
check_command "aws"
check_command "terraform"
check_command "docker"
check_command "git"
echo ""

# 2. Check AWS credentials
log_info "Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    log_success "AWS credentials configured (Account: $ACCOUNT_ID)"
else
    log_error "AWS credentials not configured or invalid"
    log_info "Run: aws configure"
fi
echo ""

# 3. Check Terraform state
log_info "Checking Terraform infrastructure..."
if [ -d "terraform" ]; then
    cd terraform
    
    if [ -f "terraform.tfstate" ]; then
        log_success "Terraform state exists"
        
        # Check key outputs
        if terraform output ecr_repository_url &> /dev/null; then
            log_success "ECR repository configured"
        else
            log_error "ECR repository not found in Terraform state"
        fi
        
        if terraform output ollama_alb_dns_name &> /dev/null; then
            OLLAMA_DNS=$(terraform output -raw ollama_alb_dns_name)
            log_success "Ollama service configured (DNS: $OLLAMA_DNS)"
        else
            log_error "Ollama service not found in Terraform state"
            log_info "Ollama must be deployed before backend CI/CD can work"
        fi
        
        if terraform output ecs_cluster_name &> /dev/null; then
            log_success "ECS cluster configured"
        else
            log_error "ECS cluster not found in Terraform state"
        fi
    else
        log_error "Terraform state not found"
        log_info "Run: cd terraform && terraform init && terraform apply"
    fi
    
    cd ..
else
    log_error "Terraform directory not found"
fi
echo ""

# 4. Check secrets in AWS
log_info "Checking AWS Secrets Manager..."
SECRETS=(
    "truecaller/database-url"
    "truecaller/redis-url"
    "truecaller/jwt-secret"
    "truecaller/firebase-credentials"
)

for secret in "${SECRETS[@]}"; do
    if aws secretsmanager describe-secret --secret-id "$secret" &> /dev/null 2>&1; then
        # Check if secret has a value
        if aws secretsmanager get-secret-value --secret-id "$secret" &> /dev/null 2>&1; then
            log_success "Secret '$secret' exists and has a value"
        else
            log_warning "Secret '$secret' exists but has no value"
            log_info "Run: ./scripts/populate-secrets.sh"
        fi
    else
        log_error "Secret '$secret' not found"
        log_info "Run: cd terraform && terraform apply (creates empty secrets)"
    fi
done
echo ""

# 5. Check Docker daemon
log_info "Checking Docker..."
if docker info &> /dev/null; then
    log_success "Docker daemon is running"
else
    log_error "Docker daemon is not running"
    log_info "Start Docker Desktop or Docker daemon"
fi
echo ""

# 6. Check GitHub repository
log_info "Checking Git repository..."
if [ -d ".git" ]; then
    log_success "Git repository initialized"
    
    # Check remote
    if git remote -v | grep -q "github.com"; then
        REMOTE=$(git remote get-url origin)
        log_success "GitHub remote configured: $REMOTE"
    else
        log_warning "No GitHub remote found"
        log_info "Add remote: git remote add origin <your-repo-url>"
    fi
    
    # Check branch
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    log_info "Current branch: $BRANCH"
else
    log_error "Not a Git repository"
fi
echo ""

# 7. Check workflow files
log_info "Checking GitHub Actions workflows..."
if [ -f ".github/workflows/deploy.yml" ]; then
    log_success "Deploy workflow exists"
else
    log_error "Deploy workflow not found"
fi

if [ -f ".github/workflows/pr-check.yml" ]; then
    log_success "PR check workflow exists"
else
    log_error "PR check workflow not found"
fi
echo ""

# 8. Check Node.js and dependencies
log_info "Checking Node.js environment..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    log_success "Node.js installed: $NODE_VERSION"
    
    if [ -f "package.json" ]; then
        log_success "package.json exists"
        
        if [ -d "node_modules" ]; then
            log_success "Dependencies installed"
        else
            log_warning "Dependencies not installed"
            log_info "Run: npm install"
        fi
    fi
else
    log_error "Node.js not installed"
fi
echo ""

# 9. Check Prisma
log_info "Checking Prisma..."
if [ -f "prisma/schema.prisma" ]; then
    log_success "Prisma schema exists"
    
    if [ -d "node_modules/.prisma" ]; then
        log_success "Prisma client generated"
    else
        log_warning "Prisma client not generated"
        log_info "Run: npx prisma generate"
    fi
else
    log_error "Prisma schema not found"
fi
echo ""

# Summary
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Readiness Summary                  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    log_success "All checks passed! Ready for CI/CD deployment"
    echo ""
    log_info "Next steps:"
    echo "  1. Push code to GitHub: git push origin main"
    echo "  2. Go to GitHub Actions to see deployment"
    echo "  3. Monitor: https://github.com/<your-repo>/actions"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo ""
    log_info "You can proceed, but resolve warnings for best results"
    exit 0
else
    echo -e "${RED}✗ $ERRORS error(s) found${NC}"
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo ""
    log_error "Please fix errors before proceeding with CI/CD"
    exit 1
fi
