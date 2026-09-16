#!/bin/bash
set -e

echo "🚀 Setting up ALL environments (DEV, STAGING, PROD)"
echo "===================================================="
echo ""

PROD_FUNCTION="inspection-report-processor"
REGION="us-east-1"

# Get PROD configuration
echo "📋 Step 1: Getting PROD configuration..."
ROLE_ARN=$(aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'Role' \
  --output text)

TIMEOUT=$(aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'Timeout' \
  --output text)

MEMORY=$(aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'MemorySize' \
  --output text)

echo "✓ Role: $ROLE_ARN"
echo "✓ Timeout: $TIMEOUT seconds"
echo "✓ Memory: $MEMORY MB"

# Get environment variables from PROD
echo ""
echo "📋 Step 2: Getting PROD environment variables..."
aws lambda get-function-configuration \
  --function-name "$PROD_FUNCTION" \
  --region "$REGION" \
  --query 'Environment.Variables' \
  --output json > /tmp/prod-env-vars.json

echo "✓ Environment variables retrieved"

# Create minimal deployment package
echo ""
echo "📦 Step 3: Creating deployment package..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
rm -rf temp-build
mkdir -p temp-build
cp handler.py job_state.py structured_logger.py batch_processor.py temp-build/
cd temp-build
zip -r9 ../temp-function.zip . > /dev/null
cd ..

CODE_SIZE=$(ls -lh temp-function.zip | awk '{print $5}')
echo "✓ Package created: $CODE_SIZE"

# Function to create Lambda function
create_function() {
    local FUNC_NAME=$1
    local ENV_LABEL=$2

    echo ""
    echo "🔨 Creating $ENV_LABEL function ($FUNC_NAME)..."

    # Check if function exists
    if aws lambda get-function --function-name "$FUNC_NAME" --region "$REGION" &>/dev/null; then
        echo "ℹ️  Function $FUNC_NAME already exists. Updating code..."
        aws lambda update-function-code \
          --function-name "$FUNC_NAME" \
          --zip-file fileb://temp-function.zip \
          --region "$REGION" \
          --output json > /dev/null
        echo "✅ $ENV_LABEL function updated"
    else
        # Modify env vars for this environment
        if [ "$ENV_LABEL" != "PROD" ]; then
            # Update R2_BUCKET_NAME for non-prod environments
            ENV_LOWER=$(echo "$ENV_LABEL" | tr '[:upper:]' '[:lower:]')
            jq --arg bucket "simple-house-reports-${ENV_LOWER}" \
               '{Variables: (. + {R2_BUCKET_NAME: $bucket})}' \
               /tmp/prod-env-vars.json > /tmp/${ENV_LOWER}-env.json
            ENV_VARS_FILE="/tmp/${ENV_LOWER}-env.json"
        else
            jq '{Variables: .}' /tmp/prod-env-vars.json > /tmp/prod-env.json
            ENV_VARS_FILE="/tmp/prod-env.json"
        fi

        aws lambda create-function \
          --function-name "$FUNC_NAME" \
          --runtime python3.11 \
          --role "$ROLE_ARN" \
          --handler handler.lambda_handler \
          --timeout "$TIMEOUT" \
          --memory-size "$MEMORY" \
          --region "$REGION" \
          --zip-file fileb://temp-function.zip \
          --description "Inspection report processor - $ENV_LABEL" \
          --output json > /dev/null

        echo "✅ $ENV_LABEL function created"

        # Wait for function to be active
        echo "   Waiting for function to be ready..."
        aws lambda wait function-active \
          --function-name "$FUNC_NAME" \
          --region "$REGION"

        # Update environment variables separately
        echo "   Setting environment variables..."
        aws lambda update-function-configuration \
          --function-name "$FUNC_NAME" \
          --environment file://$ENV_VARS_FILE \
          --region "$REGION" \
          --output json > /dev/null

        echo "✅ Environment variables set"
    fi
}

# Create functions
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Creating Lambda functions..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

create_function "inspection-report-processor-dev" "DEV"
create_function "inspection-report-processor-staging" "STAGING"
# PROD already exists, but ensure it has latest code
create_function "inspection-report-processor" "PROD"

# Cleanup
rm -f temp-function.zip
rm -f /tmp/prod-env-vars.json /tmp/dev-env.json /tmp/staging-env.json /tmp/prod-env.json

# Deploy with layers to all environments
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Deploying with layers to all environments..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$SCRIPT_DIR/.."

echo ""
echo "📦 DEV Environment"
echo "──────────────────"
./deploy-dev-layer

echo ""
echo "📦 STAGING Environment"
echo "──────────────────────────"
./deploy-staging-layer

echo ""
echo "📦 PROD Environment"
echo "───────────────────"
./deploy-prod-layer

# Verification
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📊 All Lambda functions:"
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `inspection-report`)].{Name:FunctionName,Runtime:Runtime,State:State,Updated:LastModified}' \
  --output table \
  --region "$REGION"

echo ""
echo "🎯 Quick Deploy Commands:"
echo "  ./deploy-dev              # Deploy to DEV"
echo "  ./deploy-staging          # Deploy to STAGING"
echo "  ./deploy-prod             # Deploy to PRODUCTION"
echo ""
echo "🧪 Test Deployments:"
echo "  ./deploy-dev --test       # Deploy + test DEV"
echo "  ./deploy-staging --test   # Deploy + test STAGING"
echo "  ./deploy-prod --test      # Deploy + test PROD"
echo ""
echo "✨ All environments ready!"
