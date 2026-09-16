#!/bin/bash

# Script to set up AWS Lambda secrets for Cloudflare Workers
# Requires Node.js 20+ and wrangler CLI

echo "Setting up AWS Lambda secrets for Cloudflare Workers..."
echo ""
echo "Lambda ARN: arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor"
echo "Region: us-east-1"
echo ""
echo "You'll need:"
echo "1. AWS Access Key ID (you have 2 active keys)"
echo "2. AWS Secret Access Key (for one of those keys)"
echo ""
echo "If you don't have the Secret Access Key, create a new one at:"
echo "https://console.aws.amazon.com/iam/home#/users/simple-house"
echo ""
echo "Press Enter to continue or Ctrl+C to cancel..."
read

# Development environment
echo ""
echo "=== Setting up DEVELOPMENT environment ==="
echo "Enter Lambda ARN (or press Enter for default):"
read LAMBDA_ARN
LAMBDA_ARN=${LAMBDA_ARN:-arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor}
echo "$LAMBDA_ARN" | wrangler secret put AWS_LAMBDA_ARN

echo "Enter AWS Access Key ID:"
read AWS_KEY_ID
echo "$AWS_KEY_ID" | wrangler secret put AWS_ACCESS_KEY_ID

echo "Enter AWS Secret Access Key:"
read -s AWS_SECRET
echo "$AWS_SECRET" | wrangler secret put AWS_SECRET_ACCESS_KEY

echo "us-east-1" | wrangler secret put AWS_REGION

# Production environment
echo ""
echo "=== Setting up PRODUCTION environment ==="
echo "Enter Lambda ARN (or press Enter for default):"
read LAMBDA_ARN_PROD
LAMBDA_ARN_PROD=${LAMBDA_ARN_PROD:-arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor}
echo "$LAMBDA_ARN_PROD" | wrangler secret put AWS_LAMBDA_ARN --env production

echo "Enter AWS Access Key ID:"
read AWS_KEY_ID_PROD
echo "$AWS_KEY_ID_PROD" | wrangler secret put AWS_ACCESS_KEY_ID --env production

echo "Enter AWS Secret Access Key:"
read -s AWS_SECRET_PROD
echo "$AWS_SECRET_PROD" | wrangler secret put AWS_SECRET_ACCESS_KEY --env production

echo "us-east-1" | wrangler secret put AWS_REGION --env production

echo ""
echo "✅ Secrets configured for both environments!"
echo ""
echo "To verify, run: wrangler secret list"
