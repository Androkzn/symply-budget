#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       🚀 AUTOMATED LAMBDA DEPLOYMENT & TESTING                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

REGION="us-east-1"
FUNCTION_NAME="inspection-report-processor"
REPORT_ID="28fd554e-b641-45ea-97d3-afe8f0509854"
HOUSEHOLD_ID="b5e4fe57-b3dc-46dc-9c20-98d78bf4407c"

# Step 1: Find correct Amazon Linux AMI
echo "📦 Step 1: Finding Amazon Linux 2023 AMI..."
AMI_ID=$(aws ec2 describe-images \
    --owners amazon \
    --filters \
        "Name=name,Values=al2023-ami-2023*-kernel-*-x86_64" \
        "Name=state,Values=available" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
    # Fallback: Use known working AMI for us-east-1
    AMI_ID="ami-0c101f26f147fa7fd"  # Amazon Linux 2023
    echo "⚠️  Using fallback AMI: $AMI_ID"
else
    echo "✅ Found AMI: $AMI_ID"
fi

# Step 2: Check for existing instance
echo ""
echo "🔍 Step 2: Looking for existing build instance..."
INSTANCE_ID=$(aws ec2 describe-instances \
    --filters \
        "Name=instance-state-name,Values=running" \
        "Name=tag:Purpose,Values=lambda-builder" \
    --query 'Reservations[0].Instances[0].InstanceId' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo "🏗️  Creating new EC2 instance for building..."
    
    # Create instance
    INSTANCE_ID=$(aws ec2 run-instances \
        --image-id "$AMI_ID" \
        --instance-type t3.micro \
        --iam-instance-profile Name=SSMInstanceProfile \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Purpose,Value=lambda-builder},{Key=Name,Value=lambda-builder-temp}]" \
        --query 'Instances[0].InstanceId' \
        --output text \
        --region "$REGION" 2>/dev/null || \
        aws ec2 run-instances \
            --image-id "$AMI_ID" \
            --instance-type t3.micro \
            --tag-specifications "ResourceType=instance,Tags=[{Key=Purpose,Value=lambda-builder},{Key=Name,Value=lambda-builder-temp}]" \
            --query 'Instances[0].InstanceId' \
            --output text \
            --region "$REGION")
    
    if [ -z "$INSTANCE_ID" ]; then
        echo "❌ Failed to create EC2 instance"
        echo ""
        echo "Alternative: Use CloudShell manually"
        echo "Run: bash deploy-cloudshell.sh"
        exit 1
    fi
    
    echo "✅ Created instance: $INSTANCE_ID"
    echo "⏳ Waiting for instance to be ready..."
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
    sleep 45  # Wait for SSM agent
else
    echo "✅ Using existing instance: $INSTANCE_ID"
fi

# Step 3: Build package on remote instance
echo ""
echo "🔨 Step 3: Building Lambda package on Linux..."

# Encode files
HANDLER_B64=$(base64 -i handler.py | tr -d '\n')
REQUIREMENTS_B64=$(base64 -i requirements.txt | tr -d '\n')

# Send build command
COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "{\"commands\":[\"cd /tmp\",\"rm -rf lambda-processor\",\"mkdir -p lambda-processor\",\"cd lambda-processor\",\"echo '$REQUIREMENTS_B64' | base64 -d > requirements.txt\",\"echo '$HANDLER_B64' | base64 -d > handler.py\",\"rm -rf package lambda-function.zip\",\"mkdir -p package\",\"pip3 install --target package/ -r requirements.txt --no-cache-dir\",\"cp handler.py package/\",\"cd package && zip -r ../lambda-function.zip . -q && cd ..\",\"ls -lh lambda-function.zip\",\"echo BUILD_COMPLETE\"]}" \
    --region "$REGION" \
    --output text \
    --query 'Command.CommandId')

echo "📝 Build command ID: $COMMAND_ID"
echo "⏳ Building (this takes ~3 minutes)..."

# Wait for build to complete
for i in {1..40}; do
    sleep 5
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
    
    echo -n "."
done
echo ""

# Step 4: Download package
echo ""
echo "📥 Step 4: Downloading package..."

# Get package via SSM
DOWNLOAD_CMD=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters '{"commands":["cd /tmp/lambda-processor","base64 lambda-function.zip"]}' \
    --region "$REGION" \
    --output text \
    --query 'Command.CommandId')

sleep 10

aws ssm get-command-invocation \
    --command-id "$DOWNLOAD_CMD" \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'StandardOutputContent' \
    --output text | base64 -d > lambda-function.zip

if [ ! -f lambda-function.zip ] || [ ! -s lambda-function.zip ]; then
    echo "❌ Failed to download package"
    exit 1
fi

echo "✅ Downloaded: $(ls -lh lambda-function.zip | awk '{print $5}')"

# Step 5: Deploy to Lambda
echo ""
echo "🚀 Step 5: Deploying to Lambda..."
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://lambda-function.zip \
    --region "$REGION" \
    --query 'LastUpdateStatus' \
    --output text

sleep 10

STATUS=$(aws lambda get-function \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --query 'Configuration.[LastUpdateStatus,State]' \
    --output text)

echo "✅ Lambda status: $STATUS"

# Step 6: Reprocess report
echo ""
echo "🔄 Step 6: Reprocessing report with image extraction..."
cd ..

# Clean existing data
echo "   Cleaning existing data..."
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "DELETE FROM task_drafts WHERE report_id = '$REPORT_ID'; DELETE FROM findings WHERE report_id = '$REPORT_ID'; DELETE FROM report_images WHERE report_id = '$REPORT_ID';" \
  >/dev/null 2>&1

# Trigger Lambda
echo "   Triggering Lambda..."
JOB_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

cat > /tmp/lambda-payload.json << PAYLOAD
{
  "jobId": "$JOB_ID",
  "reportId": "$REPORT_ID",
  "householdId": "$HOUSEHOLD_ID",
  "pdfS3Bucket": "simple-house-reports",
  "pdfS3Key": "reports/$HOUSEHOLD_ID/$REPORT_ID/Electrical report.pdf"
}
PAYLOAD

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload file:///tmp/lambda-payload.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/lambda-response.json >/dev/null

RESPONSE=$(cat /tmp/lambda-response.json)
if echo "$RESPONSE" | grep -q "errorMessage"; then
    echo "❌ Lambda invocation failed:"
    echo "$RESPONSE" | jq .
    exit 1
fi

echo "✅ Lambda processing started (Job ID: $JOB_ID)"
echo "⏳ Waiting for processing to complete (~2-5 minutes)..."

# Wait for processing
for i in {1..60}; do
    sleep 5
    
    # Check if images are being created
    COUNT=$(npx wrangler d1 execute simple-house-db --env production --remote \
        --command "SELECT COUNT(*) as c FROM report_images WHERE report_id = '$REPORT_ID'" \
        2>/dev/null | grep '"c"' | grep -o '[0-9]*' | head -1 || echo "0")
    
    if [ "$COUNT" -gt 0 ]; then
        echo "✅ Processing complete! Found $COUNT images"
        break
    fi
    
    echo -n "."
done
echo ""

# Step 7: Verify results
echo ""
echo "🔍 Step 7: Verifying image extraction..."
echo ""

bash test-image-extraction.sh

# Cleanup (optional)
# echo ""
# echo "🧹 Cleanup: Terminating build instance..."
# aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                   ✅ DEPLOYMENT COMPLETE!                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next: Check the app to see images linked to task drafts!"
echo ""
