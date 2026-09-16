#!/bin/bash
# Prepare files for AWS CloudShell build

echo "=========================================="
echo "Preparing for AWS CloudShell Build"
echo "=========================================="
echo ""

# Create a tarball with necessary files
tar -czf cloudshell-build-package.tar.gz handler.py requirements.txt cloudshell-quick-build.sh

echo "✅ Created: cloudshell-build-package.tar.gz"
echo ""
echo "Next steps:"
echo "1. Open AWS CloudShell: https://console.aws.amazon.com/cloudshell/"
echo "2. Upload cloudshell-build-package.tar.gz (Actions → Upload file)"
echo "3. Run these commands in CloudShell:"
echo ""
echo "   tar -xzf cloudshell-build-package.tar.gz"
echo "   mkdir -p package"
echo "   pip3 install --target package/ -r requirements.txt"
echo "   cp handler.py package/"
echo "   cd package && zip -r ../lambda-function.zip . && cd .."
echo "   ls -lh lambda-function.zip"
echo ""
echo "4. Download lambda-function.zip (Actions → Download file)"
echo "5. Deploy with this command (run locally):"
echo "   aws lambda update-function-code \\"
echo "     --function-name inspection-report-processor \\"
echo "     --zip-file fileb://lambda-function.zip \\"
echo "     --region us-east-1"
echo ""
