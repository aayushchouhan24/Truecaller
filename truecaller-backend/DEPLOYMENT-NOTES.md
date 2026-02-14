# Deployment Notes - Production Best Practices

This document captures important lessons learned during the production deployment of the Truecaller backend to AWS ECS Fargate.

## Critical Production Deployment Guidelines

### 1. Database Migrations - IMPORTANT ⚠️

**DO NOT run database migrations on container startup in production!**

**Why?**
- Migrations should run once, not on every container restart
- Multiple containers might try to run migrations simultaneously, causing conflicts
- Failed migrations can prevent containers from starting, blocking deployments
- Existing production databases may have schema drift that prevents migration tools from running

**Correct Approach:**

#### For New/Empty Database:
```bash
# Set your DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"

# Run migrations ONCE before first deployment
npx prisma migrate deploy
```

#### For Existing Production Database:
```bash
# Use Prisma's introspection to ensure schema matches
npx prisma db pull

# OR manually verify schema matches prisma/schema.prisma
# OR use db push for prototyping (NOT recommended for production with data)
```

#### Current Dockerfile Configuration:
```dockerfile
# Dockerfile just starts the application - NO migrations
CMD ["node", "dist/src/main"]
```

This ensures:
- ✅ Fast container startup
- ✅ No migration conflicts with multiple containers
- ✅ Deployments don't fail due to migration issues
- ✅ Database changes are controlled and deliberate

### 2. Container Startup Sequence

**Recommended Production Pattern:**

```mermaid
graph TD
    A[Deploy Infrastructure] --> B[Create Secrets]
    B --> C[Run Database Migrations]
    C --> D[Build Docker Image]
    D --> E[Push to ECR]
    E --> F[Deploy ECS Service]
    F --> G[Container Starts]
    G --> H[Health Checks Pass]
    H --> I[Traffic Routes to Container]
```

### 3. Secrets Management

**All secrets MUST be populated before first deployment:**

```bash
# Check if secrets exist and have values
aws secretsmanager get-secret-value --secret-id truecaller/database-url
aws secretsmanager get-secret-value --secret-id truecaller/redis-url
aws secretsmanager get-secret-value --secret-id truecaller/jwt-secret
aws secretsmanager get-secret-value --secret-id truecaller/firebase-credentials
```

Empty secrets will cause container startup failures with `ResourceInitializationError`.

### 4. Database Schema Updates

**For Future Schema Changes:**

1. **Test migrations locally first:**
   ```bash
   # Create migration
   npx prisma migrate dev --name descriptive_name
   
   # Test rollback capability
   ```

2. **Apply to production database:**
   ```bash
   # Backup database first!
   # Then apply migrations
   export DATABASE_URL="production-url"
   npx prisma migrate deploy
   ```

3. **Then deploy new application version:**
   ```bash
   # Build new image with updated Prisma schema
   docker build -t truecaller-backend:latest .
   
   # Push and deploy
   ./scripts/deploy.ps1
   ```

### 5. Zero-Downtime Deployments

Current configuration supports rolling deployments:
- `minimumHealthyPercent: 100` - Keeps old tasks running
- `maximumPercent: 200` - Starts new tasks before stopping old
- `healthCheckGracePeriodSeconds: 120` - Time for app to start

**Deployment Process:**
1. New task starts with new image
2. Health checks must pass
3. New task registers with ALB
4. Old task deregisters and stops
5. Zero downtime achieved

### 6. Troubleshooting Common Issues

#### Container Won't Start
```bash
# Check service events
aws ecs describe-services \
  --cluster truecaller-backend-cluster \
  --services truecaller-backend-service \
  --query 'services[0].events[:5]'

# Check container logs
aws logs tail /ecs/truecaller-backend --follow
```

#### Migration Errors
```
Error: P3005 - The database schema is not empty
```
**Solution**: Use `npx prisma db push` for existing databases OR ensure migrations are up to date.

```
Error: P1014 - The underlying table for model X does not exist
```
**Solution**: Run `npx prisma migrate deploy` to create missing tables.

#### Image Not Found
```
CannotPullContainerError: 329599656829.dkr.ecr.eu-central-1.amazonaws.com/truecaller-backend:latest: not found
```
**Solution**: Ensure image is built and pushed before deployment:
```bash
docker build -t truecaller-backend:latest .
docker tag truecaller-backend:latest $ECR_URL:latest
docker push $ECR_URL:latest
```

### 7. Monitoring and Logging

**View Live Logs:**
```bash
aws logs tail /ecs/truecaller-backend --follow --region eu-central-1
```

**Check Application Health:**
```bash
# Get ALB URL
ALB_URL=$(cd terraform && terraform output -raw alb_dns_name)

# Test endpoint
curl http://$ALB_URL/api/auth/login
```

**Monitor ECS Service:**
```bash
watch -n 5 'aws ecs describe-services \
  --cluster truecaller-backend-cluster \
  --services truecaller-backend-service \
  --query "services[0].{Running:runningCount,Pending:pendingCount,Desired:desiredCount}"'
```

### 8. Deployment Checklist

Before each deployment:

- [ ] Database migrations tested locally
- [ ] Database migrations applied to production (if schema changed)
- [ ] All secrets populated in AWS Secrets Manager
- [ ] Docker image builds successfully
- [ ] Image pushed to ECR
- [ ] No breaking changes in API
- [ ] Health check endpoint working
- [ ] CloudWatch logs monitoring ready

### 9. Rollback Procedure

If deployment fails:

```bash
# Option 1: Rollback to previous task definition
aws ecs update-service \
  --cluster truecaller-backend-cluster \
  --service truecaller-backend-service \
  --task-definition truecaller-backend:PREVIOUS_REVISION

# Option 2: Push previous Docker image
docker pull $ECR_URL:previous-tag
docker tag $ECR_URL:previous-tag $ECR_URL:latest
docker push $ECR_URL:latest
aws ecs update-service --cluster truecaller-backend-cluster \
  --service truecaller-backend-service --force-new-deployment
```

### 10. Cost Optimization

**Current Setup:**
- ECS Fargate: 0.5 vCPU, 1GB RAM = ~$12-15/month (eu-central-1)
- ALB: ~$16/month + data transfer
- NAT Gateway: ~$32/month + data transfer
- Secrets Manager: $0.40/secret/month = $1.60/month
- CloudWatch Logs: Minimal (7-day retention)
- ECR: $0.10/GB/month (minimal for one image)

**Total Estimated Cost: ~$60-65/month**

**To Reduce Costs:**
1. Remove NAT Gateway if outbound internet not needed
2. Use VPC Endpoints for AWS services
3. Reduce log retention period
4. Consider Fargate Spot for non-critical workloads

### 11. Undeploying Infrastructure

**To completely destroy all AWS resources:**

```powershell
# Windows
.\scripts\undeploy.ps1

# Linux/Mac
./scripts/undeploy.sh

# Or manually with Terraform
cd terraform
terraform destroy
```

**What happens when you undeploy:**
- ✅ All 35 AWS resources destroyed
- ✅ Monthly costs stop immediately (~$60-65/month saved)
- ✅ Neon PostgreSQL database remains intact (external)
- ✅ Aiven Redis remains intact (external)
- ✅ Secrets marked for deletion (30-day recovery window)
- ⚠️ CloudWatch logs permanently deleted
- ⚠️ ECR images permanently deleted
- ⚠️ Cannot be recovered without redeploying

**Safety features in undeploy scripts:**
- Requires typing "DESTROY" in all caps
- Shows exactly what will be deleted
- Checks for running tasks
- Double confirmation prompt
- Optional force-delete of secrets

---

## Summary

✅ **Database migrations**: Run separately, NOT in container startup  
✅ **Secrets**: Must be populated before deployment  
✅ **Container**: Just runs the application, no migration logic  
✅ **Health checks**: 120s grace period for startup  
✅ **Zero downtime**: Rolling deployments with ALB

**Deployed Application URL:**
```
http://truecaller-backend-alb-1860064785.eu-central-1.elb.amazonaws.com/api
```

**Last Successful Deployment:** February 13, 2026
