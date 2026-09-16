#!/bin/bash
set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse arguments
RUN_TEST=false
for arg in "$@"; do
  case $arg in
    --test|-t)
      RUN_TEST=true
      shift
      ;;
    --env=*)
      export DEPLOY_ENV="${arg#*=}"
      shift
      ;;
    *)
      ;;
  esac
done

# Source environment configuration
source "$SCRIPT_DIR/env-config.sh"

echo "🎯 Lambda Layer + Code Deployment"
echo "=================================="
display_env_info
[ "$RUN_TEST" = true ] && echo "✓ Test after deploy: enabled"
echo ""

# Step 1: Build dependencies layer
echo "📦 Step 1: Building dependencies layer..."
rm -rf layer-build
mkdir -p layer-build/python

# Install dependencies (excluding boto3/botocore - provided by Lambda runtime)
python3 -m pip install -r requirements-layer.txt -t layer-build/python --platform manylinux2014_x86_64 --python-version 3.11 --implementation cp --only-binary=:all: --upgrade --no-cache-dir

echo "🧹 Optimizing layer size..."
# Remove unnecessary files
find layer-build/python -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find layer-build/python -type f -name "*.pyc" -delete 2>/dev/null || true
find layer-build/python -type d -name "*.dist-info" -exec rm -rf {} + 2>/dev/null || true

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
    --description "Dependencies for $ENV_LABEL ($(date +%Y-%m-%d))" \
    --zip-file fileb://layer.zip \
    --compatible-runtimes "$PYTHON_VERSION" \
    --region "$AWS_REGION" \
    --query 'Version' \
    --output text)

LAYER_ARN="arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:layer:$LAYER_NAME:$LAYER_VERSION"
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
    --region "$AWS_REGION" \
    --output json > /tmp/lambda-code-update.json

CODE_SHA=$(jq -r '.CodeSha256' /tmp/lambda-code-update.json)
echo "✓ Function code updated (SHA: ${CODE_SHA:0:12}...)"

# Wait for code update to complete
echo ""
echo "⏳ Waiting for code update to complete..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION"

# Step 5: Attach layer to function
echo ""
echo "🔗 Step 5: Attaching layer to function..."
aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --layers "$LAYER_ARN" \
    --region "$AWS_REGION" \
    --output json > /tmp/lambda-config-update.json

# Wait for update to complete
echo "⏳ Waiting for configuration update..."
aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION"

echo ""
echo "✅ Deployment Complete!"
echo "=================================="
echo "Environment: $ENV_LABEL"
echo "Function: $FUNCTION_NAME"
echo "Layer: $LAYER_NAME (v$LAYER_VERSION)"
echo "Code size: $CODE_SIZE"
echo "Layer size: $LAYER_SIZE"
echo ""

# Run test if requested
if [ "$RUN_TEST" = true ]; then
    echo "🧪 Running deployment test..."
    echo ""
    export FUNCTION_NAME  # Pass to test script
    export AWS_REGION
    "$SCRIPT_DIR/test-lambda-deployment.sh"
    TEST_EXIT_CODE=$?

    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo ""
        echo "✨ Deployment and test complete!"
    else
        echo ""
        echo "⚠️  Deployment succeeded but test failed. Check logs above."
    fi
else
    echo "✨ Done! Your function is now using layers."
    echo ""
    echo "💡 Tip: Run with --test flag to verify deployment:"
    echo "   ./deploy-with-layer --env=$DEPLOY_ENV --test"
fi

echo ""
echo "Next deployments (code-only) will be much faster!"
echo "Just run: ./deploy-code-only --env=$DEPLOY_ENV"

# Cleanup
rm -rf layer-build code-build
rm -f /tmp/lambda-code-update.json /tmp/lambda-config-update.json
