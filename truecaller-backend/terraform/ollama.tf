# ============================================================
# Ollama Service Resources
# ============================================================

# ------------------------------------------------------------
# AWS Cloud Map (Service Discovery)
# ------------------------------------------------------------

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.app_name}.local"
  description = "Private DNS namespace for service discovery"
  vpc         = aws_vpc.main.id

  tags = {
    Name = "${var.app_name}-service-discovery"
  }
}

resource "aws_service_discovery_service" "ollama" {
  name = "ollama"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  # No health check - rely on ECS container health and DNS-based discovery only
  # AWS_INIT_HEALTH_STATUS doesn't sync with container health, causing false negatives

  tags = {
    Name = "${var.app_name}-ollama-discovery"
  }
}

# ------------------------------------------------------------
# Ollama Security Group
# ------------------------------------------------------------

resource "aws_security_group" "ollama" {
  name        = "${var.app_name}-ollama-sg"
  description = "Security group for Ollama service - INTERNAL ONLY"
  vpc_id      = aws_vpc.main.id

  # Allow HTTP from backend only
  ingress {
    description     = "Allow HTTP API requests from backend service only"
    from_port       = var.ollama_port
    to_port         = var.ollama_port
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  # Allow all outbound (for model downloads, updates)
  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-ollama-sg"
    Type = "Internal"
  }
}

# ------------------------------------------------------------
# Ollama ECR Repository
# ------------------------------------------------------------

resource "aws_ecr_repository" "ollama" {
  name                 = "${var.app_name}-ollama"
  image_tag_mutability = var.ecr_image_tag_mutability

  image_scanning_configuration {
    scan_on_push = var.ecr_scan_on_push
  }

  tags = {
    Name = "${var.app_name}-ollama-ecr"
  }
}

# ECR Lifecycle Policy for Ollama
resource "aws_ecr_lifecycle_policy" "ollama" {
  repository = aws_ecr_repository.ollama.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last ${var.ecr_lifecycle_count} Ollama images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_lifecycle_count
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# ------------------------------------------------------------
# Ollama CloudWatch Logs
# ------------------------------------------------------------

resource "aws_cloudwatch_log_group" "ollama" {
  name              = "/ecs/${var.app_name}-ollama"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.app_name}-ollama-logs"
  }
}

# ------------------------------------------------------------
# Ollama ECS Task Definition
# ------------------------------------------------------------

resource "aws_ecs_task_definition" "ollama" {
  family                   = "${var.app_name}-ollama"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ollama_cpu
  memory                   = var.ollama_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([{
    name  = "${var.app_name}-ollama"
    image = "${aws_ecr_repository.ollama.repository_url}:${var.ollama_image_tag}"

    portMappings = [{
      containerPort = var.ollama_port
      protocol      = "tcp"
    }]

    environment = [
      {
        name  = "OLLAMA_NUM_PARALLEL"
        value = tostring(var.ollama_num_parallel)
      },
      {
        name  = "OLLAMA_MAX_LOADED_MODELS"
        value = "1"
      },
      {
        name  = "OLLAMA_KEEP_ALIVE"
        value = var.ollama_keep_alive
      },
      {
        name  = "OLLAMA_HOST"
        value = "0.0.0.0:${var.ollama_port}"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ollama.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ollama"
      }
    }

    healthCheck = {
      command = [
        "CMD-SHELL",
        "curl -f http://localhost:${var.ollama_port}/ || exit 1"
      ]
      interval    = 30
      timeout     = 5
      retries     = 5
      startPeriod = 180  # 3 minutes to allow model loading and service startup
    }

    essential = true
  }])

  tags = {
    Name = "${var.app_name}-ollama-task-definition"
  }
}

# ------------------------------------------------------------
# Ollama ECS Service
# ------------------------------------------------------------

resource "aws_ecs_service" "ollama" {
  name            = "${var.app_name}-ollama-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ollama.arn
  desired_count   = var.ollama_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ollama.id]
    assign_public_ip = false  # CRITICAL: No public IP for Ollama
  }

  # Register with Cloud Map for service discovery
  service_registries {
    registry_arn = aws_service_discovery_service.ollama.arn
  }

  # Deployment configuration for zero-downtime
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = var.ollama_health_check_grace_period

  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"

  tags = {
    Name = "${var.app_name}-ollama-service"
    Type = "Internal"
  }

  depends_on = [
    aws_service_discovery_service.ollama
  ]
}

# ------------------------------------------------------------
# Ollama Auto Scaling
# ------------------------------------------------------------

resource "aws_appautoscaling_target" "ollama" {
  count              = var.enable_ollama_autoscaling ? 1 : 0
  max_capacity       = var.ollama_max_capacity
  min_capacity       = var.ollama_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.ollama.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# CPU-based auto scaling for Ollama
resource "aws_appautoscaling_policy" "ollama_cpu" {
  count              = var.enable_ollama_autoscaling ? 1 : 0
  name               = "${var.app_name}-ollama-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ollama[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ollama[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ollama[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.ollama_cpu_target_value
    scale_in_cooldown  = 600  # 10 minutes (conservative)
    scale_out_cooldown = 120  # 2 minutes (account for model loading)
  }
}

# Memory-based auto scaling for Ollama
resource "aws_appautoscaling_policy" "ollama_memory" {
  count              = var.enable_ollama_autoscaling ? 1 : 0
  name               = "${var.app_name}-ollama-memory-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ollama[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ollama[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ollama[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.ollama_memory_target_value
    scale_in_cooldown  = 600
    scale_out_cooldown = 120
  }
}
