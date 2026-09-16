#!/bin/bash
set -e

# Configuration
FUNCTION_NAME="inspection-report-processor"
REGION="us-east-1"
BUILD_DIR="$(pwd)/docker-build"
ZIP_FILE="lambda-docker-deploy.zip"

echo "🐳 Docker-based Lambda Deployment Script"
echo "=========================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ Error: AWS credentials not configured. Please run 'aws configure'."
    exit 1
fi

echo "✓ Docker is running"
echo "✓ AWS credentials configured"
echo ""

# Clean up previous build
echo "🧹 Cleaning up previous build..."
rm -rf "$BUILD_DIR"
rm -f "$ZIP_FILE"
mkdir -p "$BUILD_DIR"

# Build Docker image
echo "🔨 Building Lambda package with Docker..."
docker build -f Dockerfile.lambda -t lambda-builder:latest .

# Extract the built package from Docker
echo "📦 Extracting package from Docker container..."
CONTAINER_ID=$(docker create lambda-builder:latest)
docker cp "$CONTAINER_ID:/asset/." "$BUILD_DIR/"
docker rm "$CONTAINER_ID"

# Create deployment zip
echo "🗜️  Creating deployment package..."
cd "$BUILD_DIR"
zip -r9 "../$ZIP_FILE" . > /dev/null
cd ..

ZIP_SIZE=$(ls -lh "$ZIP_FILE" | awk '{print $5}')
echo "✓ Package created: $ZIP_FILE ($ZIP_SIZE)"
echo ""

# Deploy to AWS Lambda
echo "🚀 Deploying to AWS Lambda..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    --region "$REGION" \
    --output json > /tmp/lambda-deploy-result.json

if [ $? -eq 0 ]; then
    LAST_MODIFIED=$(jq -r '.LastModified' /tmp/lambda-deploy-result.json)
    CODE_SIZE=$(jq -r '.CodeSize' /tmp/lambda-deploy-result.json)
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
