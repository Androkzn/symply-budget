# Complete Lambda Deployment Guide

Comprehensive guide for deploying the Inspection Report Processor Lambda function.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Architecture](#architecture)
4. [Deployment Methods](#deployment-methods)
5. [Step-by-Step Instructions](#step-by-step-instructions)
6. [Troubleshooting](#troubleshooting)
7. [Best Practices](#best-practices)
8. [Advanced Topics](#advanced-topics)

---

## Overview

The Inspection Report Processor is an AWS Lambda function that:
- Processes PDF inspection reports
- Extracts and analyzes images using AI (Claude)
- Stores data in Cloudflare D1 database
- Manages files in R2 storage
- Handles batch processing for large files

### Key Metrics

- **Code Size:** 26KB (with layers)
- **Total Size:** 34MB (layer) + 26KB (code)
- **Deployment Time:** 10 seconds (code-only), 2-3 minutes (full)
- **Runtime:** Python 3.11
- **Region:** us-east-1

---

## Prerequisites

### Required Tools

1. **AWS CLI** - Configured with credentials
   ```bash
   aws configure
   # Enter: Access Key ID, Secret Access Key, Region (us-east-1)
   ```

2. **Python 3.11+** - For building packages
   ```bash
   python3 --version  # Should be 3.11 or higher
   ```

3. **jq** - JSON processor (optional but recommended)
   ```bash
   brew install jq
   ```

4. **Docker** - For production builds (optional)
   ```bash
   brew install --cask docker
   open -a Docker
   ```

### AWS Permissions Required

Your AWS user must have permissions for:
- `lambda:UpdateFunctionCode`
- `lambda:UpdateFunctionConfiguration`
- `lambda:PublishLayerVersion`
- `lambda:GetFunction`
- `lambda:GetFunctionConfiguration`
- `logs:TailLogEvents` (for viewing logs)

---

## Architecture

### Layer-Based Architecture

```
┌─────────────────────────────────────┐
│   Lambda Function (26KB)            │
│   ├── handler.py                    │
│   ├── job_state.py                  │
│   ├── structured_logger.py          │
│   └── batch_processor.py            │
└─────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────┐
│   Lambda Layer (34MB)               │
│   ├── anthropic                     │
│   ├── PyPDF2                        │
│   ├── PyMuPDF                       │
│   └── Pillow                        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   AWS Lambda Runtime                │
│   ├── Python 3.11                   │
│   ├── boto3 (built-in)              │
│   └── botocore (built-in)           │
└─────────────────────────────────────┘
```

### Why Layers?

**Before (No Layers):**
- Package size: 55MB
- Deployment time: 5+ minutes
- Upload method: S3 or CloudShell required

**After (With Layers):**
- Code size: 26KB
- Deployment time: 10 seconds
- Upload method: Direct (no S3 needed)
- Dependencies: Cached in layer (update rarely)

---

## Deployment Methods

### Method 1: Code-Only Deployment ⭐ (Recommended)

**Use when:** You've changed Python code (handler.py, etc.) but not dependencies.

```bash
./deploy-code-only
```

**Process:**
1. Packages Python files (26KB)
2. Uploads to Lambda
3. Updates function code

**Time:** ~10 seconds

---

### Method 2: Full Layer Deployment

**Use when:** First deployment OR you've changed `requirements.txt`.

```bash
./deploy-with-layer
```

**Process:**
1. Builds dependencies layer (34MB)
2. Publishes layer to AWS
3. Packages Python files (26KB)
4. Updates function code
5. Attaches layer to function

**Time:** ~2-3 minutes

---

### Method 3: Docker-Based Deployment

**Use when:** You need guaranteed binary compatibility (production builds).

```bash
./scripts/docker-deploy.sh
```

**Process:**
1. Builds package in Docker (Lambda Python 3.11 image)
2. Compiles binary dependencies correctly
3. Creates deployment zip
4. Uploads to Lambda

**Time:** ~1-2 minutes (first build slower)
**Requires:** Docker Desktop installed and running

---

### Method 4: CloudShell (Manual Fallback)

**Use when:** Automated scripts fail, or you don't have local tools.

```bash
# 1. Create package locally
cd backend/lambda-processor
tar -czf cloudshell-deploy.tar.gz handler.py job_state.py structured_logger.py batch_processor.py requirements.txt

# 2. Open AWS CloudShell (https://console.aws.amazon.com)
# 3. Upload cloudshell-deploy.tar.gz via Actions → Upload

# 4. In CloudShell, run:
tar -xzf cloudshell-deploy.tar.gz
mkdir -p package
pip install -r requirements.txt -t package/
cp *.py package/
cd package && zip -r9 ../lambda-function.zip . && cd ..

aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

**Time:** ~5 minutes

---

## Step-by-Step Instructions

### Initial Setup (One Time)

1. **Clone the repository**
   ```bash
   cd /path/to/SimpleHouseApp/backend/lambda-processor
   ```

2. **Install jq (optional)**
   ```bash
   brew install jq
   ```

3. **Verify AWS credentials**
   ```bash
   aws sts get-caller-identity
   ```

4. **Make scripts executable** (if needed)
   ```bash
   chmod +x deploy-code-only deploy-with-layer
   ```

5. **First deployment**
   ```bash
   ./deploy-with-layer
   ```
   This creates the layer and deploys the function.

### Regular Deployments

**For code changes:**
```bash
# 1. Edit Python files (handler.py, etc.)
vim handler.py

# 2. Deploy
./deploy-code-only

# 3. Verify
aws lambda get-function --function-name inspection-report-processor \
  --query 'Configuration.LastModified' --output text
```

**For dependency changes:**
```bash
# 1. Edit requirements
vim requirements.txt

# 2. Update requirements-layer.txt (if needed)
vim requirements-layer.txt

# 3. Deploy with new layer
./deploy-with-layer

# 4. Verify
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query 'Layers[0].Arn' --output text
```

### Testing Deployment

```bash
# Invoke function
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{"test": true}' \
  --region us-east-1 \
  response.json

# View response
cat response.json

# Watch logs in real-time
aws logs tail /aws/lambda/inspection-report-processor --follow

# View recent logs
aws logs tail /aws/lambda/inspection-report-processor --since 5m
```

---

## Troubleshooting

### Common Issues

#### 1. Package Too Large (>50MB)

**Error:** `RequestEntityTooLargeException`

**Solution:** Use layer-based deployment
```bash
./deploy-with-layer
```

#### 2. Binary Compatibility Issues

**Error:** `cannot import name '_imaging' from 'PIL'` or similar

**Solution:** Use Docker deployment for correct binaries
```bash
# Install Docker first
brew install --cask docker
open -a Docker

# Then deploy
./scripts/docker-deploy.sh
```

#### 3. AWS Credentials Not Configured

**Error:** `Unable to locate credentials`

**Solution:** Configure AWS CLI
```bash
aws configure
# Enter your credentials
```

#### 4. Layer Too Large (>70MB)

**Error:** `Request must be smaller than 70167211 bytes`

**Solution:** Optimize dependencies
- Remove boto3/botocore (included in Lambda runtime)
- Use `requirements-layer.txt` instead of `requirements.txt`
- Remove test files and .pyc files (script does this automatically)

#### 5. ResourceConflictException

**Error:** `An update is in progress`

**Solution:** Wait for previous update to complete
```bash
aws lambda wait function-updated \
  --function-name inspection-report-processor \
  --region us-east-1
```

#### 6. Permission Denied

**Error:** `User is not authorized to perform: lambda:UpdateFunctionCode`

**Solution:** Check IAM permissions
```bash
# Check current user
aws sts get-caller-identity

# Contact AWS admin to grant permissions
```

### Debug Commands

```bash
# Check function status
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1

# Check function configuration
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --region us-east-1

# List all layers
aws lambda list-layer-versions \
  --layer-name inspection-report-dependencies \
  --region us-east-1

# View environment variables
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query 'Environment.Variables' \
  --output json | jq .

# Check recent invocations
aws logs tail /aws/lambda/inspection-report-processor \
  --since 1h \
  --format short
```

---

## Best Practices

### 1. Development Workflow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes
vim handler.py

# 3. Test locally (if possible)
python handler.py

# 4. Deploy to test (if you have test environment)
./deploy-code-only

# 5. Test in Lambda
aws lambda invoke --function-name inspection-report-processor \
  --payload '{"test": true}' response.json

# 6. Commit changes
git add .
git commit -m "feat: Add new feature"

# 7. Push and create PR
git push origin feature/my-feature
```

### 2. Deployment Strategy

**For Development:**
- Use `./deploy-code-only` for quick iterations
- Test frequently
- View logs to verify changes

**For Production:**
- Use `./scripts/docker-deploy.sh` for binary compatibility
- Test in staging first (if available)
- Create git tag for releases
- Monitor logs after deployment

### 3. Layer Management

**When to update layer:**
- Adding new dependencies
- Updating dependency versions
- Security patches in libraries

**When NOT to update layer:**
- Code-only changes
- Minor bug fixes
- Log message updates

### 4. Monitoring

```bash
# Set up log tailing during deployment
aws logs tail /aws/lambda/inspection-report-processor --follow &

# Deploy
./deploy-code-only

# Watch for errors in logs
# Kill tail when done: kill %1
```

### 5. Rollback Strategy

```bash
# List recent deployments
aws lambda list-versions-by-function \
  --function-name inspection-report-processor \
  --max-items 5

# Rollback to previous version
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --s3-bucket <previous-bucket> \
  --s3-key <previous-key>
```

---

## Advanced Topics

### Creating Multiple Layers

For very large projects, split dependencies:

```bash
# Layer 1: Data processing (PyMuPDF, Pillow)
# Layer 2: AI/ML (anthropic, etc.)
# Layer 3: Utilities (PyPDF2, etc.)
```

### Environment-Specific Deployments

```bash
# Production
export FUNCTION_NAME="inspection-report-processor-prod"
./deploy-code-only

# Staging
export FUNCTION_NAME="inspection-report-processor-staging"
./deploy-code-only
```

### CI/CD Integration

**GitHub Actions example:**
```yaml
name: Deploy Lambda
on:
  push:
    branches: [main]
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
      - name: Deploy
        run: |
          cd backend/lambda-processor
          ./deploy-code-only
```

### Custom Build Process

Edit `scripts/create-and-deploy-layer.sh`:

```bash
# Add custom build steps
echo "Running custom build..."
python3 setup.py build

# Add post-deploy hooks
echo "Running post-deploy tasks..."
./scripts/warm-up-lambda.sh
```

### Layer Versioning Strategy

```bash
# Keep track of layer versions
LAYER_VERSION=$(aws lambda list-layer-versions \
  --layer-name inspection-report-dependencies \
  --query 'LayerVersions[0].Version' \
  --output text)

echo "Current layer version: $LAYER_VERSION"

# Tag in git
git tag -a "layer-v${LAYER_VERSION}" -m "Layer version ${LAYER_VERSION}"
git push --tags
```

---

## Scripts Reference

| Script | Location | Purpose |
|--------|----------|---------|
| `deploy-code-only` | Root | Fast code-only deployment |
| `deploy-with-layer` | Root | Full deployment with layer |
| `create-and-deploy-layer.sh` | scripts/ | Create layer + deploy |
| `deploy-code-only.sh` | scripts/ | Code deployment (internal) |
| `docker-deploy.sh` | scripts/ | Docker-based deployment |
| `native-deploy.sh` | scripts/ | Native build (no Docker) |
| `deploy-via-s3.sh` | scripts/ | S3-based deployment |
| `install-docker.sh` | scripts/ | Docker installation helper |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `requirements.txt` | All Python dependencies |
| `requirements-layer.txt` | Layer-only dependencies (no boto3) |
| `Dockerfile.lambda` | Docker build for Lambda |
| `handler.py` | Main Lambda handler |
| `job_state.py` | State management |
| `structured_logger.py` | Logging utilities |
| `batch_processor.py` | Batch processing logic |

---

## FAQ

**Q: How often should I update the layer?**
A: Only when dependencies change (requirements.txt updates). Most deployments are code-only.

**Q: Can I use this for other Lambda functions?**
A: Yes! Copy the scripts and adjust `FUNCTION_NAME` in each script.

**Q: What if my package is still too large?**
A:
1. Use layers (done)
2. Remove unused dependencies
3. Use S3 deployment (see `deploy-via-s3.sh`)
4. Split into multiple functions

**Q: How do I debug deployment issues?**
A: Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow
```

**Q: Can I deploy from CI/CD?**
A: Yes! Use the scripts in your CI/CD pipeline. Ensure AWS credentials are configured.

---

## Support and Resources

- **AWS Lambda Docs:** https://docs.aws.amazon.com/lambda/
- **Python Package Docs:** Check requirements.txt for library docs
- **Project Docs:** See [docs/](.) folder
- **AWS CLI Reference:** https://awscli.amazonaws.com/v2/documentation/api/latest/reference/lambda/index.html

---

**Last Updated:** 2026-01-28
**Version:** 2.0 (Layer-based deployment)
**Maintained by:** Development Team
