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

echo "⚡ Fast Code-Only Deployment"
echo "============================"
display_env_info
[ "$RUN_TEST" = true ] && echo "✓ Test after deploy: enabled"
echo ""

# Build function code (code only, no dependencies)
echo "📝 Building function code..."
rm -rf code-build
mkdir -p code-build

# Copy only Python code (include multi-provider adapters + catalog)
cp handler.py job_state.py structured_logger.py batch_processor.py \
   model_catalog.py ai_adapters.py code-build/

# Create code zip
cd code-build
zip -r9 ../function-code.zip . > /dev/null
cd ..

CODE_SIZE=$(ls -lh function-code.zip | awk '{print $5}')
echo "✓ Package created: $CODE_SIZE"

# Deploy
echo ""
echo "🚀 Deploying..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function-code.zip \
    --region "$AWS_REGION" \
    --output json > /tmp/lambda-deploy-result.json

if [ $? -eq 0 ]; then
    LAST_MODIFIED=$(jq -r '.LastModified' /tmp/lambda-deploy-result.json 2>/dev/null || echo "N/A")
    CODE_SHA=$(jq -r '.CodeSha256' /tmp/lambda-deploy-result.json | cut -c1-12)

    echo ""
    echo "✅ Deployment successful!"
    echo "   SHA: $CODE_SHA..."
    echo "   Size: $CODE_SIZE"
    echo "   Updated: $LAST_MODIFIED"
    echo ""

    # Run test if requested
    if [ "$RUN_TEST" = true ]; then
        echo "🧪 Running deployment test..."
        echo ""
        export FUNCTION_NAME  # Pass to test script
        "$SCRIPT_DIR/test-lambda-deployment.sh"
        TEST_EXIT_CODE=$?

        if [ $TEST_EXIT_CODE -eq 0 ]; then
            echo ""
            echo "✨ Deployment and test complete!"
        else
            echo ""
            echo "⚠️  Deployment succeeded but test failed. Check logs above."
            exit $TEST_EXIT_CODE
        fi
    else
        echo "✨ Done!"
        echo ""
        echo "💡 Tip: Run with --test flag to verify deployment:"
        echo "   ./deploy-code-only --test"
    fi
else
    echo "❌ Deployment failed"
    exit 1
fi

# Cleanup
rm -rf code-build
rm -f /tmp/lambda-deploy-result.json
