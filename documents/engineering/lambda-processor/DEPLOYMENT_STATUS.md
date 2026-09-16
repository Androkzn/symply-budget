# Lambda Deployment Status

## ✅ Successfully Deployed

### Lambda Function
- **Function Name**: `inspection-report-processor`
- **Function ARN**: `arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor`
- **Region**: us-east-1
- **Account ID**: 907308712679
- **Runtime**: Python 3.11
- **Memory**: 3008 MB (3GB)
- **Timeout**: 900 seconds (15 minutes)
- **Ephemeral Storage**: 1024 MB (1GB)

### IAM Role
- **Role Name**: `lambda-inspection-processor-role`
- **Role ARN**: `arn:aws:iam::907308712679:role/lambda-inspection-processor-role`
- **Policies**:
  - AWSLambdaBasicExecutionRole (CloudWatch logs)
  - S3Access (inline policy for R2 access)

### Environment Variables (Configured)
✅ `ANTHROPIC_API_KEY` - Claude API key configured
✅ `CLOUDFLARE_ACCOUNT_ID` - ca18eb3d6918c4004749ece5578f494d
✅ `CLOUDFLARE_DATABASE_ID` - a15827dd-9277-4e87-aebf-f56b6f658dc2 (production D1)

### Deployment Package
- **Size**: 22MB
- **Location**: `/Users/andreitekhtelev/Desktop/symply-house/lambda-processor/lambda-function.zip`
- **Dependencies**: anthropic>=0.76.0, boto3>=1.34.131

---

## ⚠️ Pending Configuration

### 1. Cloudflare API Token

The Lambda function needs a Cloudflare API token with D1 write permissions to update the database.

**To create the token:**
1. Go to: https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use template: "Edit Cloudflare Workers" OR create custom token with:
   - D1 Edit permissions
   - Account: ca18eb3d6918c4004749ece5578f494d
4. Copy the token

**Then update Lambda** (pull secrets from Keychain / Lambda console — **never paste live keys into docs**):
```bash
# Load operator tokens, then set Lambda env via console or AWS CLI with placeholders:
# ANTHROPIC_API_KEY=<from Anthropic console — rotate if ever committed>
# CLOUDFLARE_ACCOUNT_ID=<account id>
# CLOUDFLARE_DATABASE_ID=<production D1 id>
# CLOUDFLARE_API_TOKEN=<from Keychain symply.cloudflare.api_token>

aws lambda update-function-configuration \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --environment "Variables={ANTHROPIC_API_KEY=REDACTED,CLOUDFLARE_ACCOUNT_ID=REDACTED,CLOUDFLARE_DATABASE_ID=REDACTED,CLOUDFLARE_API_TOKEN=REDACTED}"
```

**Rotate reminder:** If `ANTHROPIC_API_KEY` was ever committed in docs or `deploy.sh`, revoke it in the Anthropic console and set a new value only on Lambda / Worker secrets — never re-commit.
### 2. R2 Bucket Configuration

The Lambda needs access to your R2 bucket for PDF storage.

**Get R2 credentials:**
```bash
# From Cloudflare Dashboard:
# R2 → Settings → Create API token
# Permissions: Object Read & Write
```

**Update Lambda environment:**
```bash
aws lambda update-function-configuration \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --environment 'Variables={...,R2_ACCESS_KEY_ID=xxx,R2_SECRET_ACCESS_KEY=xxx,R2_ENDPOINT=https://ca18eb3d6918c4004749ece5578f494d.r2.cloudflarestorage.com,R2_BUCKET_NAME=simple-house-reports}'
```

### 3. Cloudflare Workers Configuration

Update your Workers to invoke the Lambda:

```bash
cd /Users/andreitekhtelev/Desktop/symply-house/backend

# Set Lambda ARN
wrangler secret put AWS_LAMBDA_ARN --env production
# Enter: arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor

# Set AWS credentials (for invoking Lambda)
wrangler secret put AWS_ACCESS_KEY_ID --env production
wrangler secret put AWS_SECRET_ACCESS_KEY --env production
wrangler secret put AWS_REGION --env production
# Enter: us-east-1
```

### 4. Memory Quota Increase (Optional)

Current limit: 3008 MB (3GB)
Recommended for 100MB files: 5120 MB (5GB)

**To request quota increase:**
1. Go to: https://console.aws.amazon.com/servicequotas/
2. Search for "Lambda"
3. Find "Concurrent executions" or "Memory"
4. Request increase to 10240 MB (10GB) for max file size support

After approval, update Lambda:
```bash
aws lambda update-function-configuration \
  --function-name inspection-report-processor \
  --memory-size 5120 \
  --region us-east-1
```

---

## 🧪 Testing

### Basic Test (Without PDF)

Test the Lambda function without a real PDF to verify it's working:

```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --payload '{"jobId":"test-123","reportId":"test-456","householdId":"test-789","pdfS3Bucket":"test","pdfS3Key":"test.pdf"}' \
  response.json

cat response.json
```

### Full Test (With PDF)

After configuring R2 access:

1. Upload a test PDF to R2
2. Create test event with real S3 key
3. Invoke Lambda
4. Monitor logs:

```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

---

## 📊 Cost Estimates

### Current Configuration (3GB memory)
- **Small files (32-50MB)**: $0.10-0.15 per report
- **Medium files (50-75MB)**: $0.15-0.20 per report
- **Large files (75-100MB)**: $0.20-0.30 per report

### After Upgrade (5GB memory)
- **100MB files**: $0.20-0.35 per report
- With prompt caching: $0.05-0.10 per report (after first one)

### Monthly Cost Estimate
- **Low usage** (10 reports/month): ~$2-5/month
- **Medium usage** (50 reports/month): ~$10-15/month
- **High usage** (200 reports/month): ~$30-50/month

---

## 🔒 Security Notes

1. **API Keys**: All sensitive keys are stored as environment variables
2. **IAM Role**: Lambda has minimal permissions (logs + S3 only)
3. **Network**: Lambda runs in AWS VPC (isolated)
4. **Encryption**: All data encrypted at rest and in transit

---

## 📝 Next Steps

1. Create Cloudflare API token for D1 database access
2. Configure R2 credentials for PDF storage
3. Update Cloudflare Workers with Lambda ARN
4. Test with a real inspection report PDF
5. Monitor costs and performance
6. Request memory quota increase if processing 100MB+ files

---

## 🐛 Troubleshooting

### Lambda Not Found
- Verify region is us-east-1
- Check function name: `inspection-report-processor`

### Permission Denied
- Verify IAM role has correct permissions
- Check trust policy allows Lambda service

### Timeout Errors
- Files >75MB may timeout with 3GB memory
- Request quota increase to 5GB
- Consider splitting large PDFs

### Out of Memory
- Current limit: 3GB
- Increase to 5GB or 10GB for large files
- Monitor CloudWatch metrics

### API Token Issues
- Verify Cloudflare API token has D1 write permissions
- Check token hasn't expired
- Ensure account ID matches

---

## 📚 Resources

- [Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [Claude API Docs](https://docs.anthropic.com/en/api/)
- [Cloudflare D1 API](https://developers.cloudflare.com/d1/)
- [Deployment Guide](./DEPLOYMENT.md)
- [Manual Setup Guide](./MANUAL_DEPLOYMENT.md)
