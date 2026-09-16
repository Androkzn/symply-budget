# Lambda Testing Guide

How to test your Lambda deployment to ensure everything works correctly.

## Quick Test

Run the automated test after deployment:

```bash
# Test without deploying
./scripts/test-lambda-deployment.sh

# Or deploy with automatic test
./deploy-code-only --test
./deploy-with-layer --test
```

## What the Test Does

The test script:
1. ✓ Verifies Lambda function is invocable
2. ✓ Checks for execution errors
3. ✓ Validates import statements work (dependencies loaded)
4. ✓ Tests basic function initialization
5. ✓ Displays CloudWatch logs
6. (Optional) Uploads test PDF and processes it

## Test Modes

### Mode 1: Basic Health Check (Default)

Tests Lambda invocation without uploading files:

```bash
./scripts/test-lambda-deployment.sh
```

**Expected Result:**
```
✅ Lambda deployment test PASSED

Verified:
  ✓ Lambda function is invocable
  ✓ No execution errors
```

### Mode 2: Full Integration Test (With PDF)

To test full PDF processing, you need R2 credentials configured:

```bash
# Set R2 credentials
export R2_ENDPOINT_URL="your-r2-endpoint"
export R2_ACCESS_KEY_ID="your-access-key"
export R2_SECRET_ACCESS_KEY="your-secret-key"
export R2_BUCKET_NAME="simple-house-reports"

# Run test
./scripts/test-lambda-deployment.sh
```

**Expected Result:**
```
✅ Lambda deployment test PASSED

Verified:
  ✓ Lambda function is invocable
  ✓ No execution errors
  ✓ Processing completed with status: completed
  ✓ Findings extracted: XX
  ✓ Images processed: XX
```

## Manual Testing

### 1. Invoke with Test Payload

```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{"test": true}' \
  --region us-east-1 \
  response.json

cat response.json
```

### 2. Watch Logs

```bash
# Real-time logs
aws logs tail /aws/lambda/inspection-report-processor --follow

# Last 5 minutes
aws logs tail /aws/lambda/inspection-report-processor --since 5m

# Last 10 log entries
aws logs tail /aws/lambda/inspection-report-processor --format short | tail -10
```

### 3. Check Function Status

```bash
# View configuration
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --region us-east-1

# Check if function is active
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query 'State' \
  --output text
# Should output: Active
```

### 4. Test with Real PDF

If you have a PDF in R2:

```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{
    "jobId": "manual-test-001",
    "reportId": "test-report-001",
    "householdId": "test-household-001",
    "pdfS3Key": "path/to/your/report.pdf"
  }' \
  --region us-east-1 \
  response.json

# Check result
cat response.json | jq .
```

## Common Test Scenarios

### Test 1: Import Check
**Purpose:** Verify all dependencies load correctly

```bash
aws lambda invoke \
  --function-name inspection-report-processor \
  --payload '{"test": "import_check"}' \
  response.json

# Look for import errors in logs
aws logs tail /aws/lambda/inspection-report-processor --since 30s | grep -i "import\|error"
```

### Test 2: Memory Check
**Purpose:** Verify function has enough memory

```bash
# Invoke function
aws lambda invoke ... response.json

# Check memory usage in logs
aws logs tail /aws/lambda/inspection-report-processor --since 30s | grep "Max Memory Used"
```

### Test 3: Timeout Check
**Purpose:** Ensure function doesn't timeout

```bash
# Check function timeout setting
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query 'Timeout' \
  --output text

# Should be sufficient (e.g., 900 seconds for large PDFs)
```

## Troubleshooting Tests

### Test Fails with Import Error

**Issue:** `Unable to import module 'handler': No module named 'X'`

**Solution:**
```bash
# Rebuild layer with proper binaries
./scripts/rebuild-layer-fix.sh

# Test again
./scripts/test-lambda-deployment.sh
```

### Test Times Out

**Issue:** Lambda execution exceeds timeout

**Solutions:**
- Increase timeout: `aws lambda update-function-configuration --function-name inspection-report-processor --timeout 900`
- Check if PDF is too large (>100 pages may need batch processing)
- Review logs for performance bottlenecks

### Test Shows Memory Error

**Issue:** Lambda runs out of memory

**Solutions:**
- Increase memory: `aws lambda update-function-configuration --function-name inspection-report-processor --memory-size 4096`
- Check for memory leaks in code
- Optimize batch processing settings

### R2 Upload Fails in Test

**Issue:** Can't upload test PDF to R2

**Solutions:**
1. Configure R2 credentials (see Mode 2 above)
2. Or skip R2 upload and use existing PDF in R2
3. Or just run basic health check (Mode 1)

## Continuous Testing

### After Every Deployment

```bash
# Deploy with automatic test
./deploy-code-only --test
```

### Before Production Release

```bash
# Full suite
./scripts/test-lambda-deployment.sh  # Health check
./scripts/rebuild-layer-fix.sh --test  # If dependencies changed
aws logs tail /aws/lambda/inspection-report-processor --since 1h  # Review logs
```

### CI/CD Integration

Add to your CI/CD pipeline:

```yaml
# Example GitHub Actions
- name: Deploy Lambda
  run: |
    cd backend/lambda-processor
    ./deploy-code-only

- name: Test Lambda
  run: |
    cd backend/lambda-processor
    ./scripts/test-lambda-deployment.sh
```

## Test Reports

### View Test History

```bash
# Recent invocations
aws lambda list-versions-by-function \
  --function-name inspection-report-processor \
  --max-items 10

# Invocation metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=inspection-report-processor \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

### Error Rates

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=inspection-report-processor \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

## Best Practices

1. **Test after every deployment**
   - Use `--test` flag with deployment scripts
   - Verify no regressions introduced

2. **Monitor logs regularly**
   - Check for warnings and errors
   - Watch for performance degradation

3. **Test with realistic data**
   - Use actual inspection reports when possible
   - Test with various PDF sizes

4. **Automate testing**
   - Integrate into CI/CD pipeline
   - Set up CloudWatch alarms for errors

5. **Document test results**
   - Keep track of what was tested
   - Note any issues or anomalies

## Quick Reference

```bash
# Deploy and test
./deploy-code-only --test

# Test only
./scripts/test-lambda-deployment.sh

# Manual invoke
aws lambda invoke --function-name inspection-report-processor \
  --payload '{"test": true}' response.json

# View logs
aws logs tail /aws/lambda/inspection-report-processor --follow

# Check status
aws lambda get-function-configuration \
  --function-name inspection-report-processor \
  --query '{State:State,LastModified:LastModified}' \
  --output json
```

---

**Last Updated:** 2026-01-28
**See Also:** [LAMBDA-DEPLOYMENT-COMPLETE-GUIDE.md](LAMBDA-DEPLOYMENT-COMPLETE-GUIDE.md)
