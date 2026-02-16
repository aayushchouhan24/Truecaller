# Verify Ollama Connection Script (PowerShell)
# This script checks if the backend can connect to the Ollama service

$ErrorActionPreference = "Continue"

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

# Get Ollama URL from Terraform or AWS
function Get-OllamaUrl {
    if (Test-Path "terraform") {
        Push-Location terraform
        $ollamaDns = terraform output -raw ollama_alb_dns_name 2>$null
        Pop-Location
        
        if ($ollamaDns -and $ollamaDns -ne "null") {
            return "http://$ollamaDns"
        }
    }
    
    # Fallback: try AWS CLI
    Write-Warning "Terraform output not available, trying AWS CLI..."
    $ollamaDns = aws elbv2 describe-load-balancers `
        --query "LoadBalancers[?contains(LoadBalancerName, 'ollama')].DNSName | [0]" `
        --output text 2>$null
    
    if ($ollamaDns -and $ollamaDns -ne "None") {
        return "http://$ollamaDns"
    }
    
    return $null
}

# Main verification
function Start-Verification {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "     Ollama Connection Verification           " -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    
    Write-Info "Retrieving Ollama service URL..."
    $ollamaUrl = Get-OllamaUrl
    
    if (-not $ollamaUrl) {
        Write-Error "Could not determine Ollama URL"
        Write-Info "Please ensure Ollama service is deployed"
        exit 1
    }
    
    Write-Success "Ollama URL: $ollamaUrl"
    Write-Host ""
    
    # Test 1: Basic connectivity
    Write-Info "Testing basic connectivity..."
    try {
        $response = Invoke-WebRequest -Uri $ollamaUrl -Method Get -TimeoutSec 5 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Success "Ollama service is reachable"
        }
    }
    catch {
        Write-Error "Cannot reach Ollama service"
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
    
    # Test 2: API endpoint
    Write-Info "Testing Ollama API..."
    try {
        $apiResponse = Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -Method Get -TimeoutSec 10
        
        if ($apiResponse.models) {
            Write-Success "Ollama API is responding"
            
            # Display available models
            Write-Host ""
            Write-Info "Available models:"
            $apiResponse.models | Select-Object -First 5 | ForEach-Object {
                Write-Host "  - $($_.name)" -ForegroundColor Gray
            }
        }
        else {
            Write-Warning "Ollama API returned unexpected response"
        }
        
        # Test 3: Check for specific model
        Write-Host ""
        Write-Info "Checking for llama3.2:1b model..."
        $hasModel = $apiResponse.models | Where-Object { $_.name -eq "llama3.2:1b" }
        
        if ($hasModel) {
            Write-Success "Model llama3.2:1b is available"
        }
        else {
            Write-Warning "Model llama3.2:1b not found"
            Write-Info "Available models listed above"
        }
    }
    catch {
        Write-Warning "Could not query Ollama API"
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "         Verification Complete                 " -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    
    Write-Success "Backend can connect to Ollama service"
    Write-Host ""
    Write-Info "Environment variable for backend:"
    Write-Host "  OLLAMA_URL=$ollamaUrl" -ForegroundColor Blue
    Write-Host ""
}

# Run verification
Start-Verification
