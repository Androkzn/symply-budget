# Manual Lambda Deployment Guide

Your IAM user `simple-house` needs additional permissions to deploy Lambda functions automatically. Here's how to deploy manually via AWS Console.

## Required IAM Permissions

First, grant these permissions to the `simple-house` IAM user:

1. Log into AWS Console as an administrator: https://console.aws.amazon.com/iam/
2. Navigate to: IAM → Users → simple-house
3. Click "Add permissions" → "Attach policies directly"
4. Add these managed policies:
   - `AWSLambda_FullAccess`
   - `IAMFullAccess` (or create custom policy with `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:GetRole`)
   - `CloudWatchLogsFullAccess`

After granting permissions, run:
```bash
cd /Users/andreitekhtelev/Desktop/symply-house/lambda-processor
bash deploy.sh
```

## Alternative: Manual Setup via AWS Console

If you prefer manual setup without granting IAM permissions:

### Step 1: Create IAM Role

1. Go to: https://console.aws.amazon.com/iam/home?region=us-east-1#/roles
2. Click "Create role"
3. Select "AWS service" → "Lambda"
4. Click "Next"
5. Attach these policies:
   - `AWSLambdaBasicExecutionRole` (for CloudWatch logs)
   - Create custom inline policy for S3/R2 access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    }
  ]
}
```

6. Name the role: `lambda-inspection-processor-role`
7. Click "Create role"
8. Copy the Role ARN (you'll need it)

### Step 2: Create Lambda Function

1. Go to: https://console.aws.amazon.com/lambda/home?region=us-east-1#/functions
2. Click "Create function"
3. Select "Author from scratch"
4. Function name: `inspection-report-processor`
5. Runtime: Python 3.11 (or Python 3.12)
6. Architecture: x86_64
7. Execution role: "Use an existing role" → Select `lambda-inspection-processor-role`
8. Click "Create function"

### Step 3: Upload Deployment Package

1. In the Lambda function page, scroll to "Code source"
2. Click "Upload from" → ".zip file"
3. Upload the file: `/Users/andreitekhtelev/Desktop/symply-house/lambda-processor/lambda-function.zip`
4. Click "Save"

### Step 4: Configure Function Settings

**Configuration → General configuration:**
- Memory: 5120 MB (5GB)
- Timeout: 15 minutes (900 seconds)
- Ephemeral storage: 1024 MB

**Configuration → Environment variables:**

Add these environment variables (get values from your Cloudflare dashboard):

```
ANTHROPIC_API_KEY=<from Anthropic console — never commit; rotate if ever leaked>

CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>
CLOUDFLARE_DATABASE_ID=<your-d1-database-id>
CLOUDFLARE_API_TOKEN=<your-cloudflare-api-token>

# R2 Bucket Configuration
R2_BUCKET_NAME=simple-house-reports
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
```

### Step 5: Test the Function

Create a test event:

1. Click "Test" tab
2. Create new test event:

```json
{
  "jobId": "test-job-123",
  "reportId": "test-report-456",
  "householdId": "test-household-789",
  "pdfS3Bucket": "simple-house-reports",
  "pdfS3Key": "reports/test-report.pdf"
}
```

3. Click "Test"
4. Check the results

### Step 6: Get Lambda ARN and Update Workers

1. Copy the Lambda ARN from the function page (top right)
   - Format: `arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor`

2. Add to Cloudflare Workers:

```bash
cd /Users/andreitekhtelev/Desktop/symply-house/backend

# Set Lambda ARN
wrangler secret put AWS_LAMBDA_ARN
# Enter: arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor

# Set AWS credentials (for Lambda invocation)
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
wrangler secret put AWS_REGION
# Enter: us-east-1
```

## Verification

Test the deployment:

```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{"jobId":"test-123","reportId":"test-456","householdId":"test-789","pdfS3Bucket":"test-bucket","pdfS3Key":"test.pdf"}' \
  response.json

cat response.json
```

## Monitoring

View logs:
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow
```

## Troubleshooting

### AccessDeniedException
- Verify IAM role has correct permissions
- Check IAM role trust policy allows Lambda service

### Module Import Errors
- Verify deployment package includes all dependencies
- Check Python runtime matches (3.11 or 3.12)

### Timeout Errors
- Increase timeout to 15 minutes
- Increase memory to 5GB or higher
- Check network connectivity to Anthropic API

## Cost Monitoring

Expected costs per report:
- Lambda: $0.10-0.20 (depending on processing time)
- Claude API: $0.05-0.15 (with caching)
- Total: $0.15-0.35 per 100MB report

Monitor costs:
```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-01-01,End=2026-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://cost-filter.json
```

## Next Steps

After deployment:
1. Test with a real PDF report
2. Monitor CloudWatch logs for errors
3. Verify results are stored in D1 database
4. Test from React Native app
5. Monitor costs and optimize if needed
