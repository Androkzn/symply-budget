#!/bin/bash
set -e

echo "🔧 Lambda Layer Rebuild (Binary Fix)"
echo "====================================="

LAYER_NAME="inspection-report-dependencies"
REGION="us-east-1"
FUNCTION_NAME="inspection-report-processor"

echo "✓ Layer: $LAYER_NAME"
echo "✓ Region: $REGION"
echo ""

# Step 1: Build layer with explicit Python 3.11 Linux wheels
echo "📦 Step 1: Building dependencies for Python 3.11 Linux..."
rm -rf layer-build
mkdir -p layer-build/python

# Install with explicit Python version and implementation
python3 -m pip install \
    -r requirements-layer.txt \
    -t layer-build/python \
    --platform manylinux2014_x86_64 \
    --python-version 3.11 \
    --implementation cp \
    --only-binary=:all: \
    --upgrade \
    --no-cache-dir

echo "✓ Dependencies installed"

# Step 2: Optimize
echo ""
echo "🧹 Step 2: Optimizing layer..."
find layer-build/python -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type d -name '*.dist-info' -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type f -name '*.pyc' -delete 2>/dev/null || true

echo "✓ Cleaned up unnecessary files"

# Verify critical files exist
echo ""
echo "🔍 Step 3: Verifying binary dependencies..."
if [ -f "layer-build/python/pydantic_core/_pydantic_core.cpython-311-x86_64-linux-gnu.so" ]; then
    echo "✓ pydantic_core binary found"
elif [ -f "layer-build/python/pydantic_core/_pydantic_core.so" ]; then
    echo "✓ pydantic_core binary found (generic)"
else
    echo "⚠️  Warning: pydantic_core binary not found"
    echo "Checking what we have:"
    ls -la layer-build/python/pydantic_core/ 2>/dev/null || echo "pydantic_core directory not found"
fi

# Step 4: Create layer zip
echo ""
echo "🗜️  Step 4: Creating layer package..."
cd layer-build
zip -r9 ../layer.zip python > /dev/null 2>&1
cd ..

LAYER_SIZE=$(ls -lh layer.zip | awk '{print $5}')
echo "✓ Layer package created: $LAYER_SIZE"

# Step 5: Publish layer
echo ""
echo "☁️  Step 5: Publishing layer to AWS..."
LAYER_VERSION=$(aws lambda publish-layer-version \
    --layer-name "$LAYER_NAME" \
    --description "Dependencies for inspection report processor (Fixed - $(date +%Y-%m-%d %H:%M))" \
    --zip-file fileb://layer.zip \
    --compatible-runtimes python3.11 \
    --region "$REGION" \
    --query 'Version' \
    --output text)

LAYER_ARN="arn:aws:lambda:$REGION:$(aws sts get-caller-identity --query Account --output text):layer:$LAYER_NAME:$LAYER_VERSION"
echo "✓ Layer published: Version $LAYER_VERSION"
echo "  ARN: $LAYER_ARN"

# Step 6: Update function
echo ""
echo "🔗 Step 6: Updating function with new layer..."

# Wait for function to be ready
echo "⏳ Waiting for function to be ready..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" 2>/dev/null || true

sleep 5

aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --layers "$LAYER_ARN" \
    --region "$REGION" \
    --query 'LastModified' \
    --output text

echo "✓ Function updated"

# Wait for update
echo "⏳ Waiting for configuration update..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

echo ""
echo "✅ Layer Rebuilt Successfully!"
echo "=================================="
echo "Layer: $LAYER_NAME (v$LAYER_VERSION)"
echo "Size: $LAYER_SIZE"
echo ""
echo "✨ Done! Now test with: ./scripts/test-lambda-deployment.sh"

# Cleanup
rm -rf layer-build
