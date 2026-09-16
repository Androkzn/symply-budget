# Lambda Build & Deploy Automation Guide

This guide shows you how to automate the Lambda build and deployment process.

## 🎯 Automation Options

### Option 1: GitHub Actions (Recommended for CI/CD)

**Best for:** Automatic deployments on code changes

**Setup:**
1. Add AWS credentials to GitHub Secrets:
   - Go to: Settings → Secrets and variables → Actions
   - Add:
     - `AWS_ACCESS_KEY_ID`
     - `AWS_SECRET_ACCESS_KEY`

2. Push code to trigger deployment:
   ```bash
   git add lambda-processor/
   git commit -m "Update Lambda handler"
   git push origin main
   ```

3. GitHub Actions will automatically:
   - Build the package on Linux (Ubuntu)
   - Deploy to Lambda
   - Verify deployment

**File:** `.github/workflows/deploy-lambda.yml`

---

### Option 2: Automated Script (EC2 + SSM)

**Best for:** One-command local automation

**Usage:**
```bash
cd lambda-processor
chmod +x automated-build.sh
./automated-build.sh
```

**What it does:**
1. Creates/finds an EC2 instance
2. Builds package on Linux via SSM
3. Downloads the package
4. Deploys to Lambda
5. Verifies deployment

**Requirements:**
- AWS CLI configured
- EC2 permissions
- SSM permissions

**File:** `lambda-processor/automated-build.sh`

---

### Option 3: Makefile (Simple Commands)

**Best for:** Quick local builds and deployments

**Usage:**
```bash
cd lambda-processor

# Build using Docker
make build-docker

# Deploy
make deploy

# Build and deploy
make build-deploy

# Automated build (EC2)
make build-automated

# Check status
make status

# View logs
make logs
```

**File:** `lambda-processor/Makefile`

---

### Option 4: AWS CodeBuild

**Best for:** Enterprise CI/CD with AWS-native tools

**Setup:**

1. **Create buildspec.yml** (already created):
   ```yaml
   version: 0.2
   phases:
     install:
       runtime-versions:
         python: 3.11
     build:
       commands:
         - pip3 install --target package/ -r requirements.txt
         - cp handler.py package/
         - cd package && zip -r ../lambda-function.zip .
   artifacts:
     files:
       - lambda-function.zip
   ```

2. **Create CodeBuild project:**
   ```bash
   aws codebuild create-project \
     --name lambda-processor-build \
     --source type=S3,location=s3://your-bucket/source.zip \
     --artifacts type=S3,location=s3://your-bucket/artifacts \
     --environment type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0
   ```

3. **Create build:**
   ```bash
   aws codebuild start-build --project-name lambda-processor-build
   ```

**File:** `lambda-processor/buildspec.yml`

---

## 🚀 Quick Start

### For GitHub Users (Recommended):
```bash
# 1. Add AWS secrets to GitHub
# 2. Push code - deployment happens automatically!
git push origin main
```

### For Local Automation:
```bash
cd lambda-processor
make build-automated  # Fully automated
```

### For Manual Control:
```bash
cd lambda-processor
make build-docker     # Build
make deploy           # Deploy
make status           # Verify
```

---

## 📋 Comparison

| Method | Setup Time | Automation Level | Best For |
|--------|-----------|------------------|----------|
| **GitHub Actions** | 5 min | ⭐⭐⭐⭐⭐ | CI/CD, team projects |
| **Automated Script** | 2 min | ⭐⭐⭐⭐ | One-command local builds |
| **Makefile** | 1 min | ⭐⭐⭐ | Quick local builds |
| **CodeBuild** | 15 min | ⭐⭐⭐⭐ | Enterprise AWS-native |
| **CloudShell** | 0 min | ⭐⭐ | Manual one-time builds |

---

## 🔧 Configuration

### Environment Variables

All methods use the same Lambda function:
- **Function Name:** `inspection-report-processor`
- **Region:** `us-east-1`
- **Runtime:** Python 3.11

### Required AWS Permissions

- `lambda:UpdateFunctionCode`
- `lambda:GetFunction`
- `logs:FilterLogEvents`
- `ec2:*` (for automated script)
- `ssm:SendCommand` (for automated script)

---

## 🐛 Troubleshooting

### GitHub Actions fails:
- Check AWS credentials in GitHub Secrets
- Verify IAM user has Lambda permissions

### Automated script fails:
- Ensure EC2 permissions are configured
- Check SSM agent is running on instance
- Verify instance has internet access

### Makefile fails:
- Install Docker for `build-docker`
- Configure AWS CLI for `deploy`

---

## 📝 Next Steps

1. **Choose your automation method**
2. **Set up credentials/secrets**
3. **Test the automation**
4. **Integrate into your workflow**

**Recommended:** Start with GitHub Actions for automatic deployments!
