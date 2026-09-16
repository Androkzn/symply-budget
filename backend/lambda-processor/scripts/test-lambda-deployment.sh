#!/bin/bash
set -e

# Configuration
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FUNCTION_NAME="inspection-report-processor"
REGION="us-east-1"
# Real inspection-report fixture from the shared manifest (override with TEST_PDF=...).
TEST_PDF="${TEST_PDF:-$(node -e 'console.log(require(process.argv[1]).fixture("house-inspection-report").absPath)' "$REPO_ROOT/e2e/fixtures/index.js")}"
TEST_JOB_ID="test-$(date +%s)"
TEST_REPORT_ID="test-report-$(date +%s)"
TEST_HOUSEHOLD_ID="test-household-001"
R2_BUCKET="${R2_BUCKET_NAME:-simple-house-reports}"
R2_KEY="test-reports/${TEST_REPORT_ID}/sample-report.pdf"

echo "🧪 Lambda Deployment Test"
echo "=========================="
echo ""
echo "Function: $FUNCTION_NAME"
echo "Test PDF: $TEST_PDF"
echo "Job ID: $TEST_JOB_ID"
echo "Report ID: $TEST_REPORT_ID"
echo ""

# Check if test PDF exists
if [ ! -f "$TEST_PDF" ]; then
    echo "❌ Test PDF not found: $TEST_PDF"
    echo "Please ensure the test PDF exists at this path."
    exit 1
fi

PDF_SIZE=$(ls -lh "$TEST_PDF" | awk '{print $5}')
echo "✓ Test PDF found ($PDF_SIZE)"

# Step 1: Upload test PDF to R2
echo ""
echo "📤 Step 1: Uploading test PDF to R2..."

# Check if AWS CLI has R2 credentials configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "⚠️  AWS credentials not configured. Skipping R2 upload."
    echo "Assuming PDF is already uploaded or will use local testing."
    R2_UPLOAD_SUCCESS=false
else
    # Get R2 endpoint from environment or Lambda config
    R2_ENDPOINT=$(aws lambda get-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --query 'Environment.Variables.R2_ENDPOINT_URL' \
        --output text 2>/dev/null || echo "")

    if [ -n "$R2_ENDPOINT" ] && [ "$R2_ENDPOINT" != "None" ]; then
        echo "Uploading to R2: s3://$R2_BUCKET/$R2_KEY"

        # Use AWS CLI with R2 endpoint
        aws s3 cp "$TEST_PDF" "s3://$R2_BUCKET/$R2_KEY" \
            --endpoint-url "$R2_ENDPOINT" \
            --region us-east-1 2>/dev/null || {
            echo "⚠️  R2 upload failed. Continuing with test..."
            R2_UPLOAD_SUCCESS=false
        }
        R2_UPLOAD_SUCCESS=true
    else
        echo "⚠️  R2 endpoint not configured. Skipping upload."
        R2_UPLOAD_SUCCESS=false
    fi
fi

# Step 2: Invoke Lambda function
echo ""
echo "🚀 Step 2: Invoking Lambda function..."

# Create test payload
PAYLOAD=$(cat <<EOF
{
  "jobId": "$TEST_JOB_ID",
  "reportId": "$TEST_REPORT_ID",
  "householdId": "$TEST_HOUSEHOLD_ID",
  "pdfS3Key": "$R2_KEY"
}
EOF
)

echo "Payload:"
echo "$PAYLOAD" | jq . 2>/dev/null || echo "$PAYLOAD"
echo ""

# Invoke Lambda
aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --payload "$PAYLOAD" \
    --region "$REGION" \
    --cli-binary-format raw-in-base64-out \
    /tmp/lambda-test-response.json > /tmp/lambda-test-invoke.json

INVOKE_STATUS=$(jq -r '.StatusCode' /tmp/lambda-test-invoke.json)

if [ "$INVOKE_STATUS" != "200" ]; then
    echo "❌ Lambda invocation failed with status: $INVOKE_STATUS"
    cat /tmp/lambda-test-invoke.json
    exit 1
fi

echo "✓ Lambda invoked successfully (Status: $INVOKE_STATUS)"

# Step 3: Check Lambda response
echo ""
echo "📊 Step 3: Checking Lambda response..."

if [ -f /tmp/lambda-test-response.json ]; then
    RESPONSE=$(cat /tmp/lambda-test-response.json)
    echo "Response:"
    echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
    echo ""

    # Check for errors in response
    ERROR_TYPE=$(echo "$RESPONSE" | jq -r '.errorType // empty' 2>/dev/null)
    if [ -n "$ERROR_TYPE" ]; then
        echo "❌ Lambda execution error:"
        echo "Type: $ERROR_TYPE"
        echo "Message: $(echo "$RESPONSE" | jq -r '.errorMessage // empty')"
        echo ""
        echo "See CloudWatch logs for details:"
        echo "  aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
        exit 1
    fi

    # Parse results
    STATUS=$(echo "$RESPONSE" | jq -r '.status // empty' 2>/dev/null)
    FINDINGS_COUNT=$(echo "$RESPONSE" | jq -r '.findings_count // 0' 2>/dev/null)
    IMAGES_COUNT=$(echo "$RESPONSE" | jq -r '.images_stored // 0' 2>/dev/null)

    if [ -n "$STATUS" ]; then
        echo "✓ Status: $STATUS"
        [ "$FINDINGS_COUNT" != "0" ] && echo "✓ Findings extracted: $FINDINGS_COUNT"
        [ "$IMAGES_COUNT" != "0" ] && echo "✓ Images processed: $IMAGES_COUNT"
    fi
else
    echo "⚠️  No response file generated"
fi

# Step 4: Check CloudWatch logs
echo ""
echo "📝 Step 4: Checking CloudWatch logs (last 30 seconds)..."

sleep 5  # Wait for logs to propagate

aws logs tail "/aws/lambda/$FUNCTION_NAME" \
    --since 30s \
    --format short \
    --region "$REGION" 2>/dev/null | grep -E "(START|END|REPORT|Error|extracted|findings|images)" | tail -20 || {
    echo "⚠️  Could not retrieve logs. Check manually:"
    echo "  aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
}

# Step 5: Summary
echo ""
echo "═══════════════════════════════════════"
echo "📋 Test Summary"
echo "═══════════════════════════════════════"

if [ "$INVOKE_STATUS" = "200" ] && [ -z "$ERROR_TYPE" ]; then
    echo "✅ Lambda deployment test PASSED"
    echo ""
    echo "Verified:"
    echo "  ✓ Lambda function is invocable"
    echo "  ✓ No execution errors"
    [ -n "$STATUS" ] && echo "  ✓ Processing completed with status: $STATUS"
    [ "$FINDINGS_COUNT" != "0" ] && echo "  ✓ Findings extracted: $FINDINGS_COUNT"
    [ "$IMAGES_COUNT" != "0" ] && echo "  ✓ Images processed: $IMAGES_COUNT"
    echo ""
    echo "Test artifacts:"
    echo "  Job ID: $TEST_JOB_ID"
    echo "  Report ID: $TEST_REPORT_ID"
    [ "$R2_UPLOAD_SUCCESS" = "true" ] && echo "  R2 Key: $R2_KEY"
    echo ""
    echo "🎉 Deployment verified successfully!"
    exit 0
else
    echo "❌ Lambda deployment test FAILED"
    echo ""
    echo "Issues detected:"
    [ "$INVOKE_STATUS" != "200" ] && echo "  ✗ Invocation failed (Status: $INVOKE_STATUS)"
    [ -n "$ERROR_TYPE" ] && echo "  ✗ Execution error: $ERROR_TYPE"
    echo ""
    echo "Check logs for details:"
    echo "  aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
    exit 1
fi
