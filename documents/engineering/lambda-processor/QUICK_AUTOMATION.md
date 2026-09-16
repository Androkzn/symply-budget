# Quick Automation Guide

## Current Situation

Your AWS user doesn't have EC2 permissions, so the full automated script can't create EC2 instances. Here are the best options:

## ✅ Option 1: GitHub Actions (Best - Fully Automated)

**Setup once, then automatic on every push:**

1. **Add AWS credentials to GitHub:**
   - Go to: https://github.com/your-repo/settings/secrets/actions
   - Add secrets:
     - `AWS_ACCESS_KEY_ID`
     - `AWS_SECRET_ACCESS_KEY`

2. **Push code:**
   ```bash
   git add .
   git commit -m "Update Lambda"
   git push origin main
   ```
   
3. **GitHub Actions automatically:**
   - Builds on Linux (Ubuntu)
   - Deploys to Lambda
   - Verifies deployment

**File:** `.github/workflows/deploy-lambda.yml` (already created!)

---

## ✅ Option 2: Simplified Script (One Command After Build)

**If you already have `lambda-function.zip`:**

```bash
cd lambda-processor
./automated-build-simple.sh
```

This script will:
- Check for existing package
- Offer to build with Docker (if installed)
- Deploy to Lambda
- Verify deployment

**File:** `lambda-processor/automated-build-simple.sh`

---

## ✅ Option 3: Docker Build (If You Install Docker)

**Install Docker Desktop:**
- Download: https://www.docker.com/products/docker-desktop/
- Install and start Docker

**Then:**
```bash
cd lambda-processor
./build-lambda-docker.sh
./automated-build-simple.sh  # Deploy
```

---

## ✅ Option 4: CloudShell (Manual but Reliable)

**One-time setup, then reusable:**

1. Open: https://console.aws.amazon.com/cloudshell/
2. Run:
   ```bash
   mkdir -p lambda-processor && cd lambda-processor
   # Upload handler.py and requirements.txt via UI
   pip3 install --target package/ -r requirements.txt
   cp handler.py package/
   cd package && zip -r ../lambda-function.zip . && cd ..
   # Download lambda-function.zip
   ```
3. Deploy:
   ```bash
   cd ~/Downloads  # or wherever you saved it
   aws lambda update-function-code \
     --function-name inspection-report-processor \
     --zip-file fileb://lambda-function.zip \
     --region us-east-1
   ```

---

## 🎯 Recommended Workflow

**For ongoing development:**
1. Use **GitHub Actions** - set it up once, then it's automatic
2. Push code → automatic build & deploy

**For quick one-off builds:**
1. Use **Docker** (if installed) or **CloudShell**
2. Run `./automated-build-simple.sh` to deploy

---

## Quick Commands

```bash
# Deploy existing package
cd lambda-processor
./automated-build-simple.sh

# Build with Docker (if installed)
./build-lambda-docker.sh
./automated-build-simple.sh

# Check Lambda status
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State]' \
  --output text
```

---

## Next Steps

1. **Choose your preferred method** (GitHub Actions recommended)
2. **Set it up once**
3. **Enjoy automated deployments!**
