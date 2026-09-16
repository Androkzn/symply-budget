# Setting Up DEV and STAGING Environments

Guide to create DEV and STAGING Lambda functions to enable multi-environment deployments.

## Overview

Currently you have:
- ✅ **PROD:** `inspection-report-processor` (already exists)

To enable full multi-environment support, create:
- 🔨 **DEV:** `inspection-report-processor-dev` (needs creation)
- 🔨 **STAGING:** `inspection-report-processor-staging` (needs creation)

## Quick Setup

### Option 1: AWS Console (Easiest)

**Step 1: Clone PROD function to create DEV**

1. Go to AWS Lambda Console: https://console.aws.amazon.com/lambda
2. Select `inspection-report-processor`
3. Actions → Clone function
4. New function name: `inspection-report-processor-dev`
5. Click "Clone function"

**Step 2: Clone PROD function to create STAGING**

1. Select `inspection-report-processor`
2. Actions → Clone function
3. New function name: `inspection-report-processor-staging`
4. Click "Clone function"

**Step 3: Update environment variables (if needed)**

For each new function (DEV, STAGING):
1. Go to Configuration → Environment variables
2. Update as needed:
   - `R2_BUCKET_NAME` → `simple-house-reports-dev` or `simple-house-reports-staging`
   - Other environment-specific variables

**Step 4: Deploy initial code**

```bash
cd backend/lambda-processor

# Deploy to DEV with layer
./deploy-dev-layer

# Deploy to STAGING with layer
./deploy-staging-layer
```

Done! ✅

---

### Option 2: AWS CLI

**Step 1: Get PROD function configuration**

```bash
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --region us-east-1 \
  > prod-config.json
```

**Step 2: Create DEV function**

```bash
# Get the role ARN from PROD
ROLE_ARN=$(jq -r '.Role' prod-config.json)

# Create function
aws lambda create-function \
  --function-name inspection-report-processor-dev \
  --runtime python3.11 \
  --role "$ROLE_ARN" \
  --handler handler.lambda_handler \
  --timeout 900 \
  --memory-size 3008 \
  --region us-east-1 \
  --zip-file fileb://function-code.zip \
  --description "Inspection report processor - DEV environment"
```

**Step 3: Create STAGING function**

```bash
aws lambda create-function \
  --function-name inspection-report-processor-staging \
  --runtime python3.11 \
  --role "$ROLE_ARN" \
  --handler handler.lambda_handler \
  --timeout 900 \
  --memory-size 3008 \
  --region us-east-1 \
  --zip-file fileb://function-code.zip \
  --description "Inspection report processor - STAGING environment"
```

**Step 4: Deploy with layers**

```bash
cd backend/lambda-processor

# Deploy to DEV
./deploy-dev-layer

# Deploy to STAGING
./deploy-staging-layer
```

---

### Option 3: Automated Script

Create a setup script:

```bash
#!/bin/bash
# setup-environments.sh

set -e

echo "🔧 Setting up DEV and STAGING environments"
echo "==========================================="

PROD_FUNCTION="inspection-report-processor"
REGION="us-east-1"

# Get PROD configuration
echo "📋 Getting PROD configuration..."
ROLE_ARN=$(aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'Role' \
  --output text)

TIMEOUT=$(aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'Timeout' \
  --output text)

MEMORY=$(aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'MemorySize' \
  --output text)

echo "✓ Role: $ROLE_ARN"
echo "✓ Timeout: $TIMEOUT seconds"
echo "✓ Memory: $MEMORY MB"

# Create minimal deployment package
echo ""
echo "📦 Creating deployment package..."
cd backend/lambda-processor
rm -rf temp-build
mkdir -p temp-build
cp handler.py job_state.py structured_logger.py batch_processor.py temp-build/
cd temp-build
zip -r9 ../temp-function.zip . > /dev/null
cd ..
rm -rf temp-build

# Create DEV function
echo ""
echo "🔨 Creating DEV function..."
aws lambda create-function \
  --function-name inspection-report-processor-dev \
  --runtime python3.11 \
  --role "$ROLE_ARN" \
  --handler handler.lambda_handler \
  --timeout "$TIMEOUT" \
  --memory-size "$MEMORY" \
  --region "$REGION" \
  --zip-file fileb://temp-function.zip \
  --description "Inspection report processor - DEV" \
  && echo "✅ DEV function created" \
  || echo "⚠️  DEV function may already exist"

# Create STAGING function
echo ""
echo "🔨 Creating STAGING function..."
aws lambda create-function \
  --function-name inspection-report-processor-staging \
  --runtime python3.11 \
  --role "$ROLE_ARN" \
  --handler handler.lambda_handler \
  --timeout "$TIMEOUT" \
  --memory-size "$MEMORY" \
  --region "$REGION" \
  --zip-file fileb://temp-function.zip \
  --description "Inspection report processor - STAGING" \
  && echo "✅ STAGING function created" \
  || echo "⚠️  STAGING function may already exist"

# Cleanup
rm -f temp-function.zip

# Deploy with layers
echo ""
echo "📚 Deploying with layers..."
echo ""

echo "Deploying to DEV..."
./deploy-dev-layer

echo ""
echo "Deploying to STAGING..."
./deploy-staging-layer

echo ""
echo "✅ Environment setup complete!"
echo ""
echo "Test your deployments:"
echo "  ./deploy-dev --test"
echo "  ./deploy-staging --test"
echo "  ./deploy-prod --test"
```

Save this as `scripts/setup-environments.sh` and run:

```bash
chmod +x scripts/setup-environments.sh
./scripts/setup-environments.sh
```

---

## Environment Variables

After creating functions, set environment-specific variables:

### DEV Environment

```bash
aws lambda update-function-configuration \
  --function-name inspection-report-processor-dev \
  --environment Variables='{
    "ANTHROPIC_API_KEY": "your-dev-api-key",
    "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
    "CLOUDFLARE_D1_DATABASE_ID": "your-dev-database-id",
    "CLOUDFLARE_API_TOKEN": "your-api-token",
    "R2_BUCKET_NAME": "simple-house-reports-dev",
    "R2_ENDPOINT_URL": "your-r2-endpoint",
    "R2_ACCESS_KEY_ID": "your-r2-access-key",
    "R2_SECRET_ACCESS_KEY": "your-r2-secret-key"
  }' \
  --region us-east-1
```

### STAGING Environment

```bash
aws lambda update-function-configuration \
  --function-name inspection-report-processor-staging \
  --environment Variables='{
    "ANTHROPIC_API_KEY": "your-staging-api-key",
    "CLOUDFLARE_ACCOUNT_ID": "your-account-id",
    "CLOUDFLARE_D1_DATABASE_ID": "your-staging-database-id",
    "CLOUDFLARE_API_TOKEN": "your-api-token",
    "R2_BUCKET_NAME": "simple-house-reports-staging",
    "R2_ENDPOINT_URL": "your-r2-endpoint",
    "R2_ACCESS_KEY_ID": "your-r2-access-key",
    "R2_SECRET_ACCESS_KEY": "your-r2-secret-key"
  }' \
  --region us-east-1
```

---

## Verification

After setup, verify all environments work:

```bash
# List all functions
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `inspection-report`)].{Name:FunctionName,Runtime:Runtime,Updated:LastModified}' \
  --output table

# Test deployments
cd backend/lambda-processor

./deploy-dev --test
./deploy-staging --test
./deploy-prod --test
```

Expected output:
```
✅ Lambda deployment test PASSED
```

---

## Optional: IAM Role

If you want separate IAM roles per environment (recommended for production):

```bash
# Create DEV role
aws iam create-role \
  --role-name lambda-inspection-processor-dev \
  --assume-role-policy-document file://trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name lambda-inspection-processor-dev \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Update function to use new role
aws lambda update-function-configuration \
  --function-name inspection-report-processor-dev \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-inspection-processor-dev
```

---

## Cloudflare D1 Databases

Create separate D1 databases for each environment:

```bash
# DEV
wrangler d1 create simple-house-dev

# STAGING
wrangler d1 create simple-house-staging

# Get database IDs and update Lambda environment variables
```

---

## R2 Buckets

Create separate R2 buckets for each environment:

```bash
# DEV
wrangler r2 bucket create simple-house-reports-dev

# STAGING
wrangler r2 bucket create simple-house-reports-staging

# Update Lambda environment variables with new bucket names
```

---

## Quick Reference

Once setup is complete:

| Environment | Function | Deploy Command |
|-------------|----------|----------------|
| DEV | `inspection-report-processor-dev` | `./deploy-dev` |
| STAGING | `inspection-report-processor-staging` | `./deploy-staging` |
| PROD | `inspection-report-processor` | `./deploy-prod` |

**All environments ready!** You can now deploy to any environment with a single command.

---

## Troubleshooting

### Function already exists

```bash
# Delete and recreate
aws lambda delete-function --function-name inspection-report-processor-dev
# Then run creation command again
```

### Permission denied

Ensure your AWS credentials have permission to create Lambda functions:
- `lambda:CreateFunction`
- `lambda:UpdateFunctionConfiguration`
- `iam:PassRole` (to assign role to function)

### Environment variables not set

Copy from PROD and modify:

```bash
# Get PROD env vars
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query 'Environment.Variables' \
  --output json > prod-env.json

# Edit for DEV
# Then apply
aws lambda update-function-configuration \
  --function-name inspection-report-processor-dev \
  --environment "Variables=$(cat dev-env.json)"
```

---

**Last Updated:** 2026-01-28
**Version:** 1.0
