# CI/CD Pipeline Documentation

## Overview

This repository uses **GitHub Actions** for continuous integration and deployment to AWS ECS Fargate. The pipeline automatically builds, tests, and deploys the backend service while maintaining the connection to the existing Ollama service.

## Pipeline Architecture

```
┌─────────────────┐
│   Push to main  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  1. Build & Test                            │
│     - Compile TypeScript                    │
│     - Run linting                           │
│     - Build Docker image                    │
└────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  2. Database Migrations                     │
│     - Run Prisma migrations                 │
└────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  3. Retrieve Ollama URL                     │
│     - Get from Terraform outputs            │
│     - Fallback to AWS API                   │
└────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  4. Push to ECR                             │
│     - Tag with git SHA                      │
│     - Tag as latest                         │
└────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  5. Update ECS Task Definition              │
│     - Set OLLAMA_URL env variable           │
│     - Update container image                │
└────────┬────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  6. Deploy to ECS                           │
│     - Update service                        │
│     - Wait for stability                    │
│     - Auto-rollback on failure              │
└─────────────────────────────────────────────┘
```

## Workflows

### 1. **Deploy (`deploy.yml`)**

**Triggers:**
- Push to `main` or `production` branch
- Manual trigger via GitHub Actions UI (with optional Ollama deployment)

**Key Features:**
- ✅ Automatically retrieves existing Ollama service URL
- ✅ Maintains connection between backend and Ollama
- ✅ Runs database migrations before deployment
- ✅ Zero-downtime deployment with ECS circuit breaker
- ✅ Automatic rollback on failure
- ✅ Optional Ollama service deployment (manual trigger only)

**Environment Variables Set:**
```yaml
OLLAMA_URL: http://<ollama-alb-dns>
OLLAMA_ENABLED: true
OLLAMA_MODEL: llama3.2:1b
OLLAMA_TIMEOUT: 30000
NODE_ENV: production
```

### 2. **PR Check (`pr-check.yml`)**

**Triggers:**
- Pull request to `main` or `production` branch
- Changes to `src/`, `prisma/`, `package.json`, `Dockerfile`, etc.

**Validation Steps:**
- ✅ TypeScript compilation
- ✅ Linting checks
- ✅ Prisma schema validation
- ✅ Docker build test
- ✅ Security vulnerability scan
- ✅ Migration drift detection

## Setup Instructions

### 1. Configure GitHub Secrets

Navigate to **Settings → Secrets and variables → Actions** and add:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | AWS IAM access key | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `DATABASE_URL` | PostgreSQL connection string (for migrations) | `postgresql://user:pass@host/db` |

### 2. IAM Permissions Required

Your AWS IAM user needs these permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "elbv2:DescribeLoadBalancers",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

### 3. Verify Terraform State

Ensure your Terraform state is accessible and contains these outputs:
- `ollama_alb_dns_name`
- `ecr_repository_url`
- `ecr_ollama_repository_url`
- `ecs_cluster_name`
- `ecs_service_name`
- `ollama_service_name`

## Ollama Connection Logic

The pipeline ensures the backend always connects to the existing Ollama service:

### Step 1: Retrieve Ollama URL
```bash
# Try Terraform outputs first
OLLAMA_ALB_DNS=$(terraform output -raw ollama_alb_dns_name)

# Fallback to AWS API if Terraform not available
if [ -z "$OLLAMA_ALB_DNS" ]; then
  OLLAMA_ALB_DNS=$(aws elbv2 describe-load-balancers \
    --query "LoadBalancers[?contains(LoadBalancerName, 'ollama')].DNSName | [0]" \
    --output text)
fi

OLLAMA_URL="http://${OLLAMA_ALB_DNS}"
```

### Step 2: Inject into Task Definition
The pipeline uses `aws-actions/amazon-ecs-render-task-definition` to update the task definition with the correct `OLLAMA_URL` environment variable before deployment.

### Step 3: Verification Script
After deployment, run the verification script:
```bash
# Linux/Mac
./scripts/verify-ollama-connection.sh

# Windows (PowerShell)
.\scripts\verify-ollama-connection.ps1
```

## Manual Deployment

### Deploy Backend Only (Default)
```bash
# Trigger via GitHub Actions UI
# OR push to main branch
git push origin main
```

### Deploy Backend + Ollama
```bash
# Use GitHub Actions UI:
# 1. Go to Actions → Deploy to AWS ECS
# 2. Click "Run workflow"
# 3. Enable "Deploy Ollama service"
# 4. Click "Run workflow"
```

### Local Testing
```bash
# Verify Ollama connection
./scripts/verify-ollama-connection.sh

# Or use the existing deploy script
./scripts/deploy.sh
```

## Troubleshooting

### Issue: "Could not determine Ollama URL"

**Solution:**
1. Check if Ollama service is deployed:
   ```bash
   aws ecs describe-services \
     --cluster truecaller-backend-cluster \
     --services truecaller-backend-ollama-service
   ```

2. Verify Terraform outputs:
   ```bash
   cd terraform
   terraform output ollama_alb_dns_name
   ```

3. Check ALB in AWS Console:
   ```bash
   aws elbv2 describe-load-balancers \
     --query "LoadBalancers[?contains(LoadBalancerName, 'ollama')]"
   ```

### Issue: "Deployment failed - health checks failing"

**Solution:**
1. Check CloudWatch logs:
   ```bash
   aws logs tail /ecs/truecaller-backend --follow
   ```

2. Verify database connectivity (check DATABASE_URL secret)

3. Verify Ollama is reachable from backend:
   ```bash
   # Get backend task private IP
   # Test connectivity from another ECS task or EC2 instance
   curl http://<ollama-alb-dns>/api/tags
   ```

### Issue: "Circuit breaker triggered rollback"

**Cause:** Health checks failed too many times during deployment.

**Solution:**
1. Review previous task logs for errors
2. Check if database migrations succeeded
3. Verify all secrets are populated correctly
4. Ensure Ollama service is healthy

## Monitoring

### CloudWatch Logs
```bash
# Backend logs
aws logs tail /ecs/truecaller-backend --follow --region eu-central-1

# Ollama logs
aws logs tail /ecs/truecaller-backend-ollama --follow --region eu-central-1
```

### Service Status
```bash
# Check ECS service status
aws ecs describe-services \
  --cluster truecaller-backend-cluster \
  --services truecaller-backend-service truecaller-backend-ollama-service
```

### Health Endpoints
```bash
# Backend health
ALB_DNS=$(cd terraform && terraform output -raw alb_dns_name)
curl http://${ALB_DNS}/health

# Ollama health
OLLAMA_DNS=$(cd terraform && terraform output -raw ollama_alb_dns_name)
curl http://${OLLAMA_DNS}/
```

## Deployment Workflow Best Practices

### 1. **Branch Protection**
Enable branch protection on `main`:
- Require PR reviews
- Require status checks to pass
- Enable auto-merge (optional)

### 2. **Deployment Strategy**
- **Feature branches** → Create PR → Auto-validates
- **PR merged to main** → Auto-deploys to production
- **Hotfix** → Direct push to main (protected users only)

### 3. **Database Migrations**
- Always test migrations in staging first
- Use `prisma migrate deploy` (never `prisma migrate dev` in CI)
- Migrations run automatically before deployment

### 4. **Rollback Strategy**
- ECS circuit breaker handles automatic rollbacks
- Manual rollback: Revert commit and push
- Emergency: Manually deploy previous task definition in AWS Console

## Environment Variables

The pipeline automatically sets these environment variables in the ECS task:

| Variable | Value | Source |
|----------|-------|--------|
| `NODE_ENV` | `production` | Hardcoded |
| `PORT` | `3000` | Hardcoded |
| `OLLAMA_URL` | `http://<ollama-alb-dns>` | Retrieved dynamically |
| `OLLAMA_ENABLED` | `true` | Hardcoded |
| `OLLAMA_MODEL` | `llama3.2:1b` | Hardcoded |
| `OLLAMA_TIMEOUT` | `30000` | Hardcoded |
| `DATABASE_URL` | `postgresql://...` | AWS Secrets Manager |
| `REDIS_URL` | `rediss://...` | AWS Secrets Manager |
| `JWT_SECRET` | `<random>` | AWS Secrets Manager |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | `{...}` | AWS Secrets Manager |

## Cost Optimization

- **ECR Lifecycle Policy**: Keeps last 10 images, deletes older ones
- **CloudWatch Logs**: 7-day retention period
- **ECS Circuit Breaker**: Prevents failed deployments from consuming resources
- **Docker Layer Caching**: Speeds up builds and reduces data transfer

## Security Features

- ✅ No hardcoded credentials
- ✅ Secrets stored in AWS Secrets Manager
- ✅ IAM roles with least privilege
- ✅ Docker image scanning enabled
- ✅ npm audit runs on every PR
- ✅ Private subnets for ECS tasks
- ✅ Security groups restrict traffic

## Support

For issues or questions:
1. Check CloudWatch logs
2. Run verification scripts
3. Review GitHub Actions logs
4. Check AWS ECS console for task failures

---

**Last Updated:** February 16, 2026
