#!/bin/bash
set -e

echo "🐳 Lambda Layer Build (Docker)"
echo "=============================="

LAYER_NAME="inspection-report-dependencies"
REGION="us-east-1"
PYTHON_VERSION="python3.11"

echo "✓ Layer: $LAYER_NAME"
echo "✓ Region: $REGION"
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo "✓ Docker is running"
echo ""

# Step 1: Build layer in Docker
echo "📦 Step 1: Building dependencies in Docker..."
rm -rf layer-build
mkdir -p layer-build

# Build layer using Lambda Python runtime
docker run --rm \
    -v "$(pwd):/workspace" \
    -w /workspace \
    public.ecr.aws/lambda/python:3.11 \
    bash -c "
        pip install -r requirements-layer.txt -t /workspace/layer-build/python --no-cache-dir &&
        cd /workspace/layer-build/python &&
        find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true &&
        find . -type f -name '*.pyc' -delete 2>/dev/null || true &&
        find . -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true
    "

echo "✓ Dependencies built in Docker"

# Step 2: Create layer zip
echo ""
echo "🗜️  Step 2: Creating layer package..."
cd layer-build
zip -r9 ../layer.zip python > /dev/null 2>&1
cd ..

LAYER_SIZE=$(ls -lh layer.zip | awk '{print $5}')
echo "✓ Layer package created: $LAYER_SIZE"

# Step 3: Publish layer
echo ""
echo "☁️  Step 3: Publishing layer to AWS..."
LAYER_VERSION=$(aws lambda publish-layer-version \
    --layer-name "$LAYER_NAME" \
    --description "Dependencies for inspection report processor (Docker build - $(date +%Y-%m-%d))" \
    --zip-file fileb://layer.zip \
    --compatible-runtimes "$PYTHON_VERSION" \
    --region "$REGION" \
    --query 'Version' \
    --output text)

LAYER_ARN="arn:aws:lambda:$REGION:$(aws sts get-caller-identity --query Account --output text):layer:$LAYER_NAME:$LAYER_VERSION"
echo "✓ Layer published: Version $LAYER_VERSION"
echo "  ARN: $LAYER_ARN"

# Step 4: Update function to use new layer
FUNCTION_NAME="inspection-report-processor"
echo ""
echo "🔗 Step 4: Updating function to use new layer..."

# Wait for function to be ready
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" 2>/dev/null || true

aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --layers "$LAYER_ARN" \
    --region "$REGION" \
    --output json > /tmp/lambda-layer-update.json

echo "✓ Function updated with new layer"

# Wait for update
echo "⏳ Waiting for function update..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

echo ""
echo "✅ Layer Build Complete!"
echo "=================================="
echo "Layer: $LAYER_NAME (v$LAYER_VERSION)"
echo "Size: $LAYER_SIZE"
echo "Function: $FUNCTION_NAME"
echo ""
echo "✨ Done! Layer built with Docker for binary compatibility."

# Cleanup
rm -rf layer-build
rm -f /tmp/lambda-layer-update.json
