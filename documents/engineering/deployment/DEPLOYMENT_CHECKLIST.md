# Deployment Checklist

## Changes Made

### Backend Changes
1. ✅ Fixed report upload flow - Added `confirmUpload` step before processing
2. ✅ Improved error logging with stack traces
3. ✅ Added status check in enhanced processing route
4. ✅ Updated Lambda handler to support R2 storage
5. ✅ Added Lambda resource policy for Cloudflare Workers

### Lambda Changes
1. ✅ Updated handler to use R2 S3-compatible endpoint
2. ✅ Added R2 credentials configuration
3. ✅ Improved error logging
4. ✅ Fixed dependency issues (pydantic_core)

## Deployment Steps

### 1. Deploy Lambda Function (Already Done)
```bash
cd lambda-processor
# Lambda is already deployed with R2 support
```

### 2. Deploy Backend to Staging & Production

**Option A: Using the deployment script (requires Node 20+)**
```bash
cd backend
nvm install 20
nvm use 20
./deploy-all.sh
```

**Option B: Manual deployment**
```bash
cd backend
nvm install 20
nvm use 20

# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

### 3. Configure AWS Secrets (Required for Lambda Invocation)

**For Staging:**
```bash
cd backend
wrangler secret put AWS_LAMBDA_ARN --env staging
# Enter: arn:aws:lambda:us-east-1:907308712679:function:inspection-report-processor

wrangler secret put AWS_ACCESS_KEY_ID --env staging
# Enter: your-access-key-id

wrangler secret put AWS_SECRET_ACCESS_KEY --env staging
# Enter: your-secret-access-key

wrangler secret put AWS_REGION --env staging
# Enter: us-east-1
```

**For Production:**
```bash
cd backend
wrangler secret put AWS_LAMBDA_ARN --env production
wrangler secret put AWS_ACCESS_KEY_ID --env production
wrangler secret put AWS_SECRET_ACCESS_KEY --env production
wrangler secret put AWS_REGION --env production
```

**Or use Cloudflare Dashboard:**
1. Go to: https://dash.cloudflare.com/
2. Workers & Pages → Your Worker → Settings → Variables → Secrets
3. Add secrets for each environment

### 4. Verify Deployment

**Check staging:**
```bash
curl https://simple-house-api-staging.a-tekhtelev.workers.dev/health
```

**Check production:**
```bash
curl https://simple-house-api.a-tekhtelev.workers.dev/health
```

## Current Status

- ✅ Lambda function deployed and configured
- ✅ Lambda resource policy set (allows Cloudflare Workers)
- ✅ R2 credentials configured in Lambda
- ⚠️  AWS secrets need to be configured in Cloudflare Workers
- ⚠️  Backend code needs to be deployed

## Testing After Deployment

1. Upload a report (<10MB) - Should process in Workers
2. Upload a report (>10MB) - Should invoke Lambda
3. Check CloudWatch logs for Lambda execution
4. Verify report status updates correctly
