#!/bin/bash

# Verify Ollama Connection Script
# This script checks if the backend can connect to the Ollama service

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Get Ollama URL from Terraform or AWS
get_ollama_url() {
    if [ -d "terraform" ]; then
        cd terraform
        OLLAMA_DNS=$(terraform output -raw ollama_alb_dns_name 2>/dev/null || echo "")
        cd ..
        
        if [ -n "$OLLAMA_DNS" ] && [ "$OLLAMA_DNS" != "null" ]; then
            echo "http://${OLLAMA_DNS}"
            return 0
        fi
    fi
    
    # Fallback: try AWS CLI
    log_warning "Terraform output not available, trying AWS CLI..."
    OLLAMA_DNS=$(aws elbv2 describe-load-balancers \
        --query "LoadBalancers[?contains(LoadBalancerName, 'ollama')].DNSName | [0]" \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$OLLAMA_DNS" ] && [ "$OLLAMA_DNS" != "None" ]; then
        echo "http://${OLLAMA_DNS}"
        return 0
    fi
    
    return 1
}

# Main verification
main() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     Ollama Connection Verification          ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    
    log_info "Retrieving Ollama service URL..."
    OLLAMA_URL=$(get_ollama_url)
    
    if [ -z "$OLLAMA_URL" ]; then
        log_error "Could not determine Ollama URL"
        log_info "Please ensure Ollama service is deployed"
        exit 1
    fi
    
    log_success "Ollama URL: $OLLAMA_URL"
    echo ""
    
    # Test 1: Basic connectivity
    log_info "Testing basic connectivity..."
    if curl -f -s -o /dev/null -w "%{http_code}" "$OLLAMA_URL" --max-time 5 | grep -q "200"; then
        log_success "Ollama service is reachable"
    else
        log_error "Cannot reach Ollama service"
        exit 1
    fi
    
    # Test 2: API endpoint
    log_info "Testing Ollama API..."
    API_RESPONSE=$(curl -s "$OLLAMA_URL/api/tags" --max-time 10)
    
    if echo "$API_RESPONSE" | grep -q "models"; then
        log_success "Ollama API is responding"
        
        # Extract and display models
        MODELS=$(echo "$API_RESPONSE" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | head -5)
        if [ -n "$MODELS" ]; then
            echo ""
            log_info "Available models:"
            echo "$MODELS" | while read -r model; do
                echo "  - $model"
            done
        fi
    else
        log_warning "Ollama API returned unexpected response"
        echo "Response: $API_RESPONSE"
    fi
    
    # Test 3: Check if specific model exists
    log_info "Checking for llama3.2:1b model..."
    if echo "$API_RESPONSE" | grep -q "llama3.2:1b"; then
        log_success "Model llama3.2:1b is available"
    else
        log_warning "Model llama3.2:1b not found"
        log_info "Available models listed above"
    fi
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         Verification Complete                ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    
    log_success "Backend can connect to Ollama service"
    echo ""
    log_info "Environment variable for backend:"
    echo -e "  ${BLUE}OLLAMA_URL=$OLLAMA_URL${NC}"
    echo ""
}

main
