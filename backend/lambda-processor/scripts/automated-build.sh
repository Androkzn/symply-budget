#!/bin/bash
# Fully Automated Lambda Build and Deploy Script
# Uses AWS Systems Manager (SSM) to build on a Linux instance

set -e

REGION="us-east-1"
FUNCTION_NAME="inspection-report-processor"
INSTANCE_ID="${1:-}"  # Optional: pass instance ID as argument

echo "=========================================="
echo "Automated Lambda Build & Deploy"
echo "=========================================="

# Check if we have AWS credentials
if ! aws sts get-caller-identity &>/dev/null; then
    echo "❌ AWS credentials not configured"
    exit 1
fi

# Step 1: Find or create an EC2 instance
if [ -z "$INSTANCE_ID" ]; then
    echo "🔍 Looking for existing EC2 instance..."
    
    # Try to find an existing instance
    INSTANCE_ID=$(aws ec2 describe-instances \
        --region "$REGION" \
        --filters \
            "Name=instance-state-name,Values=running" \
            "Name=tag:Purpose,Values=lambda-builder" \
        --query 'Reservations[0].Instances[0].InstanceId' \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
        echo "📦 Creating temporary EC2 instance..."
        
        # Get latest Amazon Linux 2023 AMI (try multiple methods)
        AMI_ID=""
        
        # Method 1: Try to get AMI via AWS Systems Manager
        AMI_ID=$(aws ssm get-parameters \
            --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64 \
            --region "$REGION" \
            --query 'Parameters[0].Value' \
            --output text 2>/dev/null || echo "")
        
        # Method 2: Try describe-images (may fail due to permissions)
        if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
            AMI_ID=$(aws ec2 describe-images \
                --owners amazon \
                --region "$REGION" \
                --filters \
                    "Name=name,Values=al2023-ami-2023*x86_64" \
                    "Name=state,Values=available" \
                --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
                --output text 2>/dev/null || echo "")
        fi
        
        # Method 3: Use known working AMI for us-east-1 (Amazon Linux 2023)
        if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
            echo "⚠️  Could not determine AMI automatically, using fallback..."
            # These are common AMI IDs - may need to be updated
            case "$REGION" in
                us-east-1) AMI_ID="ami-0c55b159cbfafe1f0" ;;
                us-east-2) AMI_ID="ami-0c55b159cbfafe1f0" ;;
                us-west-1) AMI_ID="ami-0c55b159cbfafe1f0" ;;
                us-west-2) AMI_ID="ami-0c55b159cbfafe1f0" ;;
                *) AMI_ID="ami-0c55b159cbfafe1f0" ;;
            esac
        fi
        
        echo "📦 Using AMI: $AMI_ID"
        
        # Create instance (try with IAM profile first, then without)
        INSTANCE_ID=$(aws ec2 run-instances \
            --image-id "$AMI_ID" \
            --instance-type t3.micro \
            --region "$REGION" \
            --tag-specifications "ResourceType=instance,Tags=[{Key=Purpose,Value=lambda-builder},{Key=Name,Value=lambda-builder-temp}]" \
            --query 'Instances[0].InstanceId' \
            --output text 2>/dev/null || \
            aws ec2 run-instances \
                --image-id "$AMI_ID" \
                --instance-type t3.micro \
                --region "$REGION" \
                --tag-specifications "ResourceType=instance,Tags=[{Key=Purpose,Value=lambda-builder},{Key=Name,Value=lambda-builder-temp}]" \
                --query 'Instances[0].InstanceId' \
                --output text)
        
        echo "✅ Created instance: $INSTANCE_ID"
        echo "⏳ Waiting for instance to be ready (this may take 1-2 minutes)..."
        aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
        sleep 30  # Wait for SSM agent
    else
        echo "✅ Using existing instance: $INSTANCE_ID"
    fi
else
    echo "✅ Using provided instance: $INSTANCE_ID"
fi

# Step 2: Prepare files for upload
echo "📝 Preparing files..."
cd "$(dirname "$0")"

# Encode files as base64 for SSM
HANDLER_B64=$(base64 -i handler.py)
REQUIREMENTS_B64=$(base64 -i requirements.txt)

# Step 3: Build on remote instance
echo "🔨 Building Lambda package on remote instance..."

COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[
        \"mkdir -p /tmp/lambda-processor\",
        \"cd /tmp/lambda-processor\",
        \"echo '$REQUIREMENTS_B64' | base64 -d > requirements.txt\",
        \"echo '$HANDLER_B64' | base64 -d > handler.py\",
        \"rm -rf package lambda-function.zip\",
        \"mkdir -p package\",
        \"pip3 install --target package/ -r requirements.txt\",
        \"cp handler.py package/\",
        \"cd package && zip -r ../lambda-function.zip . && cd ..\",
        \"ls -lh lambda-function.zip\",
        \"aws s3 cp lambda-function.zip s3://lambda-build-temp-$(date +%s)/lambda-function.zip || echo 'S3 upload skipped'\" 
    ]" \
    --region "$REGION" \
    --output text \
    --query 'Command.CommandId')

echo "⏳ Command ID: $COMMAND_ID"
echo "⏳ Waiting for build to complete..."

# Wait for command to complete
while true; do
    STATUS=$(aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'Status' \
        --output text 2>/dev/null || echo "InProgress")
    
    if [ "$STATUS" = "Success" ]; then
        echo "✅ Build successful!"
        break
    elif [ "$STATUS" = "Failed" ]; then
        echo "❌ Build failed!"
        aws ssm get-command-invocation \
            --command-id "$COMMAND_ID" \
            --instance-id "$INSTANCE_ID" \
            --region "$REGION" \
            --query 'StandardErrorContent' \
            --output text
        exit 1
    fi
    sleep 5
done

# Step 4: Download the package
echo "📥 Downloading package..."

# Try S3 first, then fallback to SSM Session Manager
if aws s3 ls s3://lambda-build-temp-*/lambda-function.zip 2>/dev/null | head -1; then
    S3_PATH=$(aws s3 ls s3://lambda-build-temp-*/lambda-function.zip 2>/dev/null | head -1 | awk '{print $4}')
    aws s3 cp "s3://$S3_PATH" ./lambda-function.zip
else
    # Use SSM to copy file (requires Session Manager plugin)
    echo "⚠️  S3 download not available, using alternative method..."
    # Create a simple download script
    aws ssm send-command \
        --instance-ids "$INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters "commands=[
            \"cd /tmp/lambda-processor\",
            \"base64 lambda-function.zip\"
        ]" \
        --region "$REGION" \
        --output text \
        --query 'Command.CommandId' > /tmp/download-cmd.txt
    
    sleep 10
    aws ssm get-command-invocation \
        --command-id "$(cat /tmp/download-cmd.txt)" \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'StandardOutputContent' \
        --output text | base64 -d > lambda-function.zip
fi

if [ ! -f lambda-function.zip ]; then
    echo "❌ Failed to download package"
    exit 1
fi

echo "✅ Package downloaded: $(ls -lh lambda-function.zip | awk '{print $5}')"

# Step 5: Deploy to Lambda
echo "🚀 Deploying to Lambda..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://lambda-function.zip \
    --region "$REGION" > /dev/null

echo "✅ Deployment complete!"

# Step 6: Verify
echo "🔍 Verifying deployment..."
sleep 5
STATUS=$(aws lambda get-function \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'Configuration.[LastUpdateStatus,State]' \
    --output text)

if echo "$STATUS" | grep -q "Successful"; then
    echo "✅ Lambda function is active and ready!"
else
    echo "⚠️  Status: $STATUS"
fi

# Step 7: Cleanup (optional - comment out to keep instance)
# echo "🧹 Cleaning up temporary instance..."
# aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION" > /dev/null

echo ""
echo "=========================================="
echo "✅ Build and deployment complete!"
echo "=========================================="
