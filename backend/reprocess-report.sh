#!/bin/bash
set -e

REPORT_ID="28fd554e-b641-45ea-97d3-afe8f0509854"
HOUSEHOLD_ID="b5e4fe57-b3dc-46dc-9c20-98d78bf4407c"
FILE_KEY="reports/b5e4fe57-b3dc-46dc-9c20-98d78bf4407c/28fd554e-b641-45ea-97d3-afe8f0509854/Electrical report.pdf"

echo "=========================================="
echo "Reprocessing Report with Image Extraction"
echo "=========================================="
echo ""

# Step 1: Clean existing data
echo "1. Cleaning existing data..."
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "DELETE FROM task_drafts WHERE report_id = '$REPORT_ID'; DELETE FROM findings WHERE report_id = '$REPORT_ID'; DELETE FROM report_images WHERE report_id = '$REPORT_ID';" \
  2>&1 | tail -5

# Step 2: Trigger Lambda processing
echo ""
echo "2. Triggering Lambda processing..."
JOB_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

cat > /tmp/lambda-payload.json << PAYLOAD
{
  "jobId": "$JOB_ID",
  "reportId": "$REPORT_ID",
  "householdId": "$HOUSEHOLD_ID",
  "pdfS3Bucket": "simple-house-reports",
  "pdfS3Key": "$FILE_KEY"
}
PAYLOAD

echo "Job ID: $JOB_ID"
aws lambda invoke \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --payload file:///tmp/lambda-payload.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/lambda-response.json

# Step 3: Check response
echo ""
echo "3. Lambda response:"
cat /tmp/lambda-response.json | jq .

# Step 4: Wait and check status
echo ""
echo "4. Lambda is processing (this takes 2-5 minutes)..."
echo "   Monitor logs: aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1"
echo ""
echo "5. After processing completes, run: bash test-image-extraction.sh"
echo ""

echo "✅ Reprocessing triggered!"
