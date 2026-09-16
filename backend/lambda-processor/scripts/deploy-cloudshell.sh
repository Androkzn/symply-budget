#!/bin/bash
set -e

echo "=========================================="
echo "Deploying Lambda via CloudShell"
echo "=========================================="
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "📦 Preparing files for CloudShell..."
echo ""
echo "Step 1: Open AWS CloudShell in your browser:"
echo "👉 https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1"
echo ""
echo "Step 2: Upload these files to CloudShell:"
echo "   - handler.py"
echo "   - requirements.txt"
echo ""
echo "Step 3: Copy and paste these commands in CloudShell:"
echo ""
echo "─────────────────────────────────────────────────────────────"
cat << 'CLOUDSHELL'
# Build Lambda package
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip

# Deploy to Lambda
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1

# Verify
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State,CodeSize]' \
  --output table
CLOUDSHELL
echo "─────────────────────────────────────────────────────────────"
echo ""
echo "✅ Commands ready to copy!"
echo ""
echo "Alternative: If CloudShell credentials work, the package will deploy automatically."
