# CI/CD Pipeline Documentation

## Overview

This monorepo contains both backend (`truecaller-backend/`) and frontend (`truecaller-clone/`) applications. GitHub Actions CI/CD is configured at the repository root level and **only triggers for backend changes**.

## Repository Structure

```
D:\truecaller-backend\Truecaller\    # Repository root (git root)
├── .github/
│   └── workflows/
│       ├── deploy.yml               # Deploy backend on push to 'deploy' branch
│       └── pr-check.yml             # Validate backend PRs
├── truecaller-backend/              # NestJS Backend (CI/CD ENABLED)
│   ├── src/
│   ├── prisma/
│   ├── terraform/
│   └── Dockerfile
└── truecaller-clone/                # React Native App (CI/CD DISABLED)
    └── app/
```

## Trigger Configuration

### Deploy Workflow (`deploy.yml`)

**Triggers:**
- Push to `deploy` branch
- Only when files in `truecaller-backend/**` change
- Manual workflow dispatch (with optional Ollama deployment)

**Path Filters:**
```yaml
paths:
  - 'truecaller-backend/**'
  - '!truecaller-backend/**/*.md'  # Ignore markdown changes
```

### PR Validation (`pr-check.yml`)

**Triggers:**
- Pull request to `deploy` or `main` branch
- Only when these files change:
  - `truecaller-backend/src/**`
  - `truecaller-backend/prisma/**`
  - `truecaller-backend/package*.json`
  - `truecaller-backend/Dockerfile`
  - `truecaller-backend/tsconfig.json`

## Working Directory

All workflow steps are executed with `working-directory: truecaller-backend` to ensure proper context for:
- npm commands
- Prisma operations
- Docker builds
- Terraform operations

## Setup Instructions

### 1. Configure GitHub Secrets

Go to **Repository Settings → Secrets and variables → Actions**

Add these secrets:
```
AWS_ACCESS_KEY_ID=<your-aws-access-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-key>
DATABASE_URL=<your-postgresql-url>
```

### 2. Verify Setup

From repository root:
```powershell
# Check if workflows exist
ls .github\workflows\

# Verify backend structure
ls truecaller-backend\
```

### 3. Test Deployment

```bash
# Create and push to deploy branch
git checkout -b deploy
git add .
git commit -m "Test deployment"
git push origin deploy
```

Monitor at: `https://github.com/<your-repo>/actions`

## Pipeline Flow

```
Push to 'deploy' branch (truecaller-backend/ changes only)
    ↓
Check if changes are in truecaller-backend/**
    ↓ (Yes)
Build & Test (in truecaller-backend/)
    ↓
Run Migrations (truecaller-backend/prisma/)
    ↓
Retrieve Ollama URL (truecaller-backend/terraform/)
    ↓
Build Docker (truecaller-backend/Dockerfile)
    ↓
Push to ECR
    ↓
Deploy to ECS
    ↓
Health Check & Rollback
```

## Key Differences from Single-Repo Setup

| Aspect | Single Repo | Monorepo (This Setup) |
|--------|-------------|----------------------|
| `.github/` location | Inside project | At repository root |
| Working directory | `.` (root) | `truecaller-backend/` |
| Path triggers | All changes | Only `truecaller-backend/**` |
| Multiple apps | One app | Backend + Frontend (only backend deployed) |

## Ollama Connection

The pipeline automatically maintains the connection to the existing Ollama service:

1. **Retrieves Ollama URL** from Terraform outputs in `truecaller-backend/terraform/`
2. **Injects as environment variable** `OLLAMA_URL=http://<ollama-alb-dns>`
3. **Updates ECS task definition** with the correct URL before deployment

No manual configuration needed - the connection is preserved automatically!

## Branch Strategy

- **`main`** - Main development branch
- **`deploy`** - Production deployment branch (auto-deploys on push)
- **Feature branches** - Create PRs to `deploy` for validation

## Workflow Files Location

✅ **Correct:** `D:\truecaller-backend\Truecaller\.github\workflows\`
❌ **Wrong:** `D:\truecaller-backend\Truecaller\truecaller-backend\.github\workflows\`

## Testing Locally

From repository root:

```powershell
# Navigate to backend
cd truecaller-backend

# Run readiness check
.\scripts\check-cicd-readiness.ps1

# Test Ollama connection
.\scripts\verify-ollama-connection.ps1

# Go back to root
cd ..
```

## Troubleshooting

### Issue: Workflow not triggering

**Check:**
1. Is `.github/` at repository root?
2. Are you pushing to `deploy` branch?
3. Are changes inside `truecaller-backend/` folder?

```bash
# Verify workflow location
ls -la .github/workflows/

# Check current branch
git branch --show-current
```

### Issue: Wrong working directory

**Solution:** All workflows use `working-directory: truecaller-backend`
- npm commands run in `truecaller-backend/`
- Docker builds use `truecaller-backend/Dockerfile`
- Terraform commands run in `truecaller-backend/terraform/`

### Issue: Frontend changes triggering backend deploy

**This won't happen!** Path filters ensure only `truecaller-backend/**` changes trigger the workflow.

## Monitoring

### GitHub Actions
```
https://github.com/<your-username>/<repo-name>/actions
```

### AWS CloudWatch Logs
```bash
# From truecaller-backend/ directory
aws logs tail /ecs/truecaller-backend --follow --region eu-central-1
```

### Health Endpoints
```bash
# Get from Terraform output
cd truecaller-backend/terraform
terraform output alb_dns_name

# Test health
curl http://<alb-dns>/health
```

## Environment Variables

Set in ECS task definition:
- `OLLAMA_URL` - Retrieved dynamically from Terraform/AWS
- `OLLAMA_ENABLED` - `true`
- `OLLAMA_MODEL` - `llama3.2:1b`
- `NODE_ENV` - `production`
- `DATABASE_URL` - From AWS Secrets Manager
- `REDIS_URL` - From AWS Secrets Manager
- `JWT_SECRET` - From AWS Secrets Manager

## Support

For detailed setup and troubleshooting, refer to:
- GitHub Actions logs
- AWS CloudWatch: `/ecs/truecaller-backend`
- AWS ECS Console: Service status and task failures

---

**Repository Root:** `D:\truecaller-backend\Truecaller\`  
**Backend Directory:** `truecaller-backend/`  
**CI/CD Target:** Backend only  
**Last Updated:** February 16, 2026
