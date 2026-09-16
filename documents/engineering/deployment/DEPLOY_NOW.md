# Quick Deployment Guide

## Prerequisites
- Node.js 20+ (you have 18.20.8, need to upgrade)
- Wrangler CLI installed
- AWS credentials configured

## Step 1: Upgrade Node.js

```bash
# Install Node 20
nvm install 20
nvm use 20

# Verify
node --version  # Should show v20.x.x
```

## Step 2: Deploy Backend

```bash
cd /Users/andreitekhtelev/Desktop/symply-house/backend

# Deploy to staging
wrangler deploy --env staging

# Deploy to production  
wrangler deploy --env production
```

Or use the deployment script:
```bash
cd /Users/andreitekhtelev/Desktop/symply-house/backend
./deploy-all.sh
```

## Step 3: Configure AWS Secrets (Required!)

After deployment, configure AWS secrets for Lambda invocation:

**For Staging:**
```bash
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
wrangler secret put AWS_LAMBDA_ARN --env production
wrangler secret put AWS_ACCESS_KEY_ID --env production
wrangler secret put AWS_SECRET_ACCESS_KEY --env production
wrangler secret put AWS_REGION --env production
```

## What's Already Deployed

✅ Lambda function - Already deployed with R2 support
✅ Lambda resource policy - Allows Cloudflare Workers to invoke
✅ Lambda environment variables - All configured

## What Needs Deployment

⚠️  Backend code changes:
- Fixed upload flow (added confirmUpload)
- Improved error logging
- Status validation

⚠️  AWS secrets in Cloudflare Workers (required for Lambda invocation)

## Alternative: Deploy via Cloudflare Dashboard

If you can't use wrangler CLI:

1. Go to: https://dash.cloudflare.com/
2. Workers & Pages → Your Worker
3. Deploy from GitHub or upload code
4. Settings → Variables → Secrets → Add AWS secrets
