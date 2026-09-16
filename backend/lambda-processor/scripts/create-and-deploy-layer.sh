#!/bin/bash
set -e

# Parse arguments
RUN_TEST=false
if [[ "$1" == "--test" ]] || [[ "$1" == "-t" ]]; then
    RUN_TEST=true
fi

echo "🎯 Lambda Layer + Code Deployment"
echo "=================================="

FUNCTION_NAME="inspection-report-processor"
LAYER_NAME="inspection-report-dependencies"
REGION="us-east-1"
PYTHON_VERSION="python3.11"

echo "✓ Function: $FUNCTION_NAME"
echo "✓ Layer: $LAYER_NAME"
echo "✓ Region: $REGION"
[ "$RUN_TEST" = true ] && echo "✓ Test after deploy: enabled"
echo ""

# Step 1: Build dependencies layer
echo "📦 Step 1: Building dependencies layer..."
rm -rf layer-build
mkdir -p layer-build/python

# Install dependencies (excluding boto3/botocore - provided by Lambda runtime)
python3 -m pip install -r requirements-layer.txt -t layer-build/python --platform manylinux2014_x86_64 --only-binary=:all: --quiet

echo "🧹 Optimizing layer size..."
# Remove unnecessary files
find layer-build/python -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type f -name "*.pyc" -delete 2>/dev/null || true
find layer-build/python -type f -name "*.dist-info/*" -delete 2>/dev/null || true

# Create layer zip
cd layer-build
zip -r9 ../layer.zip python > /dev/null 2>&1
cd ..

LAYER_SIZE=$(ls -lh layer.zip | awk '{print $5}')
echo "✓ Layer package created: $LAYER_SIZE"

# Step 2: Publish layer
echo ""
echo "☁️  Step 2: Publishing layer to AWS..."
LAYER_VERSION=$(aws lambda publish-layer-version \
    --layer-name "$LAYER_NAME" \
    --description "Dependencies for inspection report processor ($(date +%Y-%m-%d))" \
    --zip-file fileb://layer.zip \
    --compatible-runtimes "$PYTHON_VERSION" \
    --region "$REGION" \
    --query 'Version' \
    --output text)

LAYER_ARN="arn:aws:lambda:$REGION:$(aws sts get-caller-identity --query Account --output text):layer:$LAYER_NAME:$LAYER_VERSION"
echo "✓ Layer published: Version $LAYER_VERSION"
echo "  ARN: $LAYER_ARN"

# Step 3: Build function code (code only, no dependencies)
echo ""
echo "📝 Step 3: Building function code..."
rm -rf code-build
mkdir -p code-build

# Copy only Python code
cp handler.py job_state.py structured_logger.py batch_processor.py code-build/

# Create code zip
cd code-build
zip -r9 ../function-code.zip . > /dev/null
cd ..

CODE_SIZE=$(ls -lh function-code.zip | awk '{print $5}')
echo "✓ Function code package created: $CODE_SIZE"

# Step 4: Update function code
echo ""
echo "🚀 Step 4: Deploying function code..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function-code.zip \
    --region "$REGION" \
    --output json > /tmp/lambda-code-update.json

CODE_SHA=$(jq -r '.CodeSha256' /tmp/lambda-code-update.json)
echo "✓ Function code updated (SHA: ${CODE_SHA:0:12}...)"

# Step 5: Attach layer to function
echo ""
echo "🔗 Step 5: Attaching layer to function..."
aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --layers "$LAYER_ARN" \
    --region "$REGION" \
    --output json > /tmp/lambda-config-update.json

# Wait for update to complete
echo "⏳ Waiting for configuration update..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION"

echo ""
echo "✅ Deployment Complete!"
echo "=================================="
echo "Function: $FUNCTION_NAME"
echo "Layer: $LAYER_NAME (v$LAYER_VERSION)"
echo "Code size: $CODE_SIZE"
echo "Layer size: $LAYER_SIZE"
echo ""

# Run test if requested
if [ "$RUN_TEST" = true ]; then
    echo "🧪 Running deployment test..."
    echo ""
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/test-lambda-deployment.sh"
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo ""
        echo "✨ Deployment and test complete!"
    else
        echo ""
        echo "⚠️  Deployment succeeded but test failed. Check logs above."
        # Don't exit with error - deployment was successful
    fi
else
    echo "✨ Done! Your function is now using layers."
    echo ""
    echo "💡 Tip: Run with --test flag to verify deployment:"
    echo "   ./deploy-with-layer --test"
fi

echo ""
echo "Next deployments (code-only) will be much faster!"
echo "Just run: ./deploy-code-only"

# Cleanup
rm -rf layer-build code-build
rm -f /tmp/lambda-code-update.json /tmp/lambda-config-update.json
