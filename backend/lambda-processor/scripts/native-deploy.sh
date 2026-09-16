#!/bin/bash
set -e

# Configuration
FUNCTION_NAME="inspection-report-processor"
REGION="us-east-1"
BUILD_DIR="$(pwd)/native-build"
ZIP_FILE="lambda-native-deploy.zip"
PYTHON_VERSION="3.11"

echo "🐍 Native Lambda Deployment Script (No Docker Required)"
echo "========================================================"

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 not found. Please install Python 3.11+"
    exit 1
fi

CURRENT_PYTHON=$(python3 --version | awk '{print $2}')
echo "✓ Python version: $CURRENT_PYTHON"

# Check AWS credentials
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ Error: AWS credentials not configured. Please run 'aws configure'."
    exit 1
fi
echo "✓ AWS credentials configured"
echo ""

# Clean up previous build
echo "🧹 Cleaning up previous build..."
rm -rf "$BUILD_DIR"
rm -f "$ZIP_FILE"
mkdir -p "$BUILD_DIR"

# Create virtual environment for clean install
echo "🔨 Creating clean build environment..."
python3 -m venv "$BUILD_DIR/venv"
source "$BUILD_DIR/venv/bin/activate"

# Upgrade pip
pip install --upgrade pip > /dev/null 2>&1

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt -t "$BUILD_DIR/package" --platform manylinux2014_x86_64 --only-binary=:all: 2>&1 | grep -v "already satisfied" || true

# Copy Lambda function code
echo "📋 Copying Lambda code..."
cp handler.py job_state.py structured_logger.py batch_processor.py "$BUILD_DIR/package/"

# Create deployment zip
echo "🗜️  Creating deployment package..."
cd "$BUILD_DIR/package"
zip -r9 "../../$ZIP_FILE" . > /dev/null
cd ../..

# Deactivate venv
deactivate

ZIP_SIZE=$(ls -lh "$ZIP_FILE" | awk '{print $5}')
echo "✓ Package created: $ZIP_FILE ($ZIP_SIZE)"
echo ""

# Check package size
ZIP_BYTES=$(wc -c < "$ZIP_FILE")
if [ "$ZIP_BYTES" -gt 52428800 ]; then
    echo "⚠️  Warning: Package is larger than 50MB. Consider using Lambda Layers."
fi

# Deploy to AWS Lambda
echo "🚀 Deploying to AWS Lambda..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$REGION" \
    --output json > /tmp/lambda-deploy-result.json

if [ $? -eq 0 ]; then
    LAST_MODIFIED=$(jq -r '.LastModified' /tmp/lambda-deploy-result.json 2>/dev/null || echo "N/A")
    CODE_SIZE=$(jq -r '.CodeSize' /tmp/lambda-deploy-result.json 2>/dev/null || echo "N/A")
    echo "✅ Deployment successful!"
    echo "   Function: $FUNCTION_NAME"
    echo "   Region: $REGION"
    echo "   Size: $CODE_SIZE bytes"
    echo "   Updated: $LAST_MODIFIED"
    echo ""

    # Clean up
    echo "🧹 Cleaning up build artifacts..."
    rm -rf "$BUILD_DIR"
    rm -f /tmp/lambda-deploy-result.json

    echo "✨ Done! Lambda function deployed successfully."
else
    echo "❌ Deployment failed. Check the error above."
    exit 1
fi
