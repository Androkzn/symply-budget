# Quick Start Guide - Lambda Deployment

## ✅ Completed Setup

- ✅ jq installed (for JSON parsing)
- ✅ Native deployment script created (works without Docker)
- ✅ Docker deployment script created (recommended for production)
- ✅ Complete deployment documentation

## 🚀 Deploy NOW (Without Docker)

You can deploy **right now** using the native script:

```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/lambda-processor
./native-deploy.sh
```

This will:
1. Build the Lambda package locally
2. Deploy to AWS Lambda
3. Show deployment status

**No Docker required!**

---

## 🐳 Optional: Install Docker for Better Deployments

Docker provides better binary compatibility with Lambda. To install:

### Option 1: Homebrew (with password)
```bash
brew install --cask docker
open -a Docker
```

### Option 2: Manual Download (no password needed)
1. Browser opened to: https://www.docker.com/products/docker-desktop
2. Click "Download for Mac"
3. Choose "Apple Silicon" (if M1/M2/M3) or "Intel"
4. Open the .dmg file
5. Drag Docker to Applications
6. Open Docker from Applications
7. Wait 30-60 seconds for Docker to start

### After Docker is Running
```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/lambda-processor
./docker-deploy.sh
```

---

## 📋 All Available Scripts

| Script | Purpose | Requirements |
|--------|---------|--------------|
| `./native-deploy.sh` | Deploy without Docker | Python 3.11, AWS CLI |
| `./docker-deploy.sh` | Deploy with Docker | Docker, jq, AWS CLI |
| `./install-docker.sh` | Help install Docker | None |

---

## 🎯 Recommended Workflow

1. **For now:** Use `./native-deploy.sh` (works immediately)
2. **Later:** Install Docker and use `./docker-deploy.sh` (better reliability)

---

## 🔍 Test Deployment

After deploying, test the function:

```bash
# Invoke the function
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{"test": true}' \
  --region us-east-1 \
  response.json

# View response
cat response.json

# Watch logs
aws logs tail /aws/lambda/inspection-report-processor --follow
```

---

## ❓ Need Help?

See [deploy.md](deploy.md) for complete documentation and troubleshooting.

---

## Current Status

- ✅ **jq**: Installed (v1.8.1)
- ⏳ **Docker**: Installation in progress (browser opened)
- ✅ **AWS CLI**: Configured
- ✅ **Python**: Available
- ✅ **Scripts**: Ready to use
