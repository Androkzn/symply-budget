#!/bin/bash
# Build Lambda package using AWS Systems Manager (SSM) on an existing EC2 instance
# This is faster than creating a new instance

set -e

REGION="us-east-1"
INSTANCE_ID="${1:-}"  # Pass instance ID as argument, or we'll create one

if [ -z "$INSTANCE_ID" ]; then
    echo "No instance ID provided. Creating a temporary EC2 instance..."
    
    # Create a minimal EC2 instance for building
    INSTANCE_ID=$(aws ec2 run-instances \
        --image-id ami-0c55b159cbfafe1f0 \
        --instance-type t3.micro \
        --region "$REGION" \
        --query 'Instances[0].InstanceId' \
        --output text)
    
    echo "Created instance: $INSTANCE_ID"
    echo "Waiting for instance to be ready..."
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
    sleep 30  # Wait for SSM agent to be ready
fi

echo "Using instance: $INSTANCE_ID"

# Upload files using SSM
echo "Uploading files..."
aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=[
        "mkdir -p /tmp/lambda-processor",
        "cd /tmp/lambda-processor"
    ]' \
    --region "$REGION" > /dev/null

# We need to upload the files first - let's use a different approach
# Create a build script and execute it via SSM
cat > /tmp/build-lambda.sh << 'BUILDSCRIPT'
#!/bin/bash
cd /tmp/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package

# Install dependencies
pip3 install --target package/ -r requirements.txt

# Copy handler
cp handler.py package/

# Create zip
cd package
zip -r ../lambda-function.zip .
cd ..

echo "Build complete. Size: $(du -h lambda-function.zip | cut -f1)"
BUILDSCRIPT

# For now, let's use a simpler approach - create the files inline
echo "Building package on remote instance..."

# Create handler.py on remote
HANDLER_CONTENT=$(cat handler.py | base64)
REQUIREMENTS_CONTENT=$(cat requirements.txt | base64)

aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[
        \"mkdir -p /tmp/lambda-processor\",
        \"cd /tmp/lambda-processor\",
        \"echo '$REQUIREMENTS_CONTENT' | base64 -d > requirements.txt\",
        \"echo '$HANDLER_CONTENT' | base64 -d > handler.py\",
        \"rm -rf package lambda-function.zip\",
        \"mkdir -p package\",
        \"pip3 install --target package/ -r requirements.txt\",
        \"cp handler.py package/\",
        \"cd package && zip -r ../lambda-function.zip . && cd ..\",
        \"ls -lh lambda-function.zip\"
    ]" \
    --region "$REGION" \
    --output text \
    --query 'Command.CommandId' > /tmp/command-id.txt

COMMAND_ID=$(cat /tmp/command-id.txt)
echo "Command ID: $COMMAND_ID"
echo "Waiting for command to complete..."

# Wait for command to complete
while true; do
    STATUS=$(aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'Status' \
        --output text)
    
    if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ]; then
        break
    fi
    sleep 5
done

if [ "$STATUS" = "Failed" ]; then
    echo "Build failed!"
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'StandardErrorContent' \
        --output text
    exit 1
fi

echo "Build successful! Downloading package..."

# Download the zip file using SSM
aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'StandardOutputContent' \
    --output text

# Actually, SSM doesn't support file downloads directly
# We need to use S3 as an intermediary or use Session Manager
echo ""
echo "Note: SSM doesn't support direct file download."
echo "Please use one of these methods:"
echo "1. Use AWS Session Manager to connect and download manually"
echo "2. Upload to S3 from the instance, then download"
echo "3. Use the EC2 approach (build-via-ec2.sh) which uses SCP"
