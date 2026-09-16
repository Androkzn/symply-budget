# Copy-Paste Commands for Lambda Build

## Step 1: Prepare Directory (Copy this into CloudShell)

```bash
mkdir -p lambda-processor && cd lambda-processor
```

---

## Step 2: Upload Files via CloudShell UI

**You need to upload 2 files manually:**

1. Click **"Actions"** button (top right of CloudShell)
2. Click **"Upload file"**
3. Navigate to and select: `/Users/andreitekhtelev/Desktop/Simple House/lambda-processor/handler.py`
4. Wait for upload to complete
5. Click **"Actions"** again → **"Upload file"**
6. Navigate to and select: `/Users/andreitekhtelev/Desktop/Simple House/lambda-processor/requirements.txt`
7. Wait for upload to complete

**OR if upload doesn't work, paste the file contents directly:**

### Paste handler.py content:
```bash
cat > handler.py << 'HANDLER_EOF'
"""
AWS Lambda Handler for Home Inspection Report Processing

This Lambda function processes large PDF inspection reports using Claude 3.5 Sonnet.
It's invoked by Cloudflare Workers and processes reports asynchronously.

Requirements:
- Python 3.11+
- anthropic SDK
- boto3 (AWS SDK)
"""

import json
import os
import base64
import time
from typing import Dict, Any, List
import boto3
from anthropic import Anthropic

# Initialize Anthropic client
anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])

# Initialize S3/R2 client
# Check if R2 credentials are provided (for Cloudflare R2)
r2_endpoint = os.environ.get('R2_ENDPOINT')
r2_access_key = os.environ.get('R2_ACCESS_KEY_ID')
r2_secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')

if r2_endpoint and r2_access_key and r2_secret_key:
    # Use R2 (S3-compatible) endpoint
    # R2 doesn't use AWS regions, but boto3 requires a region, so use us-east-1 as dummy
    from botocore.config import Config
    s3_client = boto3.client(
        's3',
        endpoint_url=r2_endpoint,
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret_key,
        region_name='us-east-1',  # Dummy region for R2
        config=Config(signature_version='s3v4')
    )
    print(f"Configured S3 client for R2 endpoint: {r2_endpoint}")
    print(f"R2 bucket name from env: {os.environ.get('R2_BUCKET_NAME', 'not set')}")
else:
    # Fallback to default AWS S3
    s3_client = boto3.client('s3')
    print("Using default AWS S3 client (R2 credentials not found)")

# Database connection (you'll need to add the connection details)
CLOUDFLARE_ACCOUNT_ID = os.environ['CLOUDFLARE_ACCOUNT_ID']
CLOUDFLARE_DATABASE_ID = os.environ['CLOUDFLARE_DATABASE_ID']
CLOUDFLARE_API_TOKEN = os.environ['CLOUDFLARE_API_TOKEN']

def lambda_handler(event, context):
    """
    Main Lambda handler

    Event structure:
    {
        "jobId": "job-uuid",
        "reportId": "report-uuid",
        "householdId": "household-uuid",
        "pdfS3Bucket": "bucket-name",
        "pdfS3Key": "path/to/file.pdf"
    }
    """
    try:
        job_id = event['jobId']
        report_id = event['reportId']
        household_id = event['householdId']
        # Use bucket from event, or fallback to environment variable
        # Always use R2_BUCKET_NAME from environment for R2, ignore payload bucket name
        s3_bucket = os.environ.get('R2_BUCKET_NAME', event.get('pdfS3Bucket', 'simple-house-reports'))
        s3_key = event['pdfS3Key']

        print(f"Processing report {report_id} for job {job_id}")
        print(f"Using bucket: {s3_bucket}, key: {s3_key}")
        print(f"R2 endpoint: {r2_endpoint}")
        print(f"R2 access key: {r2_access_key[:8]}... (truncated)")

        # Step 1: Update job status to processing
        update_job_status(job_id, 'processing', 'downloading_pdf', 10)

        # Step 2: Download PDF from S3 (R2)
        pdf_data = download_pdf_from_s3(s3_bucket, s3_key)
        file_size_mb = len(pdf_data) / (1024 * 1024)

        print(f"Downloaded PDF: {file_size_mb:.2f} MB")

        # Step 3: Convert to base64
        update_job_status(job_id, 'processing', 'converting_pdf', 20)
        pdf_base64 = base64.b64encode(pdf_data).decode('utf-8')

        # Step 4: Process with Claude (native PDF support)
        update_job_status(job_id, 'processing', 'extracting_findings', 30)

        findings, usage = process_pdf_with_claude(pdf_base64, report_id)

        print(f"Extracted {len(findings)} findings")
        print(f"Token usage: {usage}")

        # Step 5: Store findings in database
        update_job_status(job_id, 'processing', 'storing_findings', 60)
        store_findings(report_id, findings)

        # Step 6: Generate persona summaries
        update_job_status(job_id, 'processing', 'generating_summaries', 70)
        generate_summaries(report_id, findings)

        # Step 7: Generate action plans
        update_job_status(job_id, 'processing', 'generating_action_plans', 85)
        generate_action_plans(report_id, household_id, findings)

        # Step 8: Mark as complete
        update_job_status(job_id, 'completed', 'complete', 100)
        update_report_status(report_id, 'completed', {
            'processing_completed_at': get_timestamp(),
            'total_findings_count': len(findings),
            'critical_findings_count': sum(1 for f in findings if f.get('severity') == 'critical')
        })

        return {
            'statusCode': 200,
            'body': json.dumps({
                'jobId': job_id,
                'reportId': report_id,
                'findingsCount': len(findings),
                'usage': usage
            })
        }

    except Exception as e:
        print(f"Error processing report: {str(e)}")

        # Update job status to failed
        if 'job_id' in locals():
            update_job_status(job_id, 'failed', 'error', 0, str(e))

        if 'report_id' in locals():
            update_report_status(report_id, 'failed', {
                'error_message': str(e)
            })

        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


def download_pdf_from_s3(bucket: str, key: str) -> bytes:
    """Download PDF from S3/R2"""
    print(f"Attempting to download from bucket: {bucket}, key: {key}")
    print(f"S3 client endpoint: {s3_client.meta.endpoint_url if hasattr(s3_client, 'meta') else 'unknown'}")
    print(f"R2_ENDPOINT env: {os.environ.get('R2_ENDPOINT', 'not set')}")
    print(f"R2_BUCKET_NAME env: {os.environ.get('R2_BUCKET_NAME', 'not set')}")
    try:
        # List buckets to verify connection
        try:
            buckets = s3_client.list_buckets()
            bucket_names = [b['Name'] for b in buckets.get('Buckets', [])]
            print(f"Available buckets: {bucket_names}")
        except Exception as list_error:
            print(f"Could not list buckets (this is OK for R2): {str(list_error)}")
        
        response = s3_client.get_object(Bucket=bucket, Key=key)
        data = response['Body'].read()
        print(f"Successfully downloaded {len(data)} bytes from {bucket}/{key}")
        return data
    except Exception as e:
        print(f"Error downloading from {bucket}/{key}: {str(e)}")
        print(f"Error type: {type(e).__name__}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        raise


def process_pdf_with_claude(pdf_base64: str, report_id: str) -> tuple[List[Dict], Dict]:
    """
    Process PDF directly with Claude 3.5 Sonnet

    Returns: (findings, usage_stats)
    """

    # System prompt with caching (1024+ tokens for cache eligibility)
    system_prompt = """You are an expert home inspection analyst specializing in extracting structured data from inspection reports.

Your task is to analyze home inspection reports and extract all findings with precise categorization.

EXTRACTION REQUIREMENTS:

1. SYSTEM CATEGORIES (use exact matches):
   - roof, foundation, electrical, plumbing, hvac
   - exterior, interior, safety, appliances, drainage
   - attic, basement, garage, insulation, windows_doors, structure, other

2. SEVERITY LEVELS:
   - critical: Immediate safety hazards, structural failures, major system failures
   - major: Significant issues requiring professional repair, deferred maintenance
   - minor: Small repairs, cosmetic issues, routine maintenance
   - informational: Normal wear, documentation, observations

3. REQUIRED FIELDS:
   - system_category: One of the categories above
   - severity: One of the severity levels above
   - title: Brief descriptive title (5-10 words)
   - description: Full details from the report
   - location: Specific room/area (e.g., "First Floor Bathroom", "Exterior Deck", "Attic")
   - implications: What happens if not addressed
   - recommended_action: What to do
   - timeframe: "immediate" | "short_term" (1-3 months) | "long_term" (3-12 months)
   - urgency_score: Integer 1-10 (10 = critical safety issue)

4. OPTIONAL FIELDS:
   - plain_language_summary: Simple explanation for non-technical homeowners
   - evidence_page_numbers: Array of page numbers where issue is documented
   - estimated_cost_min: Estimated minimum repair cost in dollars
   - estimated_cost_max: Estimated maximum repair cost in dollars

IMPORTANT:
- Extract ALL findings, even minor ones
- Be accurate and specific
- Use exact location descriptions from the report
- Preserve technical details
- Return valid JSON only

Return format:
{
  "findings": [
    {
      "system_category": "electrical",
      "severity": "critical",
      "title": "Obsolete electrical panel requires replacement",
      "description": "...",
      "location": "First Floor Panel",
      "implications": "...",
      "recommended_action": "...",
      "timeframe": "immediate",
      "urgency_score": 9,
      "plain_language_summary": "...",
      "evidence_page_numbers": [15, 16],
      "estimated_cost_min": 1500,
      "estimated_cost_max": 3000
    }
  ]
}"""

    # Use claude-3-5-sonnet-20240620 (the standard model name)
    # Can be overridden via ANTHROPIC_MODEL environment variable
    model_name = os.environ.get('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20240620')
    print(f"Using model: {model_name}")
    response = anthropic_client.messages.create(
        model=model_name,
        max_tokens=16384,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"}  # Enable prompt caching
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": "Extract ALL findings from this home inspection report. Return structured JSON."
                    }
                ],
            }
        ],
    )

    # Extract JSON from response
    result_text = response.content[0].text
    result_json = extract_json(result_text)

    findings = result_json.get('findings', [])

    # Usage statistics
    usage = {
        'input_tokens': response.usage.input_tokens,
        'output_tokens': response.usage.output_tokens,
        'cache_creation_tokens': getattr(response.usage, 'cache_creation_input_tokens', 0),
        'cache_read_tokens': getattr(response.usage, 'cache_read_input_tokens', 0),
    }

    return findings, usage


def extract_json(text: str) -> Dict:
    """Extract JSON from markdown code blocks or raw text"""
    import re

    # Try to extract from markdown code block
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        return json.loads(match.group(1).strip())

    # Try to find JSON object
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        return json.loads(match.group(0))

    return json.loads(text)


def store_findings(report_id: str, findings: List[Dict]) -> None:
    """Store findings in Cloudflare D1 database"""
    # TODO: Implement D1 API calls
    # For now, just log
    print(f"Storing {len(findings)} findings for report {report_id}")

    # You'll need to implement D1 API calls here
    # https://developers.cloudflare.com/d1/platform/client-api/


def generate_summaries(report_id: str, findings: List[Dict]) -> None:
    """Generate persona-specific summaries"""
    # TODO: Implement persona summary generation
    print(f"Generating summaries for report {report_id}")


def generate_action_plans(report_id: str, household_id: str, findings: List[Dict]) -> None:
    """Generate time-stratified action plans"""
    # TODO: Implement action plan generation
    print(f"Generating action plans for report {report_id}")


def update_job_status(job_id: str, status: str, stage: str, progress: int, error: str = None) -> None:
    """Update processing job status in D1"""
    # TODO: Implement D1 API call
    print(f"Job {job_id}: {status} - {stage} ({progress}%)")


def update_report_status(report_id: str, status: str, fields: Dict[str, Any]) -> None:
    """Update report status in D1"""
    # TODO: Implement D1 API call
    print(f"Report {report_id}: {status}")


def get_timestamp() -> str:
    """Get current timestamp in ISO format"""
    from datetime import datetime
    return datetime.utcnow().isoformat() + 'Z'
HANDLER_EOF
```

### Paste requirements.txt content:
```bash
cat > requirements.txt << 'REQ_EOF'
anthropic>=0.76.0
boto3>=1.34.131
REQ_EOF
```

---

## Step 3: Build Package (Copy this into CloudShell)

```bash
cd ~/lambda-processor
rm -rf package lambda-function.zip
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..
ls -lh lambda-function.zip
```

**Wait for this to complete (takes 1-2 minutes)**

---

## Step 4: Download Package

1. Click **"Actions"** → **"Download file"**
2. Enter: `lambda-function.zip`
3. Click **Download**
4. Save to your Downloads folder

---

## Step 5: Deploy to Lambda (Run this in your LOCAL terminal)

```bash
cd ~/Downloads
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

---

## Step 6: Verify It Works (Run this in your LOCAL terminal)

```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

**You should see:** ✅ No more `pydantic_core` errors! The handler should import successfully.

---

## Quick Summary

1. **CloudShell:** Run Step 1, Step 2 (upload files OR paste content), Step 3
2. **CloudShell UI:** Download the zip file (Step 4)
3. **Your Terminal:** Run Step 5 and Step 6

**Total time: ~5 minutes**
