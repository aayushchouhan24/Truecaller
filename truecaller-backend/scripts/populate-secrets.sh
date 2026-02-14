#!/bin/bash

# Truecaller Backend - Secrets Populator Script
# This script helps populate AWS Secrets Manager with required values

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

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI not found. Please install it first."
    exit 1
fi

# Check if OpenSSL is available for JWT secret generation
if ! command -v openssl &> /dev/null; then
    log_warning "OpenSSL not found. JWT secret will need to be provided manually."
    OPENSSL_AVAILABLE=false
else
    OPENSSL_AVAILABLE=true
fi

echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Truecaller Backend - Secrets Setup        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# Get AWS region from Terraform output or ask
if [ -f "terraform/terraform.tfvars" ]; then
    AWS_REGION=$(grep 'aws_region' terraform/terraform.tfvars | cut -d'"' -f2 || echo "eu-central-1")
else
    AWS_REGION="eu-central-1"
fi

log_info "Using AWS Region: $AWS_REGION"
echo ""

# Define secret names
SECRET_DATABASE="truecaller/database-url"
SECRET_REDIS="truecaller/redis-url"
SECRET_JWT="truecaller/jwt-secret"
SECRET_FIREBASE="truecaller/firebase-credentials"

# Function to check if secret exists and has value
check_secret() {
    SECRET_NAME=$1
    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" &> /dev/null; then
        if aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --region "$AWS_REGION" &> /dev/null; then
            echo "exists_with_value"
        else
            echo "exists_no_value"
        fi
    else
        echo "not_exists"
    fi
}

# Function to update secret
update_secret() {
    SECRET_NAME=$1
    SECRET_VALUE=$2
    
    if aws secretsmanager put-secret-value \
        --secret-id "$SECRET_NAME" \
        --secret-string "$SECRET_VALUE" \
        --region "$AWS_REGION" &> /dev/null; then
        log_success "Updated: $SECRET_NAME"
        return 0
    else
        log_error "Failed to update: $SECRET_NAME"
        return 1
    fi
}

# 1. Database URL
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "1. Database URL (PostgreSQL - Neon)"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

STATUS=$(check_secret "$SECRET_DATABASE")
if [ "$STATUS" = "exists_with_value" ]; then
    log_info "Secret already has a value"
    read -p "Do you want to update it? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_info "Skipping database URL"
    else
        echo ""
        echo "Enter your Neon PostgreSQL connection URL:"
        echo "Format: postgresql://user:password@ep-xxx.region.aws.neon.tech:5432/dbname?sslmode=require"
        read -sp "Database URL: " DATABASE_URL
        echo ""
        if [ -n "$DATABASE_URL" ]; then
            update_secret "$SECRET_DATABASE" "$DATABASE_URL"
        fi
    fi
else
    echo ""
    echo "Enter your Neon PostgreSQL connection URL:"
    echo "Format: postgresql://user:password@ep-xxx.region.aws.neon.tech:5432/dbname?sslmode=require"
    read -sp "Database URL: " DATABASE_URL
    echo ""
    if [ -n "$DATABASE_URL" ]; then
        update_secret "$SECRET_DATABASE" "$DATABASE_URL"
    else
        log_warning "Skipped: Database URL"
    fi
fi
echo ""

# 2. Redis URL
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "2. Redis URL (Aiven or other provider)"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

STATUS=$(check_secret "$SECRET_REDIS")
if [ "$STATUS" = "exists_with_value" ]; then
    log_info "Secret already has a value"
    read -p "Do you want to update it? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_info "Skipping Redis URL"
    else
        echo ""
        echo "Enter your Redis connection URL:"
        echo "Format: rediss://default:password@redis-xxx.aivencloud.com:12345"
        read -sp "Redis URL: " REDIS_URL
        echo ""
        if [ -n "$REDIS_URL" ]; then
            update_secret "$SECRET_REDIS" "$REDIS_URL"
        fi
    fi
else
    echo ""
    echo "Enter your Redis connection URL:"
    echo "Format: rediss://default:password@redis-xxx.aivencloud.com:12345"
    read -sp "Redis URL: " REDIS_URL
    echo ""
    if [ -n "$REDIS_URL" ]; then
        update_secret "$SECRET_REDIS" "$REDIS_URL"
    else
        log_warning "Skipped: Redis URL"
    fi
fi
echo ""

# 3. JWT Secret
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "3. JWT Secret"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

STATUS=$(check_secret "$SECRET_JWT")
if [ "$STATUS" = "exists_with_value" ]; then
    log_info "Secret already has a value"
    read -p "Do you want to regenerate it? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_warning "WARNING: Changing JWT secret will invalidate all existing tokens!"
        log_info "Skipping JWT secret"
    else
        if [ "$OPENSSL_AVAILABLE" = true ]; then
            JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
            update_secret "$SECRET_JWT" "$JWT_SECRET"
        else
            echo ""
            echo "Enter a strong random string for JWT secret (min 32 characters):"
            read -sp "JWT Secret: " JWT_SECRET
            echo ""
            if [ -n "$JWT_SECRET" ]; then
                update_secret "$SECRET_JWT" "$JWT_SECRET"
            fi
        fi
    fi
else
    if [ "$OPENSSL_AVAILABLE" = true ]; then
        log_info "Generating random JWT secret..."
        JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
        update_secret "$SECRET_JWT" "$JWT_SECRET"
    else
        echo ""
        echo "Enter a strong random string for JWT secret (min 32 characters):"
        read -sp "JWT Secret: " JWT_SECRET
        echo ""
        if [ -n "$JWT_SECRET" ]; then
            update_secret "$SECRET_JWT" "$JWT_SECRET"
        else
            log_warning "Skipped: JWT Secret"
        fi
    fi
fi
echo ""

# 4. Firebase Service Account
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "4. Firebase Service Account JSON"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

STATUS=$(check_secret "$SECRET_FIREBASE")
if [ "$STATUS" = "exists_with_value" ]; then
    log_info "Secret already has a value"
    read -p "Do you want to update it? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        log_info "Skipping Firebase credentials"
    else
        echo ""
        DEFAULT_PATH="./firebase-service-account.json"
        read -p "Enter path to firebase-service-account.json [$DEFAULT_PATH]: " FIREBASE_PATH
        FIREBASE_PATH=${FIREBASE_PATH:-$DEFAULT_PATH}
        
        if [ -f "$FIREBASE_PATH" ]; then
            FIREBASE_JSON=$(cat "$FIREBASE_PATH")
            update_secret "$SECRET_FIREBASE" "$FIREBASE_JSON"
        else
            log_error "File not found: $FIREBASE_PATH"
        fi
    fi
else
    echo ""
    DEFAULT_PATH="./firebase-service-account.json"
    read -p "Enter path to firebase-service-account.json [$DEFAULT_PATH]: " FIREBASE_PATH
    FIREBASE_PATH=${FIREBASE_PATH:-$DEFAULT_PATH}
    
    if [ -f "$FIREBASE_PATH" ]; then
        log_info "Reading Firebase credentials from: $FIREBASE_PATH"
        FIREBASE_JSON=$(cat "$FIREBASE_PATH")
        update_secret "$SECRET_FIREBASE" "$FIREBASE_JSON"
    else
        log_error "File not found: $FIREBASE_PATH"
        log_warning "Skipped: Firebase credentials"
    fi
fi
echo ""

# Summary
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Secrets Setup Complete!            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

log_info "Verifying secrets..."
echo ""

# Verify all secrets
ALL_SET=true

for SECRET in "$SECRET_DATABASE" "$SECRET_REDIS" "$SECRET_JWT" "$SECRET_FIREBASE"; do
    if aws secretsmanager get-secret-value --secret-id "$SECRET" --region "$AWS_REGION" &> /dev/null; then
        log_success "$SECRET"
    else
        log_error "$SECRET (NOT SET)"
        ALL_SET=false
    fi
done

echo ""
if [ "$ALL_SET" = true ]; then
    log_success "All secrets are configured!"
    echo ""
    log_info "You can now proceed with deployment:"
    echo "  ./scripts/deploy.sh"
else
    log_warning "Some secrets are missing. Please configure them before deployment."
fi
echo ""
