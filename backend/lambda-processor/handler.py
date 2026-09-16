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
import io
import boto3
from anthropic import Anthropic
from PyPDF2 import PdfReader, PdfWriter

# Batch processing modules
from job_state import JobState, JobStateManager, JobPhase
from structured_logger import StructuredLogger
from batch_processor import BatchProcessor
from ai_adapters import extract_findings_multi, resolve_runtime

# Initialize Anthropic client (lazy-safe if key missing for OpenAI/Gemini-only runs)
_anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
anthropic_client = Anthropic(api_key=_anthropic_key) if _anthropic_key else None

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

# Lambda client for batch processing
lambda_client = boto3.client('lambda', region_name='us-east-1')
LAMBDA_FUNCTION_NAME = os.environ.get('AWS_LAMBDA_FUNCTION_NAME', 'inspection-report-processor')

# Backend Worker base URL + lease secret, used to exchange a one-time BYOK
# credential lease for the acting user's decrypted API key (§18.5 — the key is
# never carried in the invocation payload). Both are optional: when either is
# unset, or the exchange fails, processing falls back to the managed key exactly
# as before, so this can never break a report.
# Lambda env defaults target House; per-invocation event.workerApiBase overrides
# so child Workers (Budget/Kaizen/Health) can share the same Lambda ARN.
SIMPLEHOUSE_API_BASE = os.environ.get('SIMPLEHOUSE_API_BASE') or os.environ.get('WORKER_API_BASE')
AI_CREDENTIAL_LEASE_SECRET = os.environ.get('AI_CREDENTIAL_LEASE_SECRET')

# House R2 bucket fallback when neither the invoke payload nor Lambda env sets a bucket.
DEFAULT_R2_BUCKET = 'simple-house-reports'


def resolve_r2_bucket(event):
    """Prefer bucket from the invoking Worker payload; fall back to Lambda env (House)."""
    return (
        event.get('pdfS3Bucket')
        or os.environ.get('R2_BUCKET_NAME')
        or DEFAULT_R2_BUCKET
    )


def resolve_worker_api_base(event):
    """Prefer worker callback URL from payload; fall back to Lambda env (House)."""
    return (
        event.get('workerApiBase')
        or SIMPLEHOUSE_API_BASE
    )


def consume_credential_lease(lease_token, worker_api_base=None):
    """
    Exchange a one-time credential lease for the user's decrypted API key via
    POST /internal/ai-credential-leases/consume. Returns a dict with keys
    provider / vendor_model_id / registry_key / api_key on success, else None
    (caller then uses the managed key). The key is never logged.
    """
    if not lease_token or not AI_CREDENTIAL_LEASE_SECRET:
        return None
    api_base = worker_api_base or SIMPLEHOUSE_API_BASE
    if not api_base:
        return None
    import urllib.request
    import urllib.error
    url = f"{api_base.rstrip('/')}/internal/ai-credential-leases/consume"
    body = json.dumps({"token": lease_token}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {AI_CREDENTIAL_LEASE_SECRET}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("api_key"):
            print(f"[lease] consumed BYOK lease provider={data.get('provider')} "
                  f"model={data.get('vendor_model_id')}")
            return data
        return None
    except Exception as e:  # noqa: BLE001 — fail-safe to managed on any error
        print(f"[lease] consume failed, falling back to managed: {e}")
        return None


def handle_batch_resume(event, context):
    """
    Handle batch resume from checkpoint

    This is triggered by async Lambda invocations from previous batches
    """
    job_id = event['jobId']
    report_id = event['reportId']
    household_id = event['householdId']
    batch_num = event.get('batchNum', 0)
    bucket = resolve_r2_bucket(event)

    # Create logger
    logger = StructuredLogger(job_id, report_id, s3_client, bucket)
    logger.info(f"Batch resume requested", phase="resume", batch_num=batch_num)

    try:
        # Load state from R2
        state_manager = JobStateManager(s3_client, bucket)
        job_state = state_manager.load_state(job_id)

        if not job_state:
            logger.error("No checkpoint found", phase="resume")
            return {'statusCode': 404, 'body': json.dumps({'error': 'No checkpoint found'})}

        logger.info("Checkpoint loaded successfully", phase="resume",
                   chunks_processed=job_state.chunks_processed,
                   findings_count=job_state.findings_count)

        # TODO: Implement actual batch resume logic
        # For now, just return success
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Batch resume handler - TODO',
                'job_id': job_id,
                'batch_num': batch_num
            })
        }

    except Exception as e:
        logger.error(f"Batch resume failed: {str(e)}", phase="resume", exception=e)
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
    finally:
        logger.save_final_metrics()


def lambda_handler(event, context):
    """
    Main Lambda handler with batch processing support

    Event structure:
    Standard mode:
    {
        "jobId": "job-uuid",
        "reportId": "report-uuid",
        "householdId": "household-uuid",
        "pdfS3Bucket": "bucket-name",
        "pdfS3Key": "path/to/file.pdf",
        "workerApiBase": "https://brand-api.example.workers.dev"
    }

    Batch resume mode:
    {
        "mode": "resume_batch",
        "jobId": "job-uuid",
        "reportId": "report-uuid",
        "householdId": "household-uuid",
        "batchNum": 1
    }
    """
    # Detect batch resume mode
    mode = event.get('mode', 'standard')

    if mode == 'resume_batch':
        return handle_batch_resume(event, context)

    # Standard processing
    job_id = None
    logger = None

    try:
        job_id = event['jobId']
        report_id = event['reportId']
        household_id = event['householdId']

        # BYOK: exchange the one-time lease for the user's own decrypted key so
        # inference runs on their provider account (§18.5). No-op for managed
        # reports; fail-safe to the managed key on any error.
        lease_token = event.get('leaseToken')
        worker_api_base = resolve_worker_api_base(event)
        if lease_token and not event.get('apiKey'):
            leased = consume_credential_lease(lease_token, worker_api_base)
            if leased:
                event['apiKey'] = leased['api_key']
                if leased.get('provider'):
                    event['aiProvider'] = leased['provider']
                if leased.get('registry_key'):
                    event['selectedModelId'] = leased['registry_key']
                event['managedOnly'] = False

        # Prefer bucket from invoking Worker payload; fall back to Lambda env (House).
        s3_bucket = resolve_r2_bucket(event)
        s3_key = event['pdfS3Key']

        # Initialize structured logger
        logger = StructuredLogger(job_id, report_id, s3_client, s3_bucket)
        logger.info(f"Starting report processing", phase="initialization",
                   bucket=s3_bucket, key=s3_key, file_size_mb=0)

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

        # Step 3: Check page count and handle chunking if needed
        update_job_status(job_id, 'processing', 'checking_pdf_size', 15)
        page_count = count_pdf_pages(pdf_data)
        print(f"PDF has {page_count} pages")

        # Claude API limit: 100 pages maximum
        MAX_PAGES_PER_REQUEST = 100

        if page_count > MAX_PAGES_PER_REQUEST:
            print(f"PDF exceeds {MAX_PAGES_PER_REQUEST} page limit. Splitting into chunks...")
            update_job_status(job_id, 'processing', 'splitting_pdf', 20)

            # Split PDF into chunks of 40 pages for reliable processing
            pdf_chunks = split_pdf_into_chunks(pdf_data, max_pages_per_chunk=40)
            print(f"Split into {len(pdf_chunks)} chunks")

            # Process each chunk
            all_findings = []
            all_image_ids = []
            total_usage = {
                'input_tokens': 0,
                'output_tokens': 0,
                'cache_creation_tokens': 0,
                'cache_read_tokens': 0,
            }

            for chunk_idx, chunk_data in enumerate(pdf_chunks):
                chunk_num = chunk_idx + 1
                chunk_start_page = chunk_idx * 40  # 40 pages per chunk
                print(f"Processing chunk {chunk_num}/{len(pdf_chunks)}")

                # Extract images from this chunk
                update_job_status(job_id, 'processing', f'extracting_images_chunk_{chunk_num}',
                                  25 + int((chunk_num / len(pdf_chunks)) * 5))

                chunk_image_ids = extract_and_process_images_safe(
                    chunk_data, report_id, household_id, chunk_start_page, s3_bucket
                )
                all_image_ids.extend(chunk_image_ids)

                # Update progress (30-60% range for chunk processing)
                progress = 30 + int((chunk_num / len(pdf_chunks)) * 30)
                update_job_status(job_id, 'processing', f'extracting_findings_chunk_{chunk_num}', progress)

                # Convert chunk to base64
                chunk_base64 = base64.b64encode(chunk_data).decode('utf-8')

                # Process chunk
                chunk_findings, chunk_usage = process_pdf_with_claude(
                    chunk_base64, report_id, pdf_bytes=chunk_data, event=event
                )
                all_findings.extend(chunk_findings)

                # Aggregate usage
                for key in total_usage:
                    total_usage[key] += chunk_usage.get(key, 0)

                print(f"Chunk {chunk_num}: extracted {len(chunk_findings)} findings")

                # Add delay between chunks to avoid rate limiting (except after last chunk)
                if chunk_num < len(pdf_chunks):
                    delay_seconds = 20  # 20 seconds between chunks to stay under 30k tokens/minute
                    print(f"Waiting {delay_seconds}s before next chunk to avoid rate limits...")
                    time.sleep(delay_seconds)

            findings = all_findings
            usage = total_usage
            print(f"Total from all chunks: {len(findings)} findings")
            print(f"Total token usage: {usage}")

        else:
            # PDF is within limit, process normally
            print(f"PDF within {MAX_PAGES_PER_REQUEST} page limit. Processing normally...")

            # Extract images before Claude processing
            update_job_status(job_id, 'processing', 'extracting_images', 20)
            all_image_ids = extract_and_process_images_safe(pdf_data, report_id, household_id, 0, s3_bucket)

            update_job_status(job_id, 'processing', 'converting_pdf', 23)
            pdf_base64 = base64.b64encode(pdf_data).decode('utf-8')

            # Step 4: Process with Claude (native PDF support)
            update_job_status(job_id, 'processing', 'extracting_findings', 30)

            findings, usage = process_pdf_with_claude(
                pdf_base64, report_id, pdf_bytes=pdf_data, event=event
            )

            print(f"Extracted {len(findings)} findings")
            print(f"Token usage: {usage}")

        # Step 5: Store findings in database
        update_job_status(job_id, 'processing', 'storing_findings', 60)
        store_findings(report_id, findings)

        # Step 5b: Analyze images with Claude Vision and update finding links
        if all_image_ids:
            update_job_status(job_id, 'processing', 'analyzing_images_with_vision', 65)
            analyze_and_link_images(report_id, household_id, findings, s3_bucket)

        # Step 6: Generate persona summaries
        update_job_status(job_id, 'processing', 'generating_summaries', 70)
        generate_summaries(report_id, findings)

        # Step 7: Generate action plans
        update_job_status(job_id, 'processing', 'generating_action_plans', 85)
        generate_action_plans(report_id, household_id, findings)

        # Step 8: Generate task drafts from findings
        update_job_status(job_id, 'processing', 'generating_task_drafts', 90)
        drafts_result = generate_task_drafts(report_id, household_id, findings)

        # Step 9: Extract home features and generate maintenance suggestions
        update_job_status(job_id, 'processing', 'extracting_home_features', 95)
        features_result = extract_home_features(report_id, household_id, findings)

        # Step 10: Send notifications
        critical_drafts = drafts_result.get('critical_count', 0)
        total_drafts = drafts_result.get('total_drafts', 0)
        send_completion_notifications(report_id, household_id, findings, total_drafts, critical_drafts, features_result.get('suggestions_generated', 0))

        # Step 11: Mark as complete
        update_job_status(job_id, 'completed', 'complete', 100)
        update_report_status(report_id, 'completed', {
            'processing_completed_at': get_timestamp(),
            'total_findings_count': len(findings),
            'critical_findings_count': sum(1 for f in findings if f.get('severity') == 'critical')
        })

        # Save final metrics and flush logs
        if logger:
            logger.metrics['findings_extracted'] = len(findings)
            logger.info("Processing completed successfully", phase="completed",
                       findings_count=len(findings),
                       total_usage=total_usage if 'total_usage' in locals() else usage)
            logger.save_final_metrics()

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

        # Log error
        if logger:
            logger.error(f"Processing failed: {str(e)}", phase="error", exception=e)
            logger.save_final_metrics()

        # Update job status to failed
        if job_id:
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


def count_pdf_pages(pdf_data: bytes) -> int:
    """Count the number of pages in a PDF"""
    try:
        pdf_reader = PdfReader(io.BytesIO(pdf_data))
        return len(pdf_reader.pages)
    except Exception as e:
        print(f"Error counting PDF pages: {str(e)}")
        return 0


def split_pdf_into_chunks(pdf_data: bytes, max_pages_per_chunk: int = 40) -> List[bytes]:
    """
    Split a PDF into chunks of max_pages_per_chunk pages

    Args:
        pdf_data: Raw PDF bytes
        max_pages_per_chunk: Maximum pages per chunk (default 40 for reliable processing)

    Returns:
        List of PDF chunks as bytes
    """
    try:
        pdf_reader = PdfReader(io.BytesIO(pdf_data))
        total_pages = len(pdf_reader.pages)
        chunks = []

        print(f"Splitting PDF: {total_pages} pages into chunks of {max_pages_per_chunk} pages")

        for start_page in range(0, total_pages, max_pages_per_chunk):
            end_page = min(start_page + max_pages_per_chunk, total_pages)

            # Create a new PDF with this chunk
            pdf_writer = PdfWriter()
            for page_num in range(start_page, end_page):
                try:
                    pdf_writer.add_page(pdf_reader.pages[page_num])
                except Exception as page_error:
                    print(f"Warning: Could not add page {page_num + 1}: {str(page_error)}")
                    # Skip problematic pages
                    continue

            # Write to bytes with compression
            chunk_buffer = io.BytesIO()
            try:
                pdf_writer.write(chunk_buffer)
                chunk_buffer.seek(0)
                chunk_data = chunk_buffer.read()

                # Validate the chunk can be read back
                test_reader = PdfReader(io.BytesIO(chunk_data))
                print(f"Created chunk {len(chunks) + 1}: pages {start_page + 1}-{end_page} ({len(chunk_data) / 1024 / 1024:.2f} MB, {len(test_reader.pages)} pages validated)")

                chunks.append(chunk_data)
            except Exception as write_error:
                print(f"Error creating chunk {start_page + 1}-{end_page}: {str(write_error)}")
                # Skip this chunk if it can't be written
                continue

        return chunks
    except Exception as e:
        print(f"Error splitting PDF: {str(e)}")
        raise


def extract_images_from_pdf(pdf_data: bytes, start_page: int = 0, max_images: int = 50) -> List[Dict]:
    """
    Extract images from PDF using PyMuPDF.
    Skip images < 100x100px (decorative/logos).
    Limit to max_images to manage memory.
    """
    import fitz  # PyMuPDF
    from PIL import Image

    extracted_images = []

    try:
        pdf_document = fitz.open(stream=pdf_data, filetype="pdf")

        for page_num in range(len(pdf_document)):
            if len(extracted_images) >= max_images:
                break

            page = pdf_document[page_num]
            image_list = page.get_images(full=True)

            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = pdf_document.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]

                pil_image = Image.open(io.BytesIO(image_bytes))
                width, height = pil_image.size

                # Skip small images
                if width < 100 or height < 100:
                    continue

                extracted_images.append({
                    'page_number': start_page + page_num + 1,
                    'image_data': image_bytes,
                    'format': image_ext,
                    'width': width,
                    'height': height,
                    'file_size': len(image_bytes),
                    'position_index': img_index
                })

        pdf_document.close()
        print(f"[IMAGE-EXTRACT] Extracted {len(extracted_images)} images")
        return extracted_images

    except Exception as e:
        print(f"[IMAGE-EXTRACT] Error: {e}")
        return []


def generate_thumbnail(image_data: bytes, max_size: int = 300, quality: int = 85) -> bytes:
    """Generate JPEG thumbnail maintaining aspect ratio."""
    from PIL import Image

    try:
        image = Image.open(io.BytesIO(image_data))

        # Convert to RGB for JPEG
        if image.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', image.size, (255, 255, 255))
            if image.mode == 'P':
                image = image.convert('RGBA')
            background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
            image = background

        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        output = io.BytesIO()
        image.save(output, format='JPEG', quality=quality, optimize=True)
        return output.getvalue()

    except Exception as e:
        print(f"[THUMBNAIL] Error: {e}")
        return None


def upload_images_to_r2(images: List[Dict], report_id: str, bucket: str) -> List[Dict]:
    """Upload original images + thumbnails to R2."""
    import uuid
    uploaded = []

    for img_data in images:
        image_id = str(uuid.uuid4())

        format_to_mime = {
            'png': 'image/png',
            'jpeg': 'image/jpeg',
            'jpg': 'image/jpeg',
            'webp': 'image/webp'
        }
        content_type = format_to_mime.get(img_data['format'], 'image/jpeg')
        extension = img_data['format']

        # Upload original
        image_key = f"reports/{report_id}/images/{image_id}.{extension}"

        try:
            s3_client.put_object(
                Bucket=bucket,
                Key=image_key,
                Body=img_data['image_data'],
                ContentType=content_type
            )

            # Upload thumbnail
            thumbnail_data = generate_thumbnail(img_data['image_data'])
            thumbnail_key = None

            if thumbnail_data:
                thumbnail_key = f"reports/{report_id}/thumbnails/{image_id}.jpg"
                s3_client.put_object(
                    Bucket=bucket,
                    Key=thumbnail_key,
                    Body=thumbnail_data,
                    ContentType='image/jpeg'
                )

            uploaded.append({
                'image_id': image_id,
                'image_key': image_key,
                'thumbnail_key': thumbnail_key,
                'page_number': img_data['page_number'],
                'width': img_data['width'],
                'height': img_data['height'],
                'file_size': img_data['file_size'],
                'content_type': content_type
            })

            print(f"[R2-UPLOAD] Uploaded image {image_id} (page {img_data['page_number']})")

        except Exception as e:
            print(f"[R2-UPLOAD] Error: {e}")
            continue

    # Clear image_data from memory
    for img in images:
        if 'image_data' in img:
            del img['image_data']

    return uploaded


def analyze_image_with_vision(image_data: bytes) -> Dict:
    """Use Claude Vision to analyze image and extract metadata."""
    import re

    try:
        image_base64 = base64.b64encode(image_data).decode('utf-8')

        prompt = """Analyze this image from a home inspection report.

Identify:
1. System category (electrical, plumbing, roof, hvac, foundation, exterior, interior, safety, other)
2. Image type (photo, chart, diagram, table, other)
3. Brief description (1-2 sentences describing what's shown)
4. Any visible issues or concerns

Return JSON:
{
  "description": "brief description",
  "system_category": "category",
  "image_type": "photo|chart|diagram|table|other",
  "has_issues": true/false,
  "confidence": 0.0-1.0
}"""

        response = anthropic_client.messages.create(
            model='claude-sonnet-4-5-20250929',
            max_tokens=512,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_base64
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }]
        )

        result_text = response.content[0].text
        # Extract JSON from response (may have markdown code blocks)
        json_match = re.search(r'```json\s*(\{.*?\})\s*```', result_text, re.DOTALL)
        if json_match:
            result_json = json.loads(json_match.group(1))
        else:
            result_json = json.loads(result_text)

        return result_json

    except Exception as e:
        print(f"[VISION] Error: {e}")
        return {
            'description': '',
            'system_category': 'other',
            'image_type': 'other',
            'has_issues': False,
            'confidence': 0.0
        }


def store_images_in_d1(images: List[Dict], report_id: str, household_id: str, findings: List[Dict]) -> None:
    """Store image metadata in report_images table."""
    import urllib.request
    import json

    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"

    # Match images to findings by page number
    for image in images:
        image_id = image['image_id']
        page_num = image['page_number']

        # Find findings on this page
        matching_findings = [
            f['id'] for f in findings
            if page_num in f.get('evidence_page_numbers', [])
        ]

        # Get AI description (if available)
        ai_description = str(image.get('ai_description', '')).replace("'", "''")

        image_type = image.get('image_type', 'photo')

        # Primary finding (first match)
        primary_finding = matching_findings[0] if matching_findings else None
        finding_id_sql = f"'{primary_finding}'" if primary_finding else 'NULL'

        # All matching findings as JSON array
        finding_ids_json = json.dumps(matching_findings).replace("'", "''")

        sql = f"""INSERT INTO report_images (
            id, report_id, page_number,
            image_key, image_type,
            ai_description, ai_confidence,
            width, height,
            finding_id,
            created_at
        ) VALUES (
            '{image_id}', '{report_id}', {page_num},
            '{image['image_key']}', '{image_type}',
            '{ai_description}', {image.get('ai_confidence', 0.8)},
            {image['width']}, {image['height']},
            {finding_id_sql},
            datetime('now')
        )"""

        payload = json.dumps({"sql": sql}).encode('utf-8')
        req = urllib.request.Request(url, data=payload, method='POST')
        req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
        req.add_header('Content-Type', 'application/json')

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                print(f"[D1-IMAGES] Stored image {image_id}")
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if hasattr(e, 'read') else str(e)
            print(f"[D1-IMAGES] Error storing {image_id}: {e} - Response: {error_body}")
        except Exception as e:
            print(f"[D1-IMAGES] Error storing {image_id}: {e}")


def extract_and_process_images_safe(pdf_data: bytes, report_id: str, household_id: str,
                                     start_page: int = 0, bucket: str = DEFAULT_R2_BUCKET) -> List[str]:
    """
    Safely extract, upload, and store images.
    Returns list of image IDs (empty if failed).
    Errors are logged but don't break the pipeline.
    """
    try:
        # Extract images
        images = extract_images_from_pdf(pdf_data, start_page, max_images=50)

        if not images:
            print(f"[IMAGE-SAFE] No images found")
            return []

        # Upload to R2
        uploaded = upload_images_to_r2(images, report_id, bucket)

        if not uploaded:
            print(f"[IMAGE-SAFE] No images uploaded")
            return []

        # Store in D1 (findings will be linked later)
        # For now, store with empty findings array
        for img in uploaded:
            img['ai_description'] = ''
            img['system_category'] = 'other'
            img['image_type'] = 'photo'
            img['ai_confidence'] = 0.5

        store_images_in_d1(uploaded, report_id, household_id, [])

        return [img['image_id'] for img in uploaded]

    except Exception as e:
        print(f"[IMAGE-SAFE] Error: {e}")
        import traceback
        print(f"[IMAGE-SAFE] Traceback: {traceback.format_exc()}")
        return []


def analyze_and_link_images(report_id: str, household_id: str, findings: List[Dict],
                            bucket: str = DEFAULT_R2_BUCKET) -> None:
    """
    Fetch images from D1, analyze with Claude Vision, update with descriptions and better finding links.
    Limit to 20 images to avoid timeout.
    """
    import urllib.request
    import json

    print(f"[VISION-LINK] Starting vision analysis for {report_id}")

    # Fetch images from D1
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"

    sql = f"SELECT * FROM report_images WHERE report_id = '{report_id}' AND status = 'ready' ORDER BY page_number LIMIT 20"
    payload = json.dumps({"sql": sql}).encode('utf-8')
    req = urllib.request.Request(url, data=payload, method='POST')
    req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            images = result.get('result', [{}])[0].get('results', [])

        if not images:
            print(f"[VISION-LINK] No images to analyze")
            return

        print(f"[VISION-LINK] Analyzing {len(images)} images")

        for idx, image in enumerate(images):
            try:
                # Download image from R2
                image_obj = s3_client.get_object(Bucket=bucket, Key=image['image_key'])
                image_data = image_obj['Body'].read()

                # Analyze with Claude Vision
                analysis = analyze_image_with_vision(image_data)

                # Update image metadata in D1
                update_sql = f"""UPDATE report_images
                              SET ai_description = '{analysis.get('description', '').replace("'", "''")}',
                                  system_category = '{analysis.get('system_category', 'other')}',
                                  image_type = '{analysis.get('image_type', 'photo')}',
                                  ai_confidence = {analysis.get('confidence', 0.8)},
                                  updated_at = datetime('now')
                              WHERE id = '{image['id']}'"""

                update_payload = json.dumps({"sql": update_sql}).encode('utf-8')
                update_req = urllib.request.Request(url, data=update_payload, method='POST')
                update_req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
                update_req.add_header('Content-Type', 'application/json')

                with urllib.request.urlopen(update_req, timeout=30) as update_resp:
                    print(f"[VISION-LINK] Updated image {idx+1}/{len(images)}")

            except Exception as e:
                print(f"[VISION-LINK] Error processing image {idx+1}: {e}")
                continue

    except Exception as e:
        print(f"[VISION-LINK] Error: {e}")


def get_image_ids_for_finding(finding_id: str, report_id: str) -> List[str]:
    """Query D1 to get image IDs linked to this finding."""
    import urllib.request
    import json

    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"

    sql = f"""SELECT id FROM report_images
              WHERE report_id = '{report_id}'
              AND status = 'ready'
              AND (finding_id = '{finding_id}' OR finding_ids LIKE '%{finding_id}%')"""

    payload = json.dumps({"sql": sql}).encode('utf-8')
    req = urllib.request.Request(url, data=payload, method='POST')
    req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            results = result.get('result', [{}])[0].get('results', [])
            return [row['id'] for row in results]
    except Exception as e:
        print(f"[IMAGE-QUERY] Error: {e}")
        return []


def process_pdf_with_claude(
    pdf_base64: str,
    report_id: str,
    pdf_bytes: bytes | None = None,
    event: dict | None = None,
) -> tuple[List[Dict], Dict]:
    """
    Process PDF with the resolved AI provider (Anthropic PDF native, or
    OpenAI/Gemini via text extraction).
    """
    event = event or {}
    provider, model_name, _ = resolve_runtime(event)

    if provider != 'anthropic':
        findings, usage, _used = extract_findings_multi(
            pdf_base64=pdf_base64,
            pdf_bytes=pdf_bytes,
            report_id=report_id,
            event=event,
        )
        return findings, usage

    if anthropic_client is None:
        raise RuntimeError('ANTHROPIC_API_KEY not configured')

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

    # Catalog-resolved model; env ANTHROPIC_MODEL remains an emergency override.
    model_name = os.environ.get('ANTHROPIC_MODEL') or model_name
    print(f"Using model: {model_name} (provider=anthropic)")
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
    import urllib.request
    import urllib.error
    import uuid
    
    print(f"[D1-FINDINGS] Storing {len(findings)} findings for report {report_id}")
    
    for i, finding in enumerate(findings):
        finding_id = str(uuid.uuid4())
        
        # Extract fields with defaults
        system_category = finding.get('system_category', 'general').replace("'", "''")
        severity = finding.get('severity', 'informational').replace("'", "''")
        title = finding.get('title', '').replace("'", "''")
        description = finding.get('description', '').replace("'", "''")
        plain_language = finding.get('plain_language_summary', '').replace("'", "''")
        confidence = finding.get('confidence', 0.8)
        evidence = finding.get('evidence', {})
        page_numbers = json.dumps(evidence.get('page_numbers', []))
        location = finding.get('location', '').replace("'", "''") if finding.get('location') else ''
        urgency_score = finding.get('urgency_score', 5)
        impact = finding.get('impact', '').replace("'", "''") if finding.get('impact') else ''
        raw_output = json.dumps(finding).replace("'", "''")
        
        sql = f"""INSERT INTO findings (
            id, report_id, system_category, severity, title, description,
            plain_language_summary, ai_confidence, evidence_page_numbers,
            location_description, urgency_score, impact_description, raw_ai_output,
            created_at, updated_at
        ) VALUES (
            '{finding_id}', '{report_id}', '{system_category}', '{severity}', 
            '{title}', '{description}', '{plain_language}', {confidence},
            '{page_numbers}', '{location}', {urgency_score}, '{impact}',
            '{raw_output}', datetime('now'), datetime('now')
        )"""
        
        url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
        payload = json.dumps({"sql": sql}).encode('utf-8')
        
        req = urllib.request.Request(url, data=payload, method='POST')
        req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
        req.add_header('Content-Type', 'application/json')
        
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.loads(response.read().decode('utf-8'))
                print(f"[D1-FINDINGS] Stored finding {i+1}/{len(findings)}: {title[:50]}...")
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else 'No response body'
            print(f"[D1-FINDINGS] HTTP Error storing finding {i+1}: {e.code} - {error_body}")
        except Exception as e:
            print(f"[D1-FINDINGS] Error storing finding {i+1}: {e}")


def generate_summaries(report_id: str, findings: List[Dict]) -> None:
    """Generate persona-specific summaries using Claude"""
    import urllib.request
    import urllib.error
    import uuid
    
    print(f"[SUMMARIES] Generating summaries for report {report_id}")
    
    if not findings:
        print("[SUMMARIES] No findings to summarize")
        return
    
    personas = ['novice', 'diy', 'technical', 'executive']
    findings_json = json.dumps(findings, indent=2)
    
    for persona in personas:
        try:
            prompt = get_summary_prompt(persona, findings_json)
            
            response = anthropic_client.messages.create(
                model=os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-5-20250929'),
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}]
            )
            
            result_text = response.content[0].text if response.content else '{}'
            
            # Parse JSON from response
            try:
                # Try to extract JSON from markdown code blocks
                import re
                json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', result_text)
                if json_match:
                    summary_data = json.loads(json_match.group(1).strip())
                else:
                    summary_data = json.loads(result_text)
            except json.JSONDecodeError:
                print(f"[SUMMARIES] Failed to parse {persona} summary JSON, using defaults")
                summary_data = {
                    'overall_condition': 'fair',
                    'key_concerns': [],
                    'immediate_attention_items': [],
                    'executive_summary': 'Summary could not be generated.'
                }
            
            # Store summary in D1
            summary_id = str(uuid.uuid4())
            overall_condition = summary_data.get('overall_condition', 'fair').replace("'", "''")
            key_concerns = json.dumps(summary_data.get('key_concerns', [])).replace("'", "''")
            immediate_actions = json.dumps(summary_data.get('immediate_attention_items', [])).replace("'", "''")
            cost_min = summary_data.get('total_estimated_cost_min', 0) or 0
            cost_max = summary_data.get('total_estimated_cost_max', 0) or 0
            summary_text = summary_data.get('executive_summary', '').replace("'", "''")
            
            sql = f"""INSERT INTO report_summaries (
                id, report_id, summary_type, overall_condition, key_concerns,
                immediate_actions, estimated_total_cost_min, estimated_total_cost_max,
                summary_text, generated_at, ai_model_version, prompt_version, created_at
            ) VALUES (
                '{summary_id}', '{report_id}', '{persona}', '{overall_condition}',
                '{key_concerns}', '{immediate_actions}', {cost_min}, {cost_max},
                '{summary_text}', datetime('now'), 'claude-sonnet-4-5-20250929', 'v1', datetime('now')
            )"""
            
            url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
            payload = json.dumps({"sql": sql}).encode('utf-8')
            
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
            req.add_header('Content-Type', 'application/json')
            
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"[SUMMARIES] Stored {persona} summary for report {report_id}")
                
        except Exception as e:
            print(f"[SUMMARIES] Error generating {persona} summary: {e}")


def get_summary_prompt(persona: str, findings_json: str) -> str:
    """Get persona-specific summary prompt"""
    base = f"""Based on these home inspection findings, create a summary.

FINDINGS:
{findings_json}

CRITICAL COST CALCULATION INSTRUCTIONS:
Calculate total_estimated_cost_min and total_estimated_cost_max by summing ALL repair costs from every finding. Use realistic local contractor prices:
- Electrical panel replacement (Federal Pioneer/Stab-Lok): $2,500 - $5,000
- HVAC replacement: $3,000 - $8,000
- Roof repairs: $500 - $15,000 depending on scope
- Plumbing repairs: $200 - $5,000
- Foundation/structural issues: $1,000 - $20,000+
- Window replacement (per window): $300 - $800
- Smoke/CO detectors: $30 - $100 each
- Minor repairs/painting: $100 - $500 each

DO NOT underestimate! Sum up ALL items mentioned in the findings.

Return JSON with this structure:
{{
  "overall_condition": "excellent" | "good" | "fair" | "poor",
  "key_concerns": ["concern 1", "concern 2"],
  "immediate_attention_items": ["item 1", "item 2"],
  "total_estimated_cost_min": 0,
  "total_estimated_cost_max": 0,
  "executive_summary": "2-3 sentence overview"
}}

IMPORTANT: total_estimated_cost_min and total_estimated_cost_max MUST be numeric values (integers, no $ or commas) representing the TOTAL of ALL repairs needed. For example, if you have electrical panel ($2500-4500) + smoke detectors ($60-120) + minor items ($300-600), then total_estimated_cost_min = 2860 and total_estimated_cost_max = 5220.
"""
    
    if persona == 'novice':
        return f"For a first-time homeowner who knows little about home maintenance, use simple language. {base}"
    elif persona == 'diy':
        return f"For a DIY enthusiast who wants to know what they can fix themselves vs hire pros. {base}"
    elif persona == 'technical':
        return f"For a professional or experienced homeowner who wants technical details. {base}"
    else:  # executive
        return f"Create a concise executive summary for quick decision-making. {base}"


def generate_action_plans(report_id: str, household_id: str, findings: List[Dict]) -> None:
    """Generate time-stratified action plans using Claude"""
    import urllib.request
    import urllib.error
    import uuid
    
    print(f"[ACTION-PLANS] Generating action plans for report {report_id}")
    
    if not findings:
        print("[ACTION-PLANS] No findings to create action plans from")
        return
    
    findings_json = json.dumps(findings, indent=2)
    
    prompt = f"""Based on these home inspection findings, create prioritized action plans organized by timeframe.

FINDINGS:
{findings_json}

Create action plans for these timeframes:
- 0-30_days: Urgent issues requiring immediate attention
- 3-6_months: Important items to address soon
- 1_year: Items to plan for this year
- 2-5_years: Medium-term maintenance
- 5-10_years: Long-term planning

Return JSON:
{{
  "action_plans": [
    {{
      "timeframe": "0-30_days",
      "items": [
        {{
          "priority": "critical" | "high" | "medium" | "low",
          "title": "Action item title",
          "description": "What needs to be done",
          "estimated_cost_min": 0,
          "estimated_cost_max": 0
        }}
      ]
    }}
  ]
}}
"""
    
    try:
        response = anthropic_client.messages.create(
            model=os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-5-20250929'),
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}]
        )
        
        result_text = response.content[0].text if response.content else '{}'
        
        # Parse JSON from response
        try:
            import re
            json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', result_text)
            if json_match:
                plans_data = json.loads(json_match.group(1).strip())
            else:
                plans_data = json.loads(result_text)
        except json.JSONDecodeError:
            print("[ACTION-PLANS] Failed to parse action plans JSON")
            return
        
        action_plans = plans_data.get('action_plans', [])
        
        url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
        
        for plan in action_plans:
            plan_id = str(uuid.uuid4())
            timeframe = plan.get('timeframe', 'unknown').replace("'", "''")
            
            # Insert action plan
            sql = f"""INSERT INTO action_plans (
                id, report_id, timeframe, generated_at, ai_model_version, 
                prompt_version, created_at, updated_at
            ) VALUES (
                '{plan_id}', '{report_id}', '{timeframe}', datetime('now'),
                'claude-sonnet-4-5-20250929', 'v1', datetime('now'), datetime('now')
            )"""
            
            payload = json.dumps({"sql": sql}).encode('utf-8')
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
            req.add_header('Content-Type', 'application/json')
            
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    print(f"[ACTION-PLANS] Created plan for timeframe: {timeframe}")
            except Exception as e:
                print(f"[ACTION-PLANS] Error creating plan {timeframe}: {e}")
                continue
            
            # Insert action items
            items = plan.get('items', [])
            for i, item in enumerate(items):
                item_id = str(uuid.uuid4())
                priority = item.get('priority', 'medium').replace("'", "''")
                title = item.get('title', '').replace("'", "''")
                description = item.get('description', '').replace("'", "''")
                cost_min = item.get('estimated_cost_min', 0) or 0
                cost_max = item.get('estimated_cost_max', 0) or 0
                
                item_sql = f"""INSERT INTO action_items (
                    id, action_plan_id, household_id, priority, title, description,
                    estimated_cost_min, estimated_cost_max, status, sort_order,
                    created_at, updated_at
                ) VALUES (
                    '{item_id}', '{plan_id}', '{household_id}', '{priority}',
                    '{title}', '{description}', {cost_min}, {cost_max},
                    'pending', {i}, datetime('now'), datetime('now')
                )"""
                
                payload = json.dumps({"sql": item_sql}).encode('utf-8')
                req = urllib.request.Request(url, data=payload, method='POST')
                req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
                req.add_header('Content-Type', 'application/json')
                
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        pass
                except Exception as e:
                    print(f"[ACTION-PLANS] Error creating item: {e}")
            
            print(f"[ACTION-PLANS] Created {len(items)} items for {timeframe}")
                
    except Exception as e:
        print(f"[ACTION-PLANS] Error generating action plans: {e}")


def generate_task_drafts(report_id: str, household_id: str, findings: List[Dict]) -> Dict[str, Any]:
    """Generate task drafts from findings using Claude"""
    import urllib.request
    import urllib.error
    import uuid
    
    print(f"[TASK-DRAFTS] Generating task drafts for report {report_id}")
    
    result = {'total_drafts': 0, 'critical_count': 0, 'major_count': 0}
    
    if not findings:
        print("[TASK-DRAFTS] No findings to create task drafts from")
        return result
    
    findings_json = json.dumps(findings, indent=2)
    
    system_prompt = """You are a home maintenance expert helping homeowners understand and act on inspection report findings. Your task is to convert technical inspection findings into clear, actionable task drafts.

## YOUR ROLE
- Transform each finding into actionable maintenance tasks
- Provide accurate cost estimates (be conservative, err on higher side)
- Assess DIY feasibility honestly (safety first)
- Suggest appropriate timeframes based on severity

## COST ESTIMATION GUIDELINES
- Use current market rates for North American contractors
- Include labor AND materials in professional estimates
- DIY estimates should include materials only
- Provide ranges, not single numbers

## DIY ASSESSMENT CRITERIA
Professional Only (diy_possible: false, diy_difficulty: "professional_only"):
- Electrical panel work, Gas line work, Structural repairs, Roof replacement, Foundation repairs

Hard DIY (diy_possible: true, diy_difficulty: "hard"):
- Minor electrical, Plumbing fixture replacement, Drywall repair, Deck repair

Medium DIY (diy_possible: true, diy_difficulty: "medium"):
- Caulking, Painting, Gutter cleaning, Minor plumbing, Weatherstripping

Easy DIY (diy_possible: true, diy_difficulty: "easy"):
- Filter replacements, Smoke detector batteries, Basic cleaning"""

    user_prompt = f"""Generate task drafts from these inspection findings. For each finding, create ONE task draft.

FINDINGS TO PROCESS:
{findings_json}

FOR EACH FINDING, GENERATE:
1. title: Clear, action-oriented task name (max 100 chars)
2. description: Detailed explanation of what needs to be done
3. plain_language_summary: Explain to a first-time homeowner why this matters
4. priority_score (1-100): Safety hazard +50, Structural impact +30, Will worsen if delayed +20
5. suggested_timeframe: "0-30_days" | "3-6_months" | "1_year" | "2-5_years" | "5-10_years"
6. suggested_frequency: "one_time" | "monthly" | "quarterly" | "yearly"
7. is_recurring_suggestion: true if this finding suggests an ongoing maintenance need
8. Cost Estimates (in cents, e.g., $150 = 15000):
   - estimated_cost_min, estimated_cost_max (professional)
   - diy_cost_min, diy_cost_max (materials only)
9. DIY Assessment: diy_possible (bool), diy_difficulty
10. Evidence: source_page_numbers (array), source_quotes (array of key quotes)

RESPONSE FORMAT:
{{
  "task_drafts": [
    {{
      "finding_id": "ID of the finding",
      "title": "Action-oriented title",
      "description": "Detailed description",
      "plain_language_summary": "Why this matters",
      "system_category": "Same as finding category",
      "severity": "Same as finding severity",
      "priority_score": 1-100,
      "suggested_timeframe": "0-30_days",
      "suggested_frequency": "one_time",
      "is_recurring_suggestion": false,
      "estimated_cost_min": number,
      "estimated_cost_max": number,
      "diy_possible": true,
      "diy_difficulty": "medium",
      "diy_cost_min": number or null,
      "diy_cost_max": number or null,
      "source_page_numbers": [1, 2],
      "source_quotes": ["Direct quotes"]
    }}
  ],
  "summary": {{
    "total_tasks": number,
    "critical_count": number,
    "major_count": number
  }}
}}"""
    
    try:
        response = anthropic_client.messages.create(
            model=os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-5-20250929'),
            max_tokens=8192,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}]
        )
        
        result_text = response.content[0].text if response.content else '{}'
        
        # Parse JSON from response
        try:
            import re
            json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', result_text)
            if json_match:
                drafts_data = json.loads(json_match.group(1).strip())
            else:
                drafts_data = json.loads(result_text)
        except json.JSONDecodeError:
            print("[TASK-DRAFTS] Failed to parse task drafts JSON")
            return result
        
        task_drafts = drafts_data.get('task_drafts', [])
        summary = drafts_data.get('summary', {})
        
        url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
        
        for draft in task_drafts:
            draft_id = str(uuid.uuid4())
            finding_id = draft.get('finding_id', '').replace("'", "''")
            title = draft.get('title', '').replace("'", "''")
            description = draft.get('description', '').replace("'", "''")
            plain_language = draft.get('plain_language_summary', '').replace("'", "''")
            system_category = draft.get('system_category', 'general').replace("'", "''")
            severity = draft.get('severity', 'minor').replace("'", "''")
            priority_score = draft.get('priority_score', 50)
            timeframe = draft.get('suggested_timeframe', '1_year').replace("'", "''")
            frequency = draft.get('suggested_frequency', 'one_time').replace("'", "''")
            is_recurring = 1 if draft.get('is_recurring_suggestion', False) else 0
            cost_min = draft.get('estimated_cost_min', 0) or 0
            cost_max = draft.get('estimated_cost_max', 0) or 0
            diy_possible = 1 if draft.get('diy_possible', True) else 0
            diy_difficulty = draft.get('diy_difficulty', 'medium').replace("'", "''")
            diy_cost_min = draft.get('diy_cost_min') or 'NULL'
            diy_cost_max = draft.get('diy_cost_max') or 'NULL'
            source_pages = json.dumps(draft.get('source_page_numbers', [])).replace("'", "''")
            source_quotes = json.dumps(draft.get('source_quotes', [])).replace("'", "''")
            
            # Build SQL with proper NULL handling
            diy_cost_min_sql = 'NULL' if diy_cost_min == 'NULL' else diy_cost_min
            diy_cost_max_sql = 'NULL' if diy_cost_max == 'NULL' else diy_cost_max

            # Get images for this finding
            image_ids_list = get_image_ids_for_finding(finding_id, report_id) if finding_id else []
            image_ids_json = json.dumps(image_ids_list).replace("'", "''")

            sql = f"""INSERT INTO task_drafts (
                id, report_id, household_id, finding_id, title, description,
                plain_language_summary, system_category, severity, priority_score,
                suggested_timeframe, suggested_frequency, is_recurring_suggestion,
                estimated_cost_min, estimated_cost_max, diy_possible, diy_difficulty,
                diy_cost_min, diy_cost_max, source_page_numbers, source_quotes,
                image_ids,
                status, generated_at, ai_model_version, created_at, updated_at
            ) VALUES (
                '{draft_id}', '{report_id}', '{household_id}', '{finding_id}', '{title}', '{description}',
                '{plain_language}', '{system_category}', '{severity}', {priority_score},
                '{timeframe}', '{frequency}', {is_recurring},
                {cost_min}, {cost_max}, {diy_possible}, '{diy_difficulty}',
                {diy_cost_min_sql}, {diy_cost_max_sql}, '{source_pages}', '{source_quotes}',
                '{image_ids_json}',
                'pending', datetime('now'), 'claude-sonnet-4-5-20250929', datetime('now'), datetime('now')
            )"""
            
            payload = json.dumps({"sql": sql}).encode('utf-8')
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
            req.add_header('Content-Type', 'application/json')
            
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    pass
            except Exception as e:
                print(f"[TASK-DRAFTS] Error creating draft: {e}")
        
        result['total_drafts'] = len(task_drafts)
        result['critical_count'] = summary.get('critical_count', 0)
        result['major_count'] = summary.get('major_count', 0)
        
        print(f"[TASK-DRAFTS] Created {len(task_drafts)} task drafts for report {report_id}")
                
    except Exception as e:
        print(f"[TASK-DRAFTS] Error generating task drafts: {e}")
    
    return result


def extract_home_features(report_id: str, household_id: str, findings: List[Dict]) -> Dict[str, Any]:
    """Extract home features from findings and generate maintenance suggestions using Claude"""
    import urllib.request
    import urllib.error
    import uuid
    
    print(f"[HOME-FEATURES] Extracting home features for report {report_id}")
    
    result = {'features_extracted': 0, 'suggestions_generated': 0}
    
    if not findings:
        print("[HOME-FEATURES] No findings to extract features from")
        return result
    
    # Convert findings to text for extraction
    findings_text = "\n".join([f"{f.get('title', '')}: {f.get('description', '')}" for f in findings])
    
    system_prompt = """You are an expert at identifying home features from inspection reports. Your task is to extract all features that require ongoing maintenance.

## YOUR ROLE
- Identify all significant home features from the report
- Extract details like type, brand, model, age when available
- Note the condition of each feature
- Count multiples (e.g., "2 wood-burning fireplaces")

## FEATURE TYPES TO LOOK FOR
HVAC: central_ac, furnace, heat_pump, boiler, mini_split
Water: water_heater, tankless_water_heater, well, septic, sump_pump
Heating: fireplace, wood_stove, pellet_stove
Outdoor: pool, hot_tub, irrigation_system
Structure: roof, foundation, basement, deck, garage
Safety: smoke_detector, co_detector, fire_extinguisher
Appliances: refrigerator, dishwasher, washing_machine, dryer, range"""

    user_prompt = f"""Extract all home features from this inspection report content.

REPORT CONTENT:
{findings_text}

FOR EACH FEATURE, EXTRACT:
1. feature_type: Primary category
2. feature_subtype: Specific type (e.g., "wood_burning", "central_ac")
3. quantity: How many (default 1)
4. location: Where in the home
5. brand: Manufacturer if mentioned
6. model: Model number if visible
7. age_years: Approximate age if mentioned
8. condition: "excellent" | "good" | "fair" | "poor" | "unknown"
9. notes: Any relevant details
10. extraction_confidence: 0.0-1.0

RESPONSE FORMAT:
{{
  "home_features": [
    {{
      "feature_type": "fireplace",
      "feature_subtype": "wood_burning",
      "quantity": 2,
      "location": "living room",
      "brand": null,
      "model": null,
      "age_years": null,
      "condition": "good",
      "notes": "Masonry chimneys",
      "extraction_confidence": 0.95
    }}
  ],
  "extraction_summary": {{
    "total_features": number,
    "high_confidence_features": number
  }}
}}"""
    
    try:
        response = anthropic_client.messages.create(
            model=os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-5-20250929'),
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}]
        )
        
        result_text = response.content[0].text if response.content else '{}'
        
        # Parse JSON from response
        try:
            import re
            json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', result_text)
            if json_match:
                features_data = json.loads(json_match.group(1).strip())
            else:
                features_data = json.loads(result_text)
        except json.JSONDecodeError:
            print("[HOME-FEATURES] Failed to parse features JSON")
            return result
        
        home_features = features_data.get('home_features', [])
        
        url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
        
        features_stored = 0
        for feature in home_features:
            # Only store features with reasonable confidence
            confidence = feature.get('extraction_confidence', 0.5)
            if confidence < 0.5:
                continue
            
            feature_id = str(uuid.uuid4())
            feature_type = feature.get('feature_type', '').replace("'", "''")
            feature_subtype = feature.get('feature_subtype', '').replace("'", "''") or 'NULL'
            quantity = feature.get('quantity', 1) or 1
            location = feature.get('location', '').replace("'", "''") if feature.get('location') else 'NULL'
            brand = feature.get('brand', '').replace("'", "''") if feature.get('brand') else 'NULL'
            model = feature.get('model', '').replace("'", "''") if feature.get('model') else 'NULL'
            age_years = feature.get('age_years')
            condition = feature.get('condition', 'unknown').replace("'", "''")
            notes = feature.get('notes', '').replace("'", "''") if feature.get('notes') else 'NULL'

            # Build SQL with proper NULL handling
            subtype_sql = 'NULL' if feature_subtype == 'NULL' else f"'{feature_subtype}'"
            location_sql = 'NULL' if location == 'NULL' else f"'{location}'"
            brand_sql = 'NULL' if brand == 'NULL' else f"'{brand}'"
            model_sql = 'NULL' if model == 'NULL' else f"'{model}'"
            age_years_sql = 'NULL' if age_years is None else age_years
            notes_sql = 'NULL' if notes == 'NULL' else f"'{notes}'"
            
            sql = f"""INSERT INTO home_features (
                id, household_id, feature_type, feature_subtype, quantity,
                location, brand, model, age_years, condition, notes,
                source, source_report_id, extraction_confidence, created_at, updated_at
            ) VALUES (
                '{feature_id}', '{household_id}', '{feature_type}', {subtype_sql}, {quantity},
                {location_sql}, {brand_sql}, {model_sql}, {age_years_sql}, '{condition}', {notes_sql},
                'report_extraction', '{report_id}', {confidence}, datetime('now'), datetime('now')
            )"""
            
            payload = json.dumps({"sql": sql}).encode('utf-8')
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
            req.add_header('Content-Type', 'application/json')
            
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    features_stored += 1
            except Exception as e:
                print(f"[HOME-FEATURES] Error storing feature: {e}")
        
        result['features_extracted'] = features_stored
        
        # Generate maintenance suggestions for the extracted features
        # This would require matching features to templates - simplified for now
        print(f"[HOME-FEATURES] Stored {features_stored} home features for household {household_id}")
                
    except Exception as e:
        print(f"[HOME-FEATURES] Error extracting home features: {e}")
    
    return result


def send_completion_notifications(report_id: str, household_id: str, findings: List[Dict], 
                                   total_drafts: int, critical_drafts: int, suggestions_generated: int) -> None:
    """Send completion notifications via the API"""
    import urllib.request
    import urllib.error
    
    print(f"[NOTIFICATIONS] Sending notifications for report {report_id}")
    
    # Get the report to find the uploader
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
    
    try:
        # Get report details
        sql = f"SELECT uploaded_by, filename FROM reports WHERE id = '{report_id}'"
        payload = json.dumps({"sql": sql}).encode('utf-8')
        req = urllib.request.Request(url, data=payload, method='POST')
        req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
        req.add_header('Content-Type', 'application/json')
        
        with urllib.request.urlopen(req, timeout=30) as resp:
            response_data = json.loads(resp.read().decode('utf-8'))
            results = response_data.get('result', [{}])[0].get('results', [])
            if not results:
                print("[NOTIFICATIONS] Could not find report")
                return
            report = results[0]
        
        user_id = report.get('uploaded_by', '')
        filename = report.get('filename', 'Inspection Report')
        
        critical_count = sum(1 for f in findings if f.get('severity') == 'critical')
        
        # Send task drafts ready notification if we have drafts
        if total_drafts > 0:
            notification_id = str(__import__('uuid').uuid4())
            
            if critical_drafts > 0:
                title = f"Critical Issues Found"
                body = f"{critical_drafts} critical issue{'s' if critical_drafts > 1 else ''} need{'s' if critical_drafts == 1 else ''} immediate attention from your inspection report. {total_drafts} total task{'s' if total_drafts > 1 else ''} created."
                notification_type = 'critical_drafts'
            else:
                title = "Task Drafts Ready"
                body = f"{total_drafts} task draft{'s' if total_drafts > 1 else ''} created from your inspection report \"{filename}\". Review and add them to your maintenance schedule."
                notification_type = 'task_drafts_ready'
            
            data = json.dumps({
                'reportId': report_id,
                'householdId': household_id,
                'screen': 'TaskDrafts',
                'draftsCount': total_drafts,
                'criticalCount': critical_drafts
            }).replace("'", "''")
            
            sql = f"""INSERT INTO notifications (
                id, user_id, type, title, body, data, read, 
                created_at, updated_at
            ) VALUES (
                '{notification_id}', '{user_id}', '{notification_type}', '{title.replace("'", "''")}', 
                '{body.replace("'", "''")}', '{data}', 0, datetime('now'), datetime('now')
            )"""
            
            payload = json.dumps({"sql": sql}).encode('utf-8')
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
            req.add_header('Content-Type', 'application/json')
            
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    print(f"[NOTIFICATIONS] Sent {notification_type} notification")
            except Exception as e:
                print(f"[NOTIFICATIONS] Error sending notification: {e}")
        
        # Send maintenance suggestions notification if we have suggestions
        if suggestions_generated > 0:
            notification_id = str(__import__('uuid').uuid4())
            title = "Maintenance Suggestions Available"
            body = f"{suggestions_generated} maintenance suggestion{'s' if suggestions_generated > 1 else ''} created based on your home features. Set up recurring maintenance to keep your home in top shape."
            
            data = json.dumps({
                'householdId': household_id,
                'screen': 'MaintenanceSetup',
                'suggestionsCount': suggestions_generated
            }).replace("'", "''")
            
            sql = f"""INSERT INTO notifications (
                id, user_id, type, title, body, data, read,
                created_at, updated_at
            ) VALUES (
                '{notification_id}', '{user_id}', 'maintenance_suggestions', '{title.replace("'", "''")}',
                '{body.replace("'", "''")}', '{data}', 0, datetime('now'), datetime('now')
            )"""
            
            payload = json.dumps({"sql": sql}).encode('utf-8')
            req = urllib.request.Request(url, data=payload, method='POST')
            req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
            req.add_header('Content-Type', 'application/json')
            
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    print(f"[NOTIFICATIONS] Sent maintenance_suggestions notification")
            except Exception as e:
                print(f"[NOTIFICATIONS] Error sending notification: {e}")
                
    except Exception as e:
        print(f"[NOTIFICATIONS] Error in notification process: {e}")


def update_job_status(job_id: str, status: str, stage: str, progress: int, error: str = None) -> None:
    """Update processing job status in D1"""
    # TODO: Implement D1 API call
    print(f"Job {job_id}: {status} - {stage} ({progress}%)")


def update_report_status(report_id: str, status: str, fields: Dict[str, Any]) -> None:
    """Update report status in D1 via Cloudflare API"""
    import urllib.request
    import urllib.error
    
    print(f"[D1-UPDATE] Updating report {report_id} to status: {status}")
    print(f"[D1-UPDATE] Fields: {fields}")
    
    # Build SET clause for SQL update
    set_parts = [f"status = '{status}'", f"updated_at = datetime('now')"]
    for key, value in fields.items():
        if value is None:
            set_parts.append(f"{key} = NULL")
        elif isinstance(value, (int, float)):
            set_parts.append(f"{key} = {value}")
        elif isinstance(value, str):
            # Escape single quotes in strings
            escaped_value = value.replace("'", "''")
            set_parts.append(f"{key} = '{escaped_value}'")
        else:
            escaped_value = str(value).replace("'", "''")
            set_parts.append(f"{key} = '{escaped_value}'")
    
    set_clause = ", ".join(set_parts)
    sql = f"UPDATE reports SET {set_clause} WHERE id = '{report_id}'"
    print(f"[D1-UPDATE] SQL: {sql}")
    
    # Call Cloudflare D1 API
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{CLOUDFLARE_DATABASE_ID}/query"
    
    payload = json.dumps({"sql": sql}).encode('utf-8')
    
    req = urllib.request.Request(url, data=payload, method='POST')
    req.add_header('Authorization', f'Bearer {CLOUDFLARE_API_TOKEN}')
    req.add_header('Content-Type', 'application/json')
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            print(f"[D1-UPDATE] Success: {result}")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else 'No response body'
        print(f"[D1-UPDATE] HTTP Error {e.code}: {error_body}")
        raise
    except Exception as e:
        print(f"[D1-UPDATE] Error: {e}")
        raise


def get_timestamp() -> str:
    """Get current timestamp in ISO format"""
    from datetime import datetime
    return datetime.utcnow().isoformat() + 'Z'
