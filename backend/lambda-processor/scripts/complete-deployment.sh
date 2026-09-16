#!/bin/bash
set -e

echo "=========================================="
echo "Complete Lambda Deployment Process"
echo "=========================================="
echo ""

# Step 1: Create CloudShell deployment package
echo "📦 Step 1: Creating CloudShell deployment package..."
tar -czf cloudshell-deploy.tar.gz handler.py requirements.txt
echo "✅ Created: cloudshell-deploy.tar.gz ($(du -h cloudshell-deploy.tar.gz | cut -f1))"
echo ""

# Step 2: Create deployment commands file
echo "📝 Step 2: Creating deployment commands..."
cat > cloudshell-commands.txt << 'COMMANDS'
# Extract files
tar -xzf cloudshell-deploy.tar.gz

# Build package
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip

# Deploy
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1

# Verify
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State,CodeSize]' \
  --output table

echo "✅ Deployment complete!"
COMMANDS
echo "✅ Created: cloudshell-commands.txt"
echo ""

# Step 3: Show instructions
echo "=========================================="
echo "🚀 Next Steps:"
echo "=========================================="
echo ""
echo "1. Open AWS CloudShell:"
echo "   https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1"
echo ""
echo "2. Upload cloudshell-deploy.tar.gz:"
echo "   Actions → Upload file → Select cloudshell-deploy.tar.gz"
echo ""
echo "3. Run these commands in CloudShell:"
echo ""
cat cloudshell-commands.txt
echo ""
echo "=========================================="
echo "Or copy from: $(pwd)/cloudshell-commands.txt"
echo "=========================================="
echo ""

# Step 4: Try to open CloudShell
echo "🌐 Opening CloudShell in browser..."
open "https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1" 2>/dev/null || true

echo ""
echo "✅ All files prepared and ready for deployment!"
echo ""
echo "Files created:"
echo "  - cloudshell-deploy.tar.gz (upload this)"
echo "  - cloudshell-commands.txt (commands to run)"
echo ""
