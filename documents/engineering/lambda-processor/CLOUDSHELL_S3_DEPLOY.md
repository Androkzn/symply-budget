# Deploy Lambda via S3 (for packages > 50MB)

## The package is 53MB, too large for direct upload. Use S3 instead.

Run these commands in CloudShell:

```bash
# 1. Create S3 bucket for Lambda deployments (if doesn't exist)
aws s3 mb s3://simple-house-lambda-code --region us-east-1 2>/dev/null || echo "Bucket exists"

# 2. Upload Lambda package to S3
aws s3 cp lambda-function.zip s3://simple-house-lambda-code/lambda-function.zip --region us-east-1

# 3. Deploy Lambda from S3
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --s3-bucket simple-house-lambda-code \
  --s3-key lambda-function.zip \
  --region us-east-1

# 4. Wait for deployment to complete
echo "Waiting for deployment..."
sleep 10

# 5. Verify deployment
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State,CodeSize]' \
  --output table

echo ""
echo "✅ Deployment complete!"
echo "Expected CodeSize: ~55,000,000 bytes (53MB)"
```

## Expected Output

```
------------------------
|     GetFunction      |
+----------------------+
|  Successful          |
|  Active              |
|  55000000 (approx)   |
+----------------------+
```

## Next Steps

After successful deployment, test image extraction:

```bash
# Check CloudWatch logs for image extraction
aws logs tail /aws/lambda/inspection-report-processor \
  --region us-east-1 \
  --follow \
  --format short \
  --filter-pattern "[IMAGE-EXTRACT]"
```

You should now see:
- `[IMAGE-EXTRACT] Extracted X images`
- `[R2-UPLOAD] Uploaded image {id}`
- `[D1-IMAGES] Stored X image records`
