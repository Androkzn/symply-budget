#!/bin/bash
set -e

# Lambda Deployment Script for Inspection Report Processor
# This script creates and deploys the AWS Lambda function for processing large PDFs (>32MB)

echo "=========================================="
echo "Lambda Deployment for Simple House"
echo "=========================================="
echo ""

# Configuration
FUNCTION_NAME="inspection-report-processor"
RUNTIME="python3.11"
HANDLER="handler.lambda_handler"
TIMEOUT=900
MEMORY_SIZE=3008  # 3GB (AWS default account limit, increase quota for larger files)
EPHEMERAL_STORAGE=1024  # 1GB
REGION="${AWS_REGION:-us-east-1}"

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: $ACCOUNT_ID"
echo "AWS Region: $REGION"
echo ""

# Check if IAM role exists
ROLE_NAME="lambda-inspection-processor-role"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo "Step 1: Creating IAM Role (if not exists)..."
if ! aws iam get-role --role-name "$ROLE_NAME" 2>/dev/null; then
    echo "Creating IAM role: $ROLE_NAME"

    # Create trust policy
    cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --description "Execution role for inspection report processor Lambda"

    # Attach basic execution policy
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

    # Create and attach S3/R2 access policy
    cat > /tmp/s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "*"
    }
  ]
}
EOF

    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name "S3Access" \
        --policy-document file:///tmp/s3-policy.json

    echo "Waiting 10 seconds for IAM role to propagate..."
    sleep 10
else
    echo "IAM role already exists: $ROLE_NAME"
fi

echo ""
echo "Step 2: Creating deployment package..."

# Clean up previous builds
rm -rf venv package lambda-function.zip

# Create virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt

# Create deployment package
mkdir -p package
pip install -q -r requirements.txt -t package/
cp handler.py package/
cd package
zip -q -r ../lambda-function.zip .
cd ..

echo "Deployment package created: lambda-function.zip ($(du -h lambda-function.zip | cut -f1))"

echo ""
echo "Step 3: Environment Variables Setup..."
echo ""
echo "IMPORTANT: You need to provide these environment variables:"
echo "1. ANTHROPIC_API_KEY (already set: sk-ant-api03-...)"
echo "2. CLOUDFLARE_ACCOUNT_ID"
echo "3. CLOUDFLARE_DATABASE_ID (D1 database ID)"
echo "4. CLOUDFLARE_API_TOKEN"
echo ""

# Check if function already exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
    echo "Lambda function already exists. Updating..."

    # Update function code
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://lambda-function.zip \
        --region "$REGION"

    # Update configuration
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --timeout "$TIMEOUT" \
        --memory-size "$MEMORY_SIZE" \
        --ephemeral-storage Size="$EPHEMERAL_STORAGE" \
        --region "$REGION"

    echo "Lambda function updated successfully!"
else
    echo "Creating new Lambda function..."

    # Create function
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime "$RUNTIME" \
        --role "$ROLE_ARN" \
        --handler "$HANDLER" \
        --zip-file fileb://lambda-function.zip \
        --timeout "$TIMEOUT" \
        --memory-size "$MEMORY_SIZE" \
        --ephemeral-storage Size="$EPHEMERAL_STORAGE" \
        --region "$REGION" \
        --environment "Variables={ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY in env before create}}"

    echo "Lambda function created successfully!"
fi

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Function ARN: arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function/${FUNCTION_NAME}"
echo ""
echo "Next steps:"
echo "1. Set remaining environment variables:"
echo "   aws lambda update-function-configuration \\"
echo "     --function-name $FUNCTION_NAME \\"
echo "     --region $REGION \\"
echo "     --environment 'Variables={ANTHROPIC_API_KEY=sk-ant-api03-...,CLOUDFLARE_ACCOUNT_ID=your-id,CLOUDFLARE_DATABASE_ID=your-db-id,CLOUDFLARE_API_TOKEN=your-token}'"
echo ""
echo "2. Test the function:"
echo "   aws lambda invoke --function-name $FUNCTION_NAME --region $REGION response.json"
echo ""
echo "3. View logs:"
echo "   aws logs tail /aws/lambda/$FUNCTION_NAME --follow --region $REGION"
echo ""
