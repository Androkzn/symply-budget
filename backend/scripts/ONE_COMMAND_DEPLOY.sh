#!/bin/bash
set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          🚀 ONE-STEP LAMBDA DEPLOYMENT                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Prepare CloudShell package
echo "📦 Preparing deployment package..."
cd ../lambda-processor
tar -czf cloudshell-deploy.tar.gz handler.py requirements.txt >/dev/null 2>&1
echo "✅ Package ready: cloudshell-deploy.tar.gz"
cd - >/dev/null

# Step 2: Generate CloudShell script
cat > /tmp/cloudshell-auto.sh << 'CLOUDSHELL'
#!/bin/bash
tar -xzf cloudshell-deploy.tar.gz
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
echo "✅ Lambda deployed!"
CLOUDSHELL

chmod +x /tmp/cloudshell-auto.sh

# Step 3: Copy to clipboard
cat /tmp/cloudshell-auto.sh | pbcopy
echo "✅ CloudShell commands copied to clipboard"

# Step 4: Open CloudShell
echo ""
echo "🌐 Opening CloudShell..."
open "https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1"

# Step 5: Show instructions
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "👉 IN CLOUDSHELL (browser window):"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "1. Upload: cloudshell-deploy.tar.gz (Actions → Upload)"
echo "2. Paste commands (Cmd+V - already in clipboard)"
echo "3. Wait ~3 minutes for build & deploy"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Step 6: Wait for user confirmation
read -p "Press ENTER when CloudShell deployment is complete..."

# Step 7: Test deployment
echo ""
echo "🧪 Testing Lambda deployment..."
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State,CodeSize]' \
  --output table

# Step 8: Reprocess report
echo ""
echo "🔄 Reprocessing report with image extraction..."
cd ..

REPORT_ID="28fd554e-b641-45ea-97d3-afe8f0509854"
HOUSEHOLD_ID="b5e4fe57-b3dc-46dc-9c20-98d78bf4407c"

# Clean data
echo "   Cleaning existing data..."
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "DELETE FROM task_drafts WHERE report_id = '$REPORT_ID'; DELETE FROM findings WHERE report_id = '$REPORT_ID'; DELETE FROM report_images WHERE report_id = '$REPORT_ID';" \
  >/dev/null 2>&1

# Invoke Lambda
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
  --function-name inspection-report-processor \
  --region us-east-1 \
  --payload file:///tmp/lambda-payload.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/lambda-response.json >/dev/null 2>&1

if grep -q "errorMessage" /tmp/lambda-response.json 2>/dev/null; then
    echo "❌ Lambda error:"
    cat /tmp/lambda-response.json | jq .
    exit 1
fi

echo "✅ Lambda processing started"
echo "⏳ Waiting for image extraction (~2-5 minutes)..."

# Wait for images
for i in {1..60}; do
    sleep 5
    
    COUNT=$(npx wrangler d1 execute simple-house-db --env production --remote \
        --command "SELECT COUNT(*) as c FROM report_images WHERE report_id = '$REPORT_ID'" \
        2>/dev/null | grep '"c"' | grep -o '[0-9]*' | head -1 || echo "0")
    
    if [ "$COUNT" -gt "0" ]; then
        echo ""
        echo "✅ Image extraction complete! Found $COUNT images"
        break
    fi
    
    echo -n "."
done

# Step 9: Verify results
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🔍 VERIFICATION RESULTS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

bash scripts/test-image-extraction.sh

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              ✅ DEPLOYMENT & TESTING COMPLETE!                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
