#!/bin/bash
# Simplified Automated Lambda Build
# Uses GitHub Actions or provides clear instructions

set -e

REGION="us-east-1"
FUNCTION_NAME="inspection-report-processor"

echo "=========================================="
echo "Automated Lambda Build & Deploy"
echo "=========================================="

# Check if we have AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
    echo "❌ AWS credentials not configured"
    exit 1
fi

# Check if we have an existing package
if [ -f "lambda-function.zip" ]; then
    echo "📦 Found existing package: lambda-function.zip"
    read -p "Use existing package? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "✅ Using existing package"
        SKIP_BUILD=true
    fi
fi

if [ "$SKIP_BUILD" != "true" ]; then
    echo ""
    echo "🔨 Building Lambda package..."
    echo ""
    echo "Since EC2 permissions are not available, here are your options:"
    echo ""
    echo "Option 1: Use GitHub Actions (Recommended)"
    echo "  - Push code to GitHub"
    echo "  - GitHub Actions will build and deploy automatically"
    echo "  - File: .github/workflows/deploy-lambda.yml"
    echo ""
    echo "Option 2: Build manually in CloudShell"
    echo "  1. Open: https://console.aws.amazon.com/cloudshell/"
    echo "  2. Run the commands from CLOUDSHELL_COMMANDS.sh"
    echo "  3. Download lambda-function.zip"
    echo "  4. Place it in this directory"
    echo ""
    echo "Option 3: Use Docker (if installed)"
    if command -v docker &> /dev/null; then
        echo "  ✅ Docker is installed!"
        read -p "Build with Docker? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ./build-lambda-docker.sh
            SKIP_BUILD=true
        fi
    else
        echo "  ❌ Docker not installed"
        echo "  Install: https://www.docker.com/products/docker-desktop/"
    fi
    
    if [ "$SKIP_BUILD" != "true" ]; then
        echo ""
        echo "⚠️  Please build the package using one of the options above"
        echo "   Then place lambda-function.zip in this directory and run this script again"
        exit 1
    fi
fi

# Verify package exists
if [ ! -f "lambda-function.zip" ]; then
    echo "❌ lambda-function.zip not found"
    exit 1
fi

echo ""
echo "📦 Package found: $(ls -lh lambda-function.zip | awk '{print $5}')"
echo ""

# Deploy to Lambda
echo "🚀 Deploying to Lambda..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://lambda-function.zip \
    --region "$REGION" > /dev/null

echo "✅ Deployment complete!"

# Verify
echo "🔍 Verifying deployment..."
sleep 5
STATUS=$(aws lambda get-function \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'Configuration.[LastUpdateStatus,State]' \
    --output text)

if echo "$STATUS" | grep -q "Successful"; then
    echo "✅ Lambda function is active and ready!"
    echo ""
    echo "Function Status:"
    aws lambda get-function \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --query 'Configuration.[Runtime,MemorySize,Timeout,LastModified]' \
        --output table
else
    echo "⚠️  Status: $STATUS"
fi

echo ""
echo "=========================================="
echo "✅ Deployment complete!"
echo "=========================================="
