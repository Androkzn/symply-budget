# Multi-Environment Deployment Guide

Complete guide for deploying the Lambda function across multiple environments (DEV, STAGING, PRODUCTION).

## Table of Contents

1. [Overview](#overview)
2. [Environment Configuration](#environment-configuration)
3. [Quick Reference](#quick-reference)
4. [Deployment Commands](#deployment-commands)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The deployment system supports multiple environments with isolated Lambda functions and layers:

| Environment | Function Name | Layer Name | Use Case |
|-------------|---------------|------------|----------|
| **DEV** | `inspection-report-processor-dev` | `inspection-report-dependencies-dev` | Development & testing |
| **STAGING** | `inspection-report-processor-staging` | `inspection-report-dependencies-staging` | Pre-production validation |
| **PROD** | `inspection-report-processor` | `inspection-report-dependencies` | Production workloads |

### Architecture

```
┌─────────────────────────────────────┐
│   DEV Environment                   │
│   ├── Lambda: ...-dev               │
│   └── Layer: ...-dev (v1, v2, ...)  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│   STAGING Environment               │
│   ├── Lambda: ...-staging           │
│   └── Layer: ...-staging (v1, ...) │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│   PROD Environment                  │
│   ├── Lambda: inspection-...        │
│   └── Layer: inspection-... (v1,..) │
└─────────────────────────────────────┘
```

---

## Environment Configuration

### Configuration File

Environments are configured in `scripts/env-config.sh`:

```bash
# Development
if [ "$DEPLOY_ENV" = "dev" ]; then
  FUNCTION_NAME="inspection-report-processor-dev"
  LAYER_NAME="inspection-report-dependencies-dev"
  ENV_LABEL="Development"

# Staging
elif [ "$DEPLOY_ENV" = "staging" ]; then
  FUNCTION_NAME="inspection-report-processor-staging"
  LAYER_NAME="inspection-report-dependencies-staging"
  ENV_LABEL="Staging"

# Production (default)
else
  FUNCTION_NAME="inspection-report-processor"
  LAYER_NAME="inspection-report-dependencies"
  ENV_LABEL="Production"
fi
```

### AWS Configuration

Each environment uses:
- **Region:** `us-east-1` (configurable)
- **Account:** Auto-detected from AWS credentials
- **Runtime:** Python 3.11
- **Layer:** Environment-specific

---

## Quick Reference

### Fast Code Deployment

```bash
# Development
./deploy-dev

# Staging
./deploy-staging

# Production
./deploy-prod
```

**Time:** ~10 seconds each

### Full Deployment (with Layer)

```bash
# Development
./deploy-dev-layer

# Staging
./deploy-staging-layer

# Production
./deploy-prod-layer
```

**Time:** ~2-3 minutes each

### With Testing

```bash
# Deploy and test
./deploy-dev --test
./deploy-staging --test
./deploy-prod --test
```

---

## Deployment Commands

### Code-Only Deployment

**Use when:** Python code changed, dependencies unchanged

```bash
# DEV
./deploy-dev
./deploy-dev --test          # With automatic testing

# STAGING
./deploy-staging
./deploy-staging --test      # With automatic testing

# PROD
./deploy-prod
./deploy-prod --test         # With automatic testing
```

**What happens:**
1. Packages Python code (26KB)
2. Uploads to Lambda function
3. Updates function code
4. (Optional) Runs automated tests

### Full Layer Deployment

**Use when:** First deployment OR dependencies changed in `requirements.txt`

```bash
# DEV
./deploy-dev-layer
./deploy-dev-layer --test    # With automatic testing

# STAGING
./deploy-staging-layer
./deploy-staging-layer --test

# PROD
./deploy-prod-layer
./deploy-prod-layer --test
```

**What happens:**
1. Builds dependencies layer (34MB)
2. Publishes new layer version
3. Packages Python code (26KB)
4. Updates function code
5. Attaches new layer to function
6. (Optional) Runs automated tests

### Advanced Commands

**Custom environment variable:**
```bash
DEPLOY_ENV=dev ./scripts/deploy-code-only.sh

# Or
./scripts/deploy-code-only.sh --env=dev
./scripts/deploy-code-only.sh --env=staging
./scripts/deploy-code-only.sh --env=prod
```

**Manual layer rebuild:**
```bash
./scripts/rebuild-layer-fix.sh --env=dev
./scripts/rebuild-layer-fix.sh --env=staging
./scripts/rebuild-layer-fix.sh --env=prod
```

---

## Best Practices

### 1. Development Workflow

```bash
# 1. Develop and test locally
vim handler.py

# 2. Deploy to DEV
./deploy-dev --test

# 3. Verify in DEV
aws logs tail /aws/lambda/inspection-report-processor-dev --follow

# 4. When ready, deploy to STAGING
./deploy-staging --test

# 5. Test in STAGING
# Run integration tests, smoke tests, etc.

# 6. Finally, deploy to PROD
./deploy-prod --test

# 7. Monitor PROD
aws logs tail /aws/lambda/inspection-report-processor --follow
```

### 2. Dependency Updates

```bash
# 1. Update requirements
vim requirements-layer.txt

# 2. Test in DEV first
./deploy-dev-layer --test

# 3. Verify layer works
# Check CloudWatch logs, run tests

# 4. Deploy to STAGING
./deploy-staging-layer --test

# 5. Validate thoroughly

# 6. Deploy to PROD
./deploy-prod-layer --test
```

### 3. Hotfix Workflow

For urgent production fixes:

```bash
# 1. Create hotfix branch
git checkout -b hotfix/urgent-fix

# 2. Make minimal changes
vim handler.py

# 3. Deploy directly to PROD (with test)
./deploy-prod --test

# 4. Verify fix works
aws logs tail /aws/lambda/inspection-report-processor --since 5m

# 5. Backport to other environments
./deploy-dev
./deploy-staging

# 6. Commit and merge
git commit -m "hotfix: Fix urgent issue"
git push
```

### 4. Rollback Strategy

If deployment fails or introduces issues:

```bash
# Option 1: Redeploy previous code
git checkout <previous-commit>
./deploy-prod
git checkout main

# Option 2: Use Lambda versioning
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --s3-bucket <backup-bucket> \
  --s3-key <previous-version.zip>

# Option 3: Revert to previous layer
aws lambda update-function-configuration \
  --function-name inspection-report-processor \
  --layers arn:aws:lambda:us-east-1:XXX:layer:inspection-report-dependencies:1
```

### 5. Testing Strategy

**DEV Environment:**
- Unit tests
- Integration tests
- Experimental features
- Debug logging enabled

**STAGING Environment:**
- Full integration tests
- Performance tests
- Load tests
- Production-like configuration

**PROD Environment:**
- Smoke tests only
- Monitor error rates
- Gradual rollout (if applicable)

---

## Troubleshooting

### Environment Variables Not Set

**Error:** Function uses wrong environment

**Solution:**
```bash
# Explicitly set environment
export DEPLOY_ENV=dev
./deploy-code-only

# Or use wrapper script
./deploy-dev
```

### Wrong Function Updated

**Error:** Deployed to wrong environment

**Solution:**
```bash
# Check which functions exist
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `inspection-report`)].FunctionName' \
  --output table

# Deploy to correct environment
./deploy-<correct-env>
```

### Layer Compatibility Issues

**Error:** Layer version mismatch between environments

**Solution:**
```bash
# Rebuild layers for all environments
./deploy-dev-layer
./deploy-staging-layer
./deploy-prod-layer
```

### Test Failures in One Environment

**Error:** Test passes in DEV but fails in STAGING

**Checklist:**
1. Check environment variables in Lambda
2. Verify layer versions match
3. Check CloudWatch logs for differences
4. Ensure test data exists in both environments
5. Verify R2 bucket access

```bash
# Compare configurations
aws lambda get-function-configuration \
  --function-name inspection-report-processor-dev \
  > dev-config.json

aws lambda get-function-configuration \
  --function-name inspection-report-processor-staging \
  > staging-config.json

diff dev-config.json staging-config.json
```

### Deployment Fails

**Error:** `ResourceConflictException` or timeout

**Solution:**
```bash
# Wait for previous deployment to complete
aws lambda wait function-updated \
  --function-name inspection-report-processor-dev

# Then retry
./deploy-dev
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy Lambda

on:
  push:
    branches:
      - develop      # Deploy to DEV
      - staging      # Deploy to STAGING
      - main         # Deploy to PROD

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - uses: actions/setup-python@v2
        with:
          python-version: '3.11'

      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Deploy to DEV
        if: github.ref == 'refs/heads/develop'
        run: |
          cd backend/lambda-processor
          ./deploy-dev --test

      - name: Deploy to STAGING
        if: github.ref == 'refs/heads/staging'
        run: |
          cd backend/lambda-processor
          ./deploy-staging --test

      - name: Deploy to PROD
        if: github.ref == 'refs/heads/main'
        run: |
          cd backend/lambda-processor
          ./deploy-prod --test
```

### Manual Approval for PROD

```yaml
- name: Deploy to PROD
  if: github.ref == 'refs/heads/main'
  environment:
    name: production
    url: https://console.aws.amazon.com/lambda
  run: |
    cd backend/lambda-processor
    ./deploy-prod --test
```

---

## Monitoring

### View Logs by Environment

```bash
# DEV
aws logs tail /aws/lambda/inspection-report-processor-dev --follow

# STAGING
aws logs tail /aws/lambda/inspection-report-processor-staging --follow

# PROD
aws logs tail /aws/lambda/inspection-report-processor --follow
```

### Check Function Status

```bash
# All environments
for env in dev staging prod; do
  if [ "$env" = "prod" ]; then
    name="inspection-report-processor"
  else
    name="inspection-report-processor-$env"
  fi

  echo "=== $env ==="
  aws lambda get-function-configuration \
    --function-name $name \
    --query '{State:State,LastModified:LastModified,CodeSize:CodeSize}' \
    --output table
done
```

### Compare Environments

```bash
# Get layer ARNs for all environments
echo "DEV:"
aws lambda get-function-configuration \
  --function-name inspection-report-processor-dev \
  --query 'Layers[0].Arn'

echo "STAGING:"
aws lambda get-function-configuration \
  --function-name inspection-report-processor-staging \
  --query 'Layers[0].Arn'

echo "PROD:"
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query 'Layers[0].Arn'
```

---

## Environment-Specific Configuration

### Lambda Environment Variables

Each environment should have its own:
- `ANTHROPIC_API_KEY` (can be same or different)
- `CLOUDFLARE_D1_DATABASE_ID` (different per environment)
- `R2_BUCKET_NAME` (different per environment: `simple-house-reports-dev`, etc.)
- Other environment-specific settings

### Setting Environment Variables

```bash
# DEV
aws lambda update-function-configuration \
  --function-name inspection-report-processor-dev \
  --environment Variables='{
    ANTHROPIC_API_KEY=sk-...,
    R2_BUCKET_NAME=simple-house-reports-dev
  }'

# STAGING
aws lambda update-function-configuration \
  --function-name inspection-report-processor-staging \
  --environment Variables='{
    ANTHROPIC_API_KEY=sk-...,
    R2_BUCKET_NAME=simple-house-reports-staging
  }'

# PROD
aws lambda update-function-configuration \
  --function-name inspection-report-processor \
  --environment Variables='{
    ANTHROPIC_API_KEY=sk-...,
    R2_BUCKET_NAME=simple-house-reports
  }'
```

---

## Summary

### Quick Commands Reference

```bash
# Code deployments
./deploy-dev          # DEV
./deploy-staging      # STAGING
./deploy-prod         # PROD

# Full deployments
./deploy-dev-layer      # DEV with layer
./deploy-staging-layer  # STAGING with layer
./deploy-prod-layer     # PROD with layer

# With testing
./deploy-dev --test          # Test after deploy
./deploy-staging --test      # Test after deploy
./deploy-prod --test         # Test after deploy

# View logs
aws logs tail /aws/lambda/inspection-report-processor-dev --follow
aws logs tail /aws/lambda/inspection-report-processor-staging --follow
aws logs tail /aws/lambda/inspection-report-processor --follow
```

### Typical Workflow

1. **Develop:** Make changes locally
2. **Test in DEV:** `./deploy-dev --test`
3. **Validate in STAGING:** `./deploy-staging --test`
4. **Deploy to PROD:** `./deploy-prod --test`
5. **Monitor:** Watch CloudWatch logs

---

**Last Updated:** 2026-01-28
**Version:** 2.0 (Multi-environment support)

