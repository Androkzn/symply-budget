#!/bin/bash
# Build Lambda package using a temporary EC2 instance
# This script creates an EC2 instance, builds the package, downloads it, and cleans up

set -e

REGION="us-east-1"
INSTANCE_TYPE="t3.micro"
AMI_ID="ami-0c55b159cbfafe1f0"  # Amazon Linux 2023
KEY_NAME="lambda-builder-key"
SECURITY_GROUP="lambda-builder-sg"

echo "=========================================="
echo "Building Lambda Package via EC2"
echo "=========================================="

# Step 1: Create security group (if it doesn't exist)
echo "Creating security group..."
if ! aws ec2 describe-security-groups --group-names "$SECURITY_GROUP" --region "$REGION" 2>/dev/null; then
    aws ec2 create-security-group \
        --group-name "$SECURITY_GROUP" \
        --description "Temporary security group for Lambda builder" \
        --region "$REGION" > /dev/null
    
    # Allow SSH from anywhere (temporary)
    aws ec2 authorize-security-group-ingress \
        --group-name "$SECURITY_GROUP" \
        --protocol tcp \
        --port 22 \
        --cidr 0.0.0.0/0 \
        --region "$REGION" > /dev/null
fi

# Step 2: Create key pair (if it doesn't exist)
echo "Setting up key pair..."
if [ ! -f "$KEY_NAME.pem" ]; then
    aws ec2 create-key-pair --key-name "$KEY_NAME" --region "$REGION" --query 'KeyMaterial' --output text > "$KEY_NAME.pem"
    chmod 400 "$KEY_NAME.pem"
fi

# Step 3: Launch EC2 instance
echo "Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-groups "$SECURITY_GROUP" \
    --region "$REGION" \
    --query 'Instances[0].InstanceId' \
    --output text)

echo "Instance ID: $INSTANCE_ID"
echo "Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

echo "Instance IP: $PUBLIC_IP"
echo "Waiting for SSH to be ready..."
sleep 30

# Step 4: Upload files and build
echo "Uploading files and building package..."
scp -i "$KEY_NAME.pem" -o StrictHostKeyChecking=no \
    handler.py requirements.txt \
    ec2-user@"$PUBLIC_IP":~/lambda-processor/

# Build on remote instance
ssh -i "$KEY_NAME.pem" -o StrictHostKeyChecking=no ec2-user@"$PUBLIC_IP" << 'ENDSSH'
cd ~/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip
ENDSSH

# Step 5: Download the package
echo "Downloading package..."
scp -i "$KEY_NAME.pem" -o StrictHostKeyChecking=no \
    ec2-user@"$PUBLIC_IP":~/lambda-processor/lambda-function.zip \
    ./lambda-function.zip

# Step 6: Deploy to Lambda
echo "Deploying to Lambda..."
aws lambda update-function-code \
    --function-name inspection-report-processor \
    --zip-file fileb://lambda-function.zip \
    --region "$REGION"

# Step 7: Cleanup
echo "Cleaning up..."
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION" > /dev/null
rm -f "$KEY_NAME.pem"
aws ec2 delete-key-pair --key-name "$KEY_NAME" --region "$REGION" 2>/dev/null || true
aws ec2 delete-security-group --group-name "$SECURITY_GROUP" --region "$REGION" 2>/dev/null || true

echo ""
echo "=========================================="
echo "✅ Build and deployment complete!"
echo "=========================================="
