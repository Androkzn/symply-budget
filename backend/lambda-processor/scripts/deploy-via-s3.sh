#!/bin/bash
set -e

echo "=========================================="
echo "Lambda Deployment via S3"
echo "=========================================="

FUNCTION_NAME="inspection-report-processor"
REGION="${AWS_REGION:-us-east-1}"
ZIP_FILE="lambda-native-deploy.zip"

# Check if package exists
if [ ! -f "$ZIP_FILE" ]; then
    echo "Error: $ZIP_FILE not found"
    echo "Building package first..."
    ./native-deploy-build-only.sh || exit 1
fi

echo "Package size: $(ls -lh $ZIP_FILE | awk '{print $5}')"
echo ""

# Try to find existing S3 buckets
echo "Looking for existing S3 buckets..."
EXISTING_BUCKETS=$(aws s3 ls | grep simplehouseapp-lambda | awk '{print $3}' | head -1)

if [ -z "$EXISTING_BUCKETS" ]; then
    # Look for any lambda bucket
    EXISTING_BUCKETS=$(aws s3 ls | grep lambda-deploy | awk '{print $3}' | head -1)
fi

if [ -n "$EXISTING_BUCKETS" ]; then
    S3_BUCKET="$EXISTING_BUCKETS"
    echo "Using existing bucket: $S3_BUCKET"
else
    # Create S3 bucket for deployment
    S3_BUCKET="simplehouseapp-lambda-deployments"
    echo "Creating S3 bucket: $S3_BUCKET"
    aws s3 mb "s3://$S3_BUCKET" --region "$REGION" 2>/dev/null || {
        echo "Bucket creation failed, trying unique name..."
        S3_BUCKET="simplehouseapp-lambda-${RANDOM}"
        aws s3 mb "s3://$S3_BUCKET" --region "$REGION"
    }
fi

# S3 key with timestamp
S3_KEY="inspection-report-processor/$(date +%Y%m%d-%H%M%S)-lambda.zip"

# Upload to S3
echo "Uploading to S3..."
aws s3 cp "$ZIP_FILE" "s3://$S3_BUCKET/$S3_KEY"

# Update Lambda function from S3
echo "Updating Lambda function from S3..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --s3-key "$S3_KEY" \
    --region "$REGION" \
    --output json > /tmp/lambda-deploy-result.json

if [ $? -eq 0 ]; then
    LAST_MODIFIED=$(jq -r '.LastModified' /tmp/lambda-deploy-result.json 2>/dev/null || echo "N/A")
    CODE_SIZE=$(jq -r '.CodeSize' /tmp/lambda-deploy-result.json 2>/dev/null || echo "N/A")
    echo ""
    echo "=========================================="
    echo "✅ Deployment Complete!"
    echo "=========================================="
    echo "Function: $FUNCTION_NAME"
    echo "Size: $CODE_SIZE bytes"
    echo "Updated: $LAST_MODIFIED"
    echo "S3: s3://$S3_BUCKET/$S3_KEY"
else
    echo "❌ Deployment failed"
    exit 1
fi
