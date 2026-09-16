#!/bin/bash
# Environment Configuration for Lambda Deployment
# Source this file in your deployment scripts

# Default environment
DEPLOY_ENV="${DEPLOY_ENV:-dev}"

# AWS Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-907308712679}"

# Function Names by Environment
case "$DEPLOY_ENV" in
  production|prod)
    FUNCTION_NAME="inspection-report-processor"
    LAYER_NAME="inspection-report-dependencies"
    ENV_LABEL="Production"
    ;;
  staging|stage)
    FUNCTION_NAME="inspection-report-processor-staging"
    LAYER_NAME="inspection-report-dependencies-staging"
    ENV_LABEL="Staging"
    ;;
  dev|development)
    FUNCTION_NAME="inspection-report-processor-dev"
    LAYER_NAME="inspection-report-dependencies-dev"
    ENV_LABEL="Development"
    ;;
  *)
    echo "❌ Invalid environment: $DEPLOY_ENV"
    echo "Valid options: dev, staging, production"
    exit 1
    ;;
esac

# Export variables
export FUNCTION_NAME
export LAYER_NAME
export AWS_REGION
export AWS_ACCOUNT_ID
export DEPLOY_ENV
export ENV_LABEL

# Python version
export PYTHON_VERSION="python3.11"

# Display environment info
display_env_info() {
  echo "Environment: $ENV_LABEL ($DEPLOY_ENV)"
  echo "Function: $FUNCTION_NAME"
  echo "Layer: $LAYER_NAME"
  echo "Region: $AWS_REGION"
}
