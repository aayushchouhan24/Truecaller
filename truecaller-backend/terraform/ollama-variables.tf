# ============================================================
# Ollama Configuration Variables
# ============================================================

variable "ollama_port" {
  description = "Port that Ollama listens on"
  type        = number
  default     = 11434
}

variable "ollama_cpu" {
  description = "CPU units for Ollama container (1024=1vCPU, 2048=2vCPU, 4096=4vCPU)"
  type        = number
  default     = 2048  # 2 vCPU - recommended for Llama 3.2 1B
}

variable "ollama_memory" {
  description = "Memory (MB) for Ollama container (minimum 2048 for 1B model)"
  type        = number
  default     = 4096  # 4 GB - recommended for Llama 3.2 1B
}

variable "ollama_image_tag" {
  description = "Docker image tag for Ollama"
  type        = string
  default     = "latest"
}

variable "ollama_model" {
  description = "Ollama model to use (must match pre-pulled model in Dockerfile)"
  type        = string
  default     = "llama3.2:1b"
}

variable "ollama_desired_count" {
  description = "Desired number of Ollama tasks"
  type        = number
  default     = 1
}

variable "ollama_min_capacity" {
  description = "Minimum number of Ollama tasks for autoscaling"
  type        = number
  default     = 1
}

variable "ollama_max_capacity" {
  description = "Maximum number of Ollama tasks for autoscaling"
  type        = number
  default     = 2  # Conservative for cost
}

variable "ollama_health_check_grace_period" {
  description = "Seconds to wait before starting Ollama health checks (allow model loading)"
  type        = number
  default     = 300  # 5 minutes - allows Ollama to fully start and load model
}

variable "ollama_num_parallel" {
  description = "Number of parallel requests Ollama can handle"
  type        = number
  default     = 2
}

variable "ollama_keep_alive" {
  description = "How long to keep model loaded in memory (e.g., '5m', '10m')"
  type        = string
  default     = "5m"
}

variable "enable_ollama_autoscaling" {
  description = "Enable auto scaling for Ollama service"
  type        = bool
  default     = false  # Start with manual scaling for cost control
}

variable "ollama_cpu_target_value" {
  description = "Target CPU utilization percentage for Ollama autoscaling"
  type        = number
  default     = 75
}

variable "ollama_memory_target_value" {
  description = "Target memory utilization percentage for Ollama autoscaling"
  type        = number
  default     = 85
}
