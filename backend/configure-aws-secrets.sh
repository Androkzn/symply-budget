#!/bin/bash

# Configure AWS secrets for Cloudflare Workers
# This allows the backend to invoke Lambda functions

set -e

echo "=========================================="
echo "Configuring AWS Secrets for Lambda"
echo "=========================================="
echo ""

LAMBDA_ARN="arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor"
AWS_REGION="us-east-1"

echo "Lambda ARN: $LAMBDA_ARN"
echo "Region: $AWS_REGION"
echo ""
echo "You have 2 active AWS access keys:"
echo "  1. AKIA5GP6QILTZMMGZV2A"
echo "  2. AKIA5GP6QILT32HG6ZNF"
echo ""

# Get AWS Access Key ID
echo "Enter AWS Access Key ID (use one of the keys above):"
read AWS_ACCESS_KEY_ID

# Get AWS Secret Access Key
echo "Enter AWS Secret Access Key (for the key you selected):"
read -s AWS_SECRET_ACCESS_KEY

echo ""
echo "=========================================="
echo "Configuring STAGING environment..."
echo "=========================================="

echo "$LAMBDA_ARN" | wrangler secret put AWS_LAMBDA_ARN --env staging
echo "$AWS_ACCESS_KEY_ID" | wrangler secret put AWS_ACCESS_KEY_ID --env staging
echo "$AWS_SECRET_ACCESS_KEY" | wrangler secret put AWS_SECRET_ACCESS_KEY --env staging
echo "$AWS_REGION" | wrangler secret put AWS_REGION --env staging

echo ""
echo "=========================================="
echo "Configuring PRODUCTION environment..."
echo "=========================================="

echo "$LAMBDA_ARN" | wrangler secret put AWS_LAMBDA_ARN --env production
echo "$AWS_ACCESS_KEY_ID" | wrangler secret put AWS_ACCESS_KEY_ID --env production
echo "$AWS_SECRET_ACCESS_KEY" | wrangler secret put AWS_SECRET_ACCESS_KEY --env production
echo "$AWS_REGION" | wrangler secret put AWS_REGION --env production

echo ""
echo "=========================================="
echo "✅ AWS Secrets Configured!"
echo "=========================================="
echo ""
echo "Secrets have been set for both staging and production."
echo "Lambda invocation should now work!"
