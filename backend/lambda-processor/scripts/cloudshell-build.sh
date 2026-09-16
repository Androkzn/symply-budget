#!/bin/bash
# CloudShell Build Script for Lambda Package
# Copy and paste these commands into AWS CloudShell

set -e

echo "=========================================="
echo "Building Lambda Package in CloudShell"
echo "=========================================="

# Step 1: Navigate to lambda-processor directory
cd ~/lambda-processor

# Step 2: Clean up any previous builds
echo "Cleaning up previous builds..."
rm -rf package lambda-function.zip

# Step 3: Create package directory
echo "Creating package directory..."
mkdir -p package

# Step 4: Install dependencies (Linux-compatible)
echo "Installing dependencies (this may take 1-2 minutes)..."
pip3 install --target package/ -r requirements.txt

# Step 5: Copy handler
echo "Copying handler.py..."
cp handler.py package/

# Step 6: Create zip file
echo "Creating zip package..."
cd package
zip -r ../lambda-function.zip . > /dev/null
cd ..

# Step 7: Show results
echo ""
echo "=========================================="
echo "✅ Build Complete!"
echo "=========================================="
echo "Package: lambda-function.zip"
echo "Size: $(du -h lambda-function.zip | cut -f1)"
echo ""
echo "Next steps:"
echo "1. Click 'Actions' → 'Download file'"
echo "2. Enter: lambda-function.zip"
echo "3. Download to your computer"
echo "4. Deploy using the deploy command below"
echo ""
echo "Deploy command (run locally after download):"
echo "aws lambda update-function-code \\"
echo "  --function-name inspection-report-processor \\"
echo "  --zip-file fileb://lambda-function.zip \\"
echo "  --region us-east-1"
echo "=========================================="
