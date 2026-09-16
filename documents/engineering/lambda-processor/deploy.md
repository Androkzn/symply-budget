# Lambda Deployment Guide

Choose the deployment method that works best for your setup.

## Quick Reference

| Method | Requirements | Speed | Reliability |
|--------|-------------|-------|-------------|
| **Docker Deploy** ⭐ | Docker Desktop | Fast | Best |
| **Native Deploy** | Python 3.11 | Fast | Good |
| **CloudShell** | Browser only | Slow | Good |

---

## Option 1: Docker Deploy (Recommended) ⭐

**Best for:** Production deployments, binary compatibility

### Setup Once
```bash
# Install Docker Desktop
brew install --cask docker

# Install jq
brew install jq

# Start Docker
open -a Docker
```

### Deploy
```bash
cd backend/lambda-processor
./docker-deploy.sh
```

**Pros:**
- ✅ Perfect binary compatibility with Lambda
- ✅ Consistent builds every time
- ✅ One command deployment
- ✅ No platform issues

**Cons:**
- ❌ Requires Docker Desktop (~500MB)

---

## Option 2: Native Deploy (No Docker)

**Best for:** Quick deployments, no Docker available

### Setup Once
```bash
# Install jq (optional, for prettier output)
brew install jq
```

### Deploy
```bash
cd backend/lambda-processor
./native-deploy.sh
```

**Pros:**
- ✅ No Docker required
- ✅ Fast deployment
- ✅ Uses system Python

**Cons:**
- ⚠️ May have binary compatibility issues on macOS
- ⚠️ Depends on local Python version

---

## Option 3: CloudShell (Manual)

**Best for:** No local tools, testing

### Steps
```bash
# 1. Create deployment package locally
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

**Pros:**
- ✅ No local setup required
- ✅ Always works

**Cons:**
- ❌ Manual file upload
- ❌ Slow process
- ❌ Multiple steps

---

## Troubleshooting

### Docker not starting
```bash
# Check Docker status
docker info

# Restart Docker
killall Docker && open -a Docker
```

### AWS credentials not configured
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1)
```

### Package too large (>50MB)
Consider using Lambda Layers:
```bash
./create-layer.sh  # Creates reusable layer for dependencies
```

### Binary compatibility issues (native deploy)
Use Docker deploy instead - it guarantees Lambda compatibility.

---

## Configuration

All scripts use these settings (edit as needed):

```bash
FUNCTION_NAME="inspection-report-processor"
REGION="us-east-1"
```

---

## After Deployment

### Test the function
```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{"test": true}' \
  --region us-east-1 \
  response.json

cat response.json
```

### Check logs
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow
```

### View function info
```bash
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1
```
