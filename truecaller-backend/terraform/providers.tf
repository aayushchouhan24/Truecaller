terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Optional: Configure remote backend for state management
  # Uncomment and configure after creating S3 bucket and DynamoDB table
  # backend "s3" {
  #   bucket         = "truecaller-terraform-state"
  #   key            = "production/terraform.tfstate"
  #   region         = "eu-central-1"
  #   dynamodb_table = "truecaller-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
