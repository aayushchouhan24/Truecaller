# ============================================================
# Outputs
# ============================================================

# Networking Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = aws_subnet.private[*].id
}

output "nat_gateway_public_ip" {
  description = "Public IP of the NAT Gateway (for whitelisting)"
  value       = aws_eip.nat.public_ip
}

# ALB Outputs
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer (for Route53)"
  value       = aws_lb.main.zone_id
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.main.arn
}

output "alb_url" {
  description = "URL to access the application via ALB"
  value       = var.enable_https ? "https://${aws_lb.main.dns_name}" : "http://${aws_lb.main.dns_name}"
}

# Ollama ALB Outputs
output "ollama_alb_dns_name" {
  description = "DNS name of the Ollama Application Load Balancer"
  value       = aws_lb.ollama.dns_name
}

output "ollama_alb_url" {
  description = "URL to access Ollama via ALB"
  value       = "http://${aws_lb.ollama.dns_name}"
}

output "ollama_alb_arn" {
  description = "ARN of the Ollama Application Load Balancer"
  value       = aws_lb.ollama.arn
}

output "target_group_arn" {
  description = "ARN of the target group"
  value       = aws_lb_target_group.main.arn
}

# ECR Outputs
output "ecr_repository_url" {
  description = "URL of the ECR repository"
  value       = aws_ecr_repository.main.repository_url
}

output "ecr_repository_name" {
  description = "Name of the ECR repository"
  value       = aws_ecr_repository.main.name
}

output "ecr_repository_arn" {
  description = "ARN of the ECR repository"
  value       = aws_ecr_repository.main.arn
}

# ECS Outputs
output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_id" {
  description = "ID of the ECS cluster"
  value       = aws_ecs_cluster.main.id
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_service_name" {
  description = "Name of the ECS service"
  value       = aws_ecs_service.main.name
}

output "ecs_task_definition_family" {
  description = "Family name of the ECS task definition"
  value       = aws_ecs_task_definition.main.family
}

output "ecs_task_definition_arn" {
  description = "ARN of the ECS task definition"
  value       = aws_ecs_task_definition.main.arn
}

# Security Group Outputs
output "alb_security_group_id" {
  description = "ID of the ALB security group"
  value       = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  description = "ID of the ECS tasks security group"
  value       = aws_security_group.ecs_tasks.id
}

# IAM Outputs
output "ecs_task_execution_role_arn" {
  description = "ARN of the ECS task execution role"
  value       = aws_iam_role.ecs_task_execution_role.arn
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task role"
  value       = aws_iam_role.ecs_task_role.arn
}

# Secrets Manager Outputs
output "secrets_manager_arns" {
  description = "ARNs of Secrets Manager secrets"
  value = {
    database_url         = aws_secretsmanager_secret.database_url.arn
    redis_url            = aws_secretsmanager_secret.redis_url.arn
    jwt_secret           = aws_secretsmanager_secret.jwt_secret.arn
    firebase_credentials = aws_secretsmanager_secret.firebase_credentials.arn
  }
}

output "secrets_manager_names" {
  description = "Names of Secrets Manager secrets"
  value = {
    database_url         = aws_secretsmanager_secret.database_url.name
    redis_url            = aws_secretsmanager_secret.redis_url.name
    jwt_secret           = aws_secretsmanager_secret.jwt_secret.arn
    firebase_credentials = aws_secretsmanager_secret.firebase_credentials.name
  }
}

# CloudWatch Logs Outputs
output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch Logs group"
  value       = aws_cloudwatch_log_group.ecs.name
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the CloudWatch Logs group"
  value       = aws_cloudwatch_log_group.ecs.arn
}

# Region and Account Outputs
output "aws_region" {
  description = "AWS region"
  value       = data.aws_region.current.name
}

output "aws_account_id" {
  description = "AWS account ID"
  value       = data.aws_caller_identity.current.account_id
}

# Deployment Instructions Output
output "deployment_instructions" {
  description = "Quick reference for deployment commands"
  value       = <<-EOT
    
    ========================================
    Deployment Instructions
    ========================================
    
    1. Populate Secrets in AWS Secrets Manager:
       aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.database_url.name} --secret-string "postgresql://user:pass@host:5432/db?sslmode=require"
       aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.redis_url.name} --secret-string "rediss://user:pass@host:6379"
       aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.jwt_secret.name} --secret-string "your-random-jwt-secret"
       aws secretsmanager put-secret-value --secret-id ${aws_secretsmanager_secret.firebase_credentials.name} --secret-string file://firebase-service-account.json
    
    2. Build and Push Docker Images:
       # Backend
       aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.main.repository_url}
       docker build -t ${var.app_name} .
       docker tag ${var.app_name}:latest ${aws_ecr_repository.main.repository_url}:latest
       docker push ${aws_ecr_repository.main.repository_url}:latest
       
       # Ollama
       docker build -t ${var.app_name}-ollama -f Dockerfile.ollama .
       docker tag ${var.app_name}-ollama:latest ${aws_ecr_repository.ollama.repository_url}:latest
       docker push ${aws_ecr_repository.ollama.repository_url}:latest
    
    3. Force New Deployment:
       aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.main.name} --force-new-deployment
       aws ecs update-service --cluster ${aws_ecs_cluster.main.name} --service ${aws_ecs_service.ollama.name} --force-new-deployment
    
    4. Access Application:
       Backend: ${var.enable_https ? "https://${aws_lb.main.dns_name}/api" : "http://${aws_lb.main.dns_name}/api"}
       Ollama: http://ollama.${var.app_name}.local:${var.ollama_port} (internal only)
    
    5. View Logs:
       aws logs tail ${aws_cloudwatch_log_group.ecs.name} --follow
       aws logs tail ${aws_cloudwatch_log_group.ollama.name} --follow
    
    ========================================
  EOT
}

# ============================================================
# Ollama Service Outputs
# ============================================================

output "ollama_ecr_repository_url" {
  description = "URL of the Ollama ECR repository"
  value       = aws_ecr_repository.ollama.repository_url
}

output "ollama_ecr_repository_name" {
  description = "Name of the Ollama ECR repository"
  value       = aws_ecr_repository.ollama.name
}

output "ollama_service_name" {
  description = "Name of the Ollama ECS service"
  value       = aws_ecs_service.ollama.name
}

output "ollama_task_definition_family" {
  description = "Family name of the Ollama ECS task definition"
  value       = aws_ecs_task_definition.ollama.family
}

output "ollama_security_group_id" {
  description = "ID of the Ollama security group"
  value       = aws_security_group.ollama.id
}

output "ollama_service_discovery_url" {
  description = "Internal URL for Ollama service (via Cloud Map)"
  value       = "http://ollama.${var.app_name}.local:${var.ollama_port}"
}

output "service_discovery_namespace_id" {
  description = "ID of the service discovery namespace"
  value       = aws_service_discovery_private_dns_namespace.main.id
}

output "service_discovery_namespace_name" {
  description = "Name of the service discovery namespace"
  value       = aws_service_discovery_private_dns_namespace.main.name
}

output "ollama_cloudwatch_log_group_name" {
  description = "Name of the Ollama CloudWatch Logs group"
  value       = aws_cloudwatch_log_group.ollama.name
}

