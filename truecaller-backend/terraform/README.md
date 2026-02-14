# Truecaller Backend - AWS ECS Fargate Deployment

Production-ready Terraform configuration for deploying the Truecaller backend API on AWS using ECS Fargate, Application Load Balancer, and managed external services (Neon PostgreSQL & Aiven Redis).

## Architecture Overview

```
Internet
    │
    ▼
Application Load Balancer (Public Subnets)
    │
    ▼
ECS Fargate Tasks (Private Subnets)
    │
    ├─► NAT Gateway ──► Internet
    │                    │
    │                    ├─► ECR (Docker Images)
    │                    ├─► Neon PostgreSQL
    │                    ├─► Aiven Redis
    │                    └─► Firebase APIs
    │
    └─► AWS Secrets Manager (Credentials)
```

### Key Components

- **VPC**: Dedicated VPC with public/private subnets across 2 AZs
- **ALB**: Application Load Balancer for HTTPS/HTTP traffic distribution
- **ECS Fargate**: Serverless container execution (0.5 vCPU, 1 GB RAM)
- **ECR**: Private Docker registry for container images
- **Secrets Manager**: Secure credential storage
- **CloudWatch Logs**: Centralized logging with 7-day retention
- **NAT Gateway**: Outbound internet access for private subnets
- **External Services**: Neon (PostgreSQL), Aiven (Redis)

## Prerequisites

1. **AWS CLI** (v2.x)
   ```bash
   aws --version
   ```

2. **Terraform** (>= 1.0)
   ```bash
   terraform version
   ```

3. **Docker** (for building images)
   ```bash
   docker --version
   ```

4. **AWS Credentials** configured
   ```bash
   aws configure
   # Or use environment variables:
   # export AWS_ACCESS_KEY_ID="your-key"
   # export AWS_SECRET_ACCESS_KEY="your-secret"
   ```

5. **External Services**:
   - Neon PostgreSQL database URL
   - Aiven Redis connection URL
   - Firebase service account JSON file

## Quick Start

### 1. Initial Setup

```bash
cd terraform
terraform init
```

### 2. Review and Customize Configuration

Edit `terraform.tfvars` to customize deployment:

```hcl
aws_region  = "eu-central-1"
app_name    = "truecaller-backend"
environment = "production"

# Container resources
container_cpu    = 512  # 0.5 vCPU
container_memory = 1024 # 1 GB

# Scaling
desired_count      = 1
enable_autoscaling = false  # Set to true for production
```

### 3. Plan Deployment

```bash
terraform plan
```

Review the planned changes (~40 resources).

### 4. Deploy Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. Deployment takes ~5-7 minutes.

### 5. Setup Database Schema

**Important**: Ensure your Neon PostgreSQL database has the schema set up before deploying.

**For new/empty database:**
```bash
# Set DATABASE_URL environment variable
export DATABASE_URL="postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/truecaller?sslmode=require"

# Run Prisma migrations from project root
cd ..
npx prisma migrate deploy
cd terraform
```

**For existing database with schema:**
Verify the schema matches `prisma/schema.prisma`. No action needed.

**Note**: The Docker container does NOT run migrations on startup. This prevents failures on container restarts and follows production best practices.

### 6. Populate Secrets

**Critical**: Secrets are created empty. Populate them with actual values:

```bash
# Database URL (Neon PostgreSQL)
aws secretsmanager put-secret-value \
  --secret-id truecaller/database-url \
  --secret-string "postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/truecaller?sslmode=require"

# Redis URL (Aiven)
aws secretsmanager put-secret-value \
  --secret-id truecaller/redis-url \
  --secret-string "rediss://default:password@redis-xxx.aivencloud.com:12345"

# JWT Secret (generate strong random string)
aws secretsmanager put-secret-value \
  --secret-id truecaller/jwt-secret \
  --secret-string "$(openssl rand -base64 64 | tr -d '\n')"

# Firebase Service Account (from JSON file)
aws secretsmanager put-secret-value \
  --secret-id truecaller/firebase-credentials \
  --secret-string file://../firebase-service-account.json
```

### 7. Build and Push Docker Image

Get ECR repository URL from Terraform output:

```bash
export ECR_URL=$(terraform output -raw ecr_repository_url)
export AWS_REGION=$(terraform output -raw aws_region)
export AWS_ACCOUNT=$(terraform output -raw aws_account_id)

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com

# Build image (from project root)
cd ..
docker build -t truecaller-backend:latest .

# Tag and push
docker tag truecaller-backend:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

### 8. Deploy Application

Force ECS to deploy the new image:

```bash
cd terraform
export CLUSTER_NAME=$(terraform output -raw ecs_cluster_name)
export SERVICE_NAME=$(terraform output -raw ecs_service_name)

aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment
```

### 9. Monitor Deployment

```bash
# Watch service status
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SERVICE_NAME \
  --query 'services[0].deployments' \
  --output table

# Stream logs
export LOG_GROUP=$(terraform output -raw cloudwatch_log_group_name)
aws logs tail $LOG_GROUP --follow
```

### 10. Test Application

```bash
export ALB_URL=$(terraform output -raw alb_dns_name)

# Test API endpoint
curl http://$ALB_URL/api

# Test health
curl http://$ALB_URL/api/health

# Check specific endpoint
curl http://$ALB_URL/api/auth/verify-otp
```

## Terraform Commands Reference

| Command | Description |
|---------|-------------|
| `terraform init` | Initialize Terraform and download providers |
| `terraform plan` | Preview changes without applying |
| `terraform apply` | Apply changes to infrastructure |
| `terraform destroy` | Destroy all managed infrastructure |
| `terraform output` | Show all output values |
| `terraform output -raw <name>` | Get specific output value |
| `terraform state list` | List all resources in state |
| `terraform fmt` | Format Terraform files |
| `terraform validate` | Validate configuration syntax |

## Post-Deployment Operations

### Update Application (New Code)

```bash
# 1. Build and push new image
docker build -t truecaller-backend:latest .
docker tag truecaller-backend:latest $ECR_URL:latest
docker push $ECR_URL:latest

# 2. Force new deployment
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment
```

### Scale ECS Service

```bash
# Scale to 3 tasks
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --desired-count 3
```

Or update `terraform.tfvars`:
```hcl
desired_count = 3
```
Then run `terraform apply`.

### View Container Logs

```bash
# Tail logs
aws logs tail /ecs/truecaller-backend --follow

# Get last 100 lines
aws logs tail /ecs/truecaller-backend --since 10m

# Filter logs
aws logs tail /ecs/truecaller-backend --filter-pattern "ERROR"
```

### SSH into Running Container (Debug)

```bash
# List running tasks
aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME

# Execute command in container
export TASK_ARN=<task-arn-from-above>
aws ecs execute-command \
  --cluster $CLUSTER_NAME \
  --task $TASK_ARN \
  --container truecaller-backend \
  --interactive \
  --command "/bin/sh"
```

### Update Environment Variables

Edit task definition in `main.tf` (environment section), then:
```bash
terraform apply
```

### Update Secrets

```bash
# Update database URL
aws secretsmanager update-secret \
  --secret-id truecaller/database-url \
  --secret-string "new-connection-string"

# Restart service to pick up new secret
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment
```

## Cost Estimation

Approximate monthly costs (us-east-1 pricing):

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| ECS Fargate | 1 task (0.5 vCPU, 1 GB) | ~$15 |
| ALB | Standard | ~$16 |
| NAT Gateway | Single AZ | ~$32 |
| NAT Gateway Data | 100 GB | ~$5 |
| CloudWatch Logs | 5 GB ingestion | ~$2.50 |
| Secrets Manager | 4 secrets | ~$1.60 |
| ECR Storage | 2 GB images | ~$0.20 |
| **Total** | | **~$72/month** |

**Note**: Costs vary by region and usage. Neon and Aiven costs not included (external).

### Cost Optimization Tips

1. **Remove NAT Gateway** (accept public IP on ECS tasks):
   - Saves ~$32/month
   - Less secure (tasks directly exposed)
   - Update `main.tf`: `assign_public_ip = true` in private subnets

2. **Use external managed DB/Redis** (current setup):
   - Neon free tier: 0.5 GB storage
   - Aiven free tier: 100 MB Redis
   - Saves RDS/ElastiCache costs ($15-50+/month)

3. **Reduce log retention**:
   - Set `log_retention_days = 1` (saves ~$1.50/month)

4. **Use Fargate Spot** (for non-production):
   - 70% discount on compute
   - Risk of interruption

## Monitoring and Observability

### CloudWatch Dashboards

Create custom dashboard in AWS Console:
1. Navigate to CloudWatch > Dashboards
2. Add widgets for:
   - ECS CPU/Memory utilization
   - ALB request count and latency
   - Target health status
   - Container insights metrics

### Alarms

Set up CloudWatch Alarms:

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name truecaller-high-cpu \
  --alarm-description "Alert when CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

### Application Insights

Enable Container Insights (already configured in Terraform):
1. Navigate to CloudWatch > Container Insights
2. View cluster/service metrics
3. Analyze performance bottlenecks

## Security Best Practices

- ✅ **Private subnets** for ECS tasks
- ✅ **Secrets Manager** for credentials
- ✅ **Security groups** with least privilege
- ✅ **ECR image scanning** enabled
- ✅ **CloudWatch Logs** encrypted by default
- ✅ **HTTPS** support (configure certificate_arn)
- ✅ **IAM roles** with minimal permissions
- ⚠️ **Enable WAF** for ALB (not included, add separately)
- ⚠️ **Setup VPC Flow Logs** (not included)

### Enable HTTPS

1. Request ACM certificate in AWS Console or:
   ```bash
   aws acm request-certificate \
     --domain-name api.yourdomain.com \
     --validation-method DNS
   ```

2. Validate domain ownership (add DNS records)

3. Update `terraform.tfvars`:
   ```hcl
   enable_https    = true
   certificate_arn = "arn:aws:acm:region:account:certificate/xxx"
   ```

4. Apply changes:
   ```bash
   terraform apply
   ```

## Troubleshooting

### Tasks Not Starting

**Check task logs**:
```bash
aws logs tail /ecs/truecaller-backend --since 5m
```

**Common issues**:
- Missing/invalid secrets → Check Secrets Manager values
- Database unreachable → Verify security groups and Neon whitelist
- Image pull errors → Verify ECR permissions
- Health check failures → Check `/api` endpoint response

### ALB Health Checks Failing

```bash
# Check target health
aws elbv2 describe-target-health \
  --target-group-arn $(terraform output -raw target_group_arn)
```

**Common causes**:
- Container not listening on port 3000
- Health check path `/api` returning non-200
- Security group blocking ALB → ECS traffic
- Database migrations taking too long (increase `health_check_grace_period`)

### Database Connection Issues

**Verify DATABASE_URL**:
```bash
aws secretsmanager get-secret-value \
  --secret-id truecaller/database-url \
  --query SecretString \
  --output text
```

**Check connectivity from task**:
1. Get task ID
2. Execute command:
   ```bash
   aws ecs execute-command \
     --cluster $CLUSTER_NAME \
     --task $TASK_ARN \
     --container truecaller-backend \
     --interactive \
     --command "wget -O- https://example.com"
   ```

### High Costs

**Check NAT Gateway data transfer**:
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/NATGateway \
  --metric-name BytesOutToDestination \
  --dimensions Name=NatGatewayId,Value=<nat-id> \
  --start-time 2026-02-01T00:00:00Z \
  --end-time 2026-02-13T00:00:00Z \
  --period 86400 \
  --statistics Sum
```

## CI/CD Integration

### GitHub Actions Example

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to AWS ECS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-central-1
      
      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1
      
      - name: Build and push image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: truecaller-backend
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
      
      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster truecaller-backend-cluster \
            --service truecaller-backend-service \
            --force-new-deployment
```

## Cleanup / Undeploying

**Warning**: This will destroy all infrastructure and cannot be undone!

### Option 1: Use Undeploy Script (Recommended)

```powershell
# Windows
cd ..
.\scripts\undeploy.ps1

# Linux/Mac
cd ..
./scripts/undeploy.sh
```

**Features:**
- Shows exactly what will be destroyed
- Checks for running tasks
- Requires "DESTROY" confirmation
- Double confirmation before proceeding
- Optional force-delete secrets
- Safe and guided process

### Option 2: Manual Terraform Destroy

```bash
# 1. Backup important data first!

# 2. Preview what will be destroyed
terraform plan -destroy

# 3. Destroy Terraform resources
terraform destroy

# 4. Manually delete secrets if needed (optional)
cd ..
aws secretsmanager delete-secret --secret-id truecaller/database-url --force-delete-without-recovery --region eu-central-1
aws secretsmanager delete-secret --secret-id truecaller/redis-url --force-delete-without-recovery --region eu-central-1
aws secretsmanager delete-secret --secret-id truecaller/jwt-secret --force-delete-without-recovery --region eu-central-1
aws secretsmanager delete-secret --secret-id truecaller/firebase-credentials --force-delete-without-recovery --region eu-central-1
```

### What Gets Destroyed

- ✅ All 35 AWS resources
- ✅ ECS cluster, service, and tasks
- ✅ Application Load Balancer
- ✅ ECR repository and all images
- ✅ VPC, subnets, NAT Gateway
- ✅ Security groups
- ✅ IAM roles and policies
- ✅ CloudWatch Logs (permanently deleted)
- ✅ Secrets Manager secrets (30-day recovery unless force-deleted)

### What Is NOT Affected

- ⬜ Neon PostgreSQL database (external)
- ⬜ Aiven Redis (external)
- ⬜ Your source code
- ⬜ Firebase project

### Cost Savings

After undeploying: **~$60-65/month savings**

## Additional Resources

- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/)
- [Fargate Pricing](https://aws.amazon.com/fargate/pricing/)

## Support

For issues or questions:
1. Check application logs in CloudWatch
2. Review Terraform plan output
3. Verify all secrets are populated correctly
4. Check AWS service quotas and limits

## License

This Terraform configuration is part of the Truecaller Backend project.
