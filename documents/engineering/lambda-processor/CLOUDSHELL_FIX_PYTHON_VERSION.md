# Fix: pydantic_core Import Error

## Problem
Lambda is Python 3.11, but CloudShell used a different Python version to build packages. The `pydantic_core._pydantic_core` module has native extensions that must match exactly.

## Solution: Use Lambda-Compatible Python 3.11

Run these commands in **AWS CloudShell**:

```bash
# Clean previous build
cd ~
rm -rf lambda-function.zip package lambda-processor

# Extract files
tar -xzf cloudshell-deploy.tar.gz
mkdir -p lambda-processor
mv handler.py job_state.py structured_logger.py batch_processor.py requirements.txt lambda-processor/
cd lambda-processor

# Check Python version
python3 --version

# If not Python 3.11, use Amazon Linux 2023 container method
# Create build script
cat > build.sh <<'EOF'
#!/bin/bash
set -e

# Create package directory
mkdir -p package

# Install dependencies for Python 3.11
pip3.11 install --target package/ -r requirements.txt 2>/dev/null || \
pip3 install --python-version 3.11 --only-binary=:all: --target package/ -r requirements.txt 2>/dev/null || \
pip3 install --target package/ -r requirements.txt

# Copy handlers
cp handler.py job_state.py structured_logger.py batch_processor.py package/

# Create zip
cd package
zip -r ../lambda-function.zip . > /dev/null
cd ..

echo "Package created: $(ls -lh lambda-function.zip | awk '{print $5}')"
EOF

chmod +x build.sh
./build.sh

# Upload to S3
aws s3 cp lambda-function.zip s3://simple-house-lambda-code/lambda-function.zip --region us-east-1

# Deploy
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --s3-bucket simple-house-lambda-code \
  --s3-key lambda-function.zip \
  --region us-east-1

# Wait and verify
sleep 15
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State,CodeSize]' \
  --output table

echo ""
echo "✅ Deployment complete with Python 3.11 compatible packages"
```

## Alternative: Use Docker Locally (if available)

If you have Docker on your Mac:

```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/lambda-processor

# Build with Lambda Python 3.11 container
docker run --rm -v "$PWD":/var/task public.ecr.aws/lambda/python:3.11 \
  bash -c "pip install -r requirements.txt -t package/ && \
  cp handler.py job_state.py structured_logger.py batch_processor.py package/ && \
  cd package && zip -r ../lambda-function.zip ."

# Deploy
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --s3-bucket simple-house-lambda-code \
  --s3-key lambda-function.zip \
  --region us-east-1
```

## Expected Success Log

After successful deployment, test should show:
```
[LOGGER] Starting report processing
[IMAGE-EXTRACT] Extracted X images
[R2-UPLOAD] Uploaded image {id}
```

No more `pydantic_core._pydantic_core` errors.
