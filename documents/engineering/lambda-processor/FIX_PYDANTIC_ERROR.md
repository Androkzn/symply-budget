# Fix: pydantic_core Import Error in Lambda

## The Problem

Your Lambda function is failing with:
```
Runtime.ImportModuleError: Unable to import module 'handler': No module named 'pydantic_core._pydantic_core'
```

**Root Cause:** The deployment package was built on macOS. The `pydantic_core` module is a compiled C extension that must be built for Linux (Lambda's runtime), not macOS.

## Solution Options

### Option 1: Use AWS CloudShell (Easiest - No Installation)

1. **Open AWS CloudShell:**
   - Go to: https://console.aws.amazon.com/cloudshell/
   - Click the CloudShell icon in the top navigation

2. **Upload files:**
   ```bash
   mkdir -p lambda-processor
   cd lambda-processor
   ```
   - Click **Actions** → **Upload file**
   - Upload `handler.py`
   - Upload `requirements.txt`

3. **Build the package:**
   ```bash
   rm -rf package lambda-function.zip
   mkdir -p package
   pip3 install --target package/ -r requirements.txt
   cp handler.py package/
   cd package && zip -r ../lambda-function.zip . && cd ..
   ```

4. **Download and deploy:**
   - Click **Actions** → **Download file**
   - Enter: `lambda-function.zip`
   - Download to your computer
   - Deploy:
     ```bash
     aws lambda update-function-code \
       --function-name inspection-report-processor \
       --zip-file fileb://lambda-function.zip \
       --region us-east-1
     ```

### Option 2: Install Docker Desktop (Recommended for Future)

1. **Install Docker Desktop:**
   - Download: https://www.docker.com/products/docker-desktop/
   - Install and start Docker Desktop

2. **Build:**
   ```bash
   cd lambda-processor
   ./build-lambda-docker.sh
   ```

3. **Deploy:**
   ```bash
   aws lambda update-function-code \
     --function-name inspection-report-processor \
     --zip-file fileb://lambda-function.zip \
     --region us-east-1
   ```

### Option 3: Use EC2 Instance

1. Launch a Linux EC2 instance (t2.micro is fine)
2. SSH into it
3. Follow the same build steps as CloudShell
4. Download the zip file via SCP

## Quick Fix Script (CloudShell)

Save this as `build-in-cloudshell.sh` and run in CloudShell:

```bash
#!/bin/bash
set -e

echo "Building Lambda package in CloudShell..."

# Clean up
rm -rf package lambda-function.zip

# Create package directory
mkdir -p package

# Install dependencies (Linux-compatible)
echo "Installing dependencies..."
pip3 install --target package/ -r requirements.txt

# Copy handler
cp handler.py package/

# Create zip
cd package
zip -r ../lambda-function.zip .
cd ..

echo "✅ Package created: lambda-function.zip"
echo "Size: $(du -h lambda-function.zip | cut -f1)"
echo ""
echo "Download with: Actions → Download file → lambda-function.zip"
```

## Verification

After deploying, check the logs:

```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

You should see:
- ✅ No more `pydantic_core` errors
- ✅ Handler imports successfully
- ✅ Function can process PDFs

## Why This Happens

- `anthropic` package depends on `pydantic`
- `pydantic` depends on `pydantic_core` (C extension)
- C extensions must be compiled for the target platform
- macOS binaries ≠ Linux binaries
- Lambda runs on Linux x86_64

## Prevention

Always build Lambda packages using:
- Docker (Linux container)
- AWS CloudShell (Linux environment)
- EC2 Linux instance
- Never build on macOS/Windows directly
