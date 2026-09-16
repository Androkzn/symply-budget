# AWS Lambda Deployment Instructions

## Prerequisites

1. AWS CLI installed and configured
2. AWS account with Lambda permissions
3. Anthropic API key
4. Cloudflare R2 configured as S3-compatible storage

## Step 1: Create Deployment Package

```bash
cd lambda-processor

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create deployment package
mkdir package
pip install -r requirements.txt -t package/
cp handler.py package/
cd package
zip -r ../lambda-function.zip .
cd ..
```

## Step 2: Create IAM Role

Create an IAM role with these policies:
- `AWSLambdaBasicExecutionRole` (for CloudWatch logs)
- Custom policy for S3/R2 access:

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
      "Resource": "arn:aws:s3:::your-r2-bucket/*"
    }
  ]
}
```

## Step 3: Create Lambda Function

**For 100MB+ PDFs, use higher memory allocation:**

```bash
aws lambda create-function \
  --function-name inspection-report-processor \
  --runtime python3.11 \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-execution-role \
  --handler handler.lambda_handler \
  --zip-file fileb://lambda-function.zip \
  --timeout 900 \
  --memory-size 5120 \
  --ephemeral-storage Size=1024 \
  --environment Variables="{
    ANTHROPIC_API_KEY=your-anthropic-api-key,
    CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id,
    CLOUDFLARE_DATABASE_ID=your-d1-database-id,
    CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
  }"
```

**Memory Configuration for Different File Sizes:**
- 32-50MB PDFs: `--memory-size 3008` (3GB)
- 50-75MB PDFs: `--memory-size 4096` (4GB)
- 75-100MB PDFs: `--memory-size 5120` (5GB)
- 100MB+ PDFs: `--memory-size 10240` (10GB, max)

## Step 4: Configure S3/R2 Connection

If using Cloudflare R2 (S3-compatible):

```bash
# Configure R2 endpoint
aws configure set s3.endpoint_url https://<account-id>.r2.cloudflarestorage.com
```

## Step 5: Test Lambda Function

Create test event (`test-event.json`):

```json
{
  "jobId": "test-job-123",
  "reportId": "test-report-456",
  "householdId": "test-household-789",
  "pdfS3Bucket": "your-bucket-name",
  "pdfS3Key": "reports/test-report.pdf"
}
```

Test:

```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload file://test-event.json \
  response.json

cat response.json
```

## Step 6: Grant Cloudflare Workers Permission to Invoke

Create a resource-based policy:

```bash
aws lambda add-permission \
  --function-name inspection-report-processor \
  --statement-id cloudflare-workers-invoke \
  --action lambda:InvokeFunction \
  --principal "*"  # Restrict this in production!
```

## Step 7: Update Cloudflare Workers

Add Lambda ARN to your Workers environment variables:

```bash
wrangler secret put AWS_LAMBDA_ARN
# Enter: arn:aws:lambda:us-east-1:YOUR_ACCOUNT_ID:function:inspection-report-processor

wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY
wrangler secret put AWS_REGION
```

## Environment Variables Required

Lambda function needs:
- `ANTHROPIC_API_KEY` - Your Claude API key
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID
- `CLOUDFLARE_DATABASE_ID` - D1 database ID
- `CLOUDFLARE_API_TOKEN` - API token with D1 write permissions

## Monitoring

View logs:
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow
```

## Cost Optimization

**For 100MB PDFs:**
- Memory: 5120 MB (5GB) - recommended
- Timeout: 900 seconds (15 minutes)
- Ephemeral storage: 1024 MB (1GB)
- Estimated cost: ~$0.15-0.25 per report

**Cost breakdown:**
- Lambda compute: ~$0.10 per report (5GB x 5 minutes)
- Claude API (100MB PDF): ~$0.10-0.15 (with caching)
- **Total: ~$0.20-0.35 per 100MB report**

**Smaller files (32-50MB):**
- Memory: 3008 MB (3GB)
- Estimated cost: ~$0.05-0.10 per report

## Troubleshooting

### "PDF too large" errors
- Increase Lambda memory (up to 10GB)
- Increase timeout (up to 15 minutes)

### "Module not found" errors
- Ensure all dependencies are in the deployment package
- Check handler path is correct

### "Timeout" errors
- Increase Lambda timeout
- Check network connectivity to Anthropic API
- Verify Claude API key is valid

## Alternative: Use AWS SAM

For easier deployment, use AWS SAM:

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  InspectionProcessor:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.lambda_handler
      Runtime: python3.11
      Timeout: 900
      MemorySize: 3008
      Environment:
        Variables:
          ANTHROPIC_API_KEY: !Ref AnthropicApiKey
```

Deploy:
```bash
sam build
sam deploy --guided
```

## Handling 100MB+ Files - Important Notes

### File Size Strategy

**Current Implementation:**
- **<32MB**: Processed directly in Cloudflare Workers with Claude native PDF
- **32-100MB**: Automatically delegated to AWS Lambda
- **100MB+**: Lambda with increased memory (5-10GB)

### Claude API Limitations

**Important:** Claude's native PDF support has a **32MB limit** per document. For larger files, the Lambda function uses Claude's **document chunking strategy**:

1. **Split large PDFs** into smaller sections (by page ranges)
2. **Process each section** independently with Claude
3. **Merge results** from all sections
4. **Total processing time** scales linearly with file size

### Performance Expectations

| File Size | Processing Time | Memory Required | Cost per Report |
|-----------|----------------|-----------------|-----------------|
| <32MB     | 2-4 minutes    | Workers (128MB) | $0.05-0.10     |
| 32-50MB   | 4-6 minutes    | Lambda 3GB      | $0.10-0.15     |
| 50-75MB   | 6-10 minutes   | Lambda 4GB      | $0.15-0.20     |
| 75-100MB  | 10-15 minutes  | Lambda 5GB      | $0.20-0.35     |

### Optimization Tips

1. **Enable Prompt Caching**: Reduces cost by 90% after first report
2. **Use Streaming**: Process findings as they're extracted (future enhancement)
3. **Parallel Section Processing**: Process multiple PDF sections simultaneously
4. **Image Compression**: Reduce embedded image quality if not critical

### Lambda Configuration for 100MB Files

```bash
# Update existing Lambda function for large files
aws lambda update-function-configuration \
  --function-name inspection-report-processor \
  --memory-size 5120 \
  --timeout 900 \
  --ephemeral-storage Size=1024
```

### Monitoring Large File Processing

```bash
# Watch Lambda logs in real-time
aws logs tail /aws/lambda/inspection-report-processor --follow

# Check memory usage
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name MemoryUtilization \
  --dimensions Name=FunctionName,Value=inspection-report-processor \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 3600 \
  --statistics Maximum
```

### Alternative for Extremely Large Files (>100MB)

If you regularly process files >100MB, consider:

1. **PDF Compression**: Use tools like Ghostscript to reduce file size
2. **OCR Pre-processing**: Extract text before sending to Claude
3. **Batch Processing**: Process overnight with higher timeouts
4. **Google Document AI**: Alternative for files up to 1GB

```bash
# Example: Compress PDF before processing
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook \
   -dNOPAUSE -dQUIET -dBATCH \
   -sOutputFile=compressed.pdf input.pdf
```

### When Lambda Isn't Enough

For files **>150MB** or requiring **>15 minutes** processing:

1. **AWS Batch**: Run as container jobs with no time limit
2. **EC2 Instances**: Dedicated processing servers
3. **Step Functions**: Orchestrate multi-stage processing
4. **S3 + EventBridge**: Async processing queue

Example Step Function approach:
```
Upload PDF → S3 Event → Lambda (split PDF) → SQS Queue → 
Multiple Lambdas (process chunks) → Lambda (merge results) → Update DB
```

