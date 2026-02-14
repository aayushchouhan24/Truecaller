# Quick Start Guide - Truecaller Backend AWS Deployment

## 🚀 Deploy in 5 Steps

### Prerequisites
- AWS CLI configured with credentials
- Terraform >= 1.0
- Docker Desktop running
- Neon PostgreSQL URL
- Aiven Redis URL
- Firebase service account JSON file

---

### Step 1: Initialize Terraform

```bash
cd terraform
terraform init
```

---

### Step 2: Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. Wait ~5 minutes.

---

### Step 3: Setup Database Schema

**Important**: Ensure your Neon PostgreSQL database has the schema set up.

**Option A: If database is empty, run migrations:**
```bash
# Set your DATABASE_URL environment variable
export DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"

# Run Prisma migrations
npx prisma migrate deploy
```

**Option B: If database already has schema:**
Skip this step - the application will connect to existing tables.

---

### Step 4: Populate Secrets

**Option A: Use the script (Windows)**
```powershell
.\scripts\populate-secrets.ps1
```

**Option B: Use the script (Linux/Mac)**
```bash
chmod +x scripts/populate-secrets.sh
./scripts/populate-secrets.sh
```

**Option C: Manual (AWS CLI)**
```bash
# Database URL
aws secretsmanager put-secret-value \
  --secret-id truecaller/database-url \
  --secret-string "postgresql://user:pass@host:5432/db?sslmode=require"

# Redis URL
aws secretsmanager put-secret-value \
  --secret-id truecaller/redis-url \
  --secret-string "rediss://user:pass@host:6379"

# JWT Secret
aws secretsmanager put-secret-value \
  --secret-id truecaller/jwt-secret \
  --secret-string "your-random-secret-string"

# Firebase Credentials
aws secretsmanager put-secret-value \
  --secret-id truecaller/firebase-credentials \
  --secret-string file://firebase-service-account.json
```

---

### Step 5: Build & Push Docker Image

```bash
# Get ECR URL
cd terraform
export ECR_URL=$(terraform output -raw ecr_repository_url)
export AWS_REGION=$(terraform output -raw aws_region)
cd ..

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin ${ECR_URL%/*}

# Build and push
docker build -t truecaller-backend:latest .
docker tag truecaller-backend:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

**Windows PowerShell:**
```powershell
cd terraform
$ECR_URL = terraform output -raw ecr_repository_url
$AWS_REGION = terraform output -raw aws_region
cd ..

aws ecr get-login-password --region $AWS_REGION | `
  docker login --username AWS --password-stdin $ECR_URL.Split('/')[0]

docker build -t truecaller-backend:latest .
docker tag truecaller-backend:latest ${ECR_URL}:latest
docker push ${ECR_URL}:latest
```

---

### Step 5: Deploy Application

```bash
cd terraform
export CLUSTER=$(terraform output -raw ecs_cluster_name)
export SERVICE=$(terraform output -raw ecs_service_name)

aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --force-new-deployment
```

**Windows PowerShell:**
```powershell
cd terraform
$CLUSTER = terraform output -raw ecs_cluster_name
$SERVICE = terraform output -raw ecs_service_name

aws ecs update-service `
  --cluster $CLUSTER `
  --service $SERVICE `
  --force-new-deployment
```

---

## ✅ Verify Deployment

### Get Application URL
```bash
cd terraform
terraform output alb_url
```

### Test API
```bash
export ALB_URL=$(terraform output -raw alb_dns_name)
curl http://$ALB_URL/api
```

### View Logs
```bash
aws logs tail /ecs/truecaller-backend --follow
```

### Check Service Status
```bash
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --query 'services[0].deployments'
```

---

## 🔄 Update Application (New Code)

```bash
# 1. Build new image
docker build -t truecaller-backend:latest .

# 2. Push to ECR
docker tag truecaller-backend:latest $ECR_URL:latest
docker push $ECR_URL:latest

# 3. Force deployment
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --force-new-deployment
```

---

## 🛠️ Automated Deployment Scripts

**Windows:**
```powershell
# Full deployment
.\scripts\deploy.ps1

# Just secrets
.\scripts\populate-secrets.ps1
```

**Linux/Mac:**
```bash
# Full deployment
./scripts/deploy.sh

# Just secrets
./scripts/populate-secrets.sh
```

---

## 📊 Monitoring

### CloudWatch Logs
```bash
aws logs tail /ecs/truecaller-backend --follow --since 10m
```

### ECS Service Events
```bash
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --query 'services[0].events[:5]'
```

### Container Status
```bash
aws ecs list-tasks --cluster $CLUSTER --service-name $SERVICE
```

---

## 🧹 Cleanup

**⚠️ Warning: This destroys all infrastructure!**

```bash
cd terraform
terraform destroy
```

Type `yes` when prompted.

---

## 💰 Estimated Costs

- **ECS Fargate (1 task)**: ~$15/month
- **Application Load Balancer**: ~$16/month
- **NAT Gateway**: ~$32/month
- **CloudWatch Logs**: ~$2.50/month
- **Secrets Manager**: ~$1.60/month
- **ECR Storage**: ~$0.20/month

**Total: ~$67-72/month**

> External services (Neon, Aiven) not included

---

## 🆘 Troubleshooting

### Tasks not starting?
```bash
# Check logs
aws logs tail /ecs/truecaller-backend --since 5m

# Check task definition
aws ecs describe-task-definition --task-definition truecaller-backend
```

### Health checks failing?
```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn $(cd terraform && terraform output -raw target_group_arn)
```

### Secrets not loading?
```bash
# Verify secret exists and has value
aws secretsmanager get-secret-value --secret-id truecaller/database-url
```

---

## 📚 More Info

See [terraform/README.md](terraform/README.md) for comprehensive documentation.

---

## 🎯 Architecture

```
Internet → ALB → ECS Fargate (Private Subnets) → NAT Gateway → External Services
                     ↓
           AWS Secrets Manager
                     ↓
           CloudWatch Logs
```

**Key Features:**
- ✅ Private subnets for security
- ✅ Auto-restart on failure
- ✅ Health checks enabled
- ✅ Centralized logging
- ✅ Secrets management
- ✅ Auto-scaling ready

---

**Need help?** Check the full [README](terraform/README.md) or application logs.

---

## 🗑️ Undeploying

**To destroy all AWS resources and stop monthly charges:**

```powershell
# Windows
.\scripts\undeploy.ps1

# Linux/Mac
./scripts/undeploy.sh

# Or manually
cd terraform
terraform destroy
```

**What gets deleted:**
- ✅ All AWS infrastructure (~35 resources)
- ✅ Stops ~$60-65/month in costs
- ✅ Your Neon database and Aiven Redis are NOT affected
- ⚠️ CloudWatch logs permanently deleted
- ⚠️ ECR images permanently deleted

**Safety:** The script requires typing "DESTROY" and confirms twice before proceeding.

