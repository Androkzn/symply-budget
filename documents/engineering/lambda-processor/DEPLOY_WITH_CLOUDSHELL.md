# Deploy Lambda with Image Extraction via AWS CloudShell

## Issue
The Lambda package with image processing libraries (PyMuPDF, Pillow) is too large (50MB+) for direct upload and requires Linux-compiled binaries.

## Solution
Build the package in AWS CloudShell (Linux environment) and deploy.

## Steps

### 1. Open AWS CloudShell
Go to: https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1

### 2. Upload Package
- Click **Actions** → **Upload file**
- Select: `cloudshell-deploy.tar.gz`
- Wait for upload to complete

### 3. Extract and Build (Copy & Paste into CloudShell)

```bash
# Extract files
tar -xzf cloudshell-deploy.tar.gz
mkdir -p lambda-processor
cd lambda-processor
mv ../handler.py ../job_state.py ../structured_logger.py ../batch_processor.py ../requirements.txt .

# Clean previous builds
rm -rf package lambda-function.zip

# Create package directory
mkdir -p package

# Install dependencies (Linux-compatible) - Takes ~3 minutes
echo "Installing dependencies..."
pip3 install --target package/ -r requirements.txt

# Copy all Python modules
cp handler.py job_state.py structured_logger.py batch_processor.py package/

# Create zip package
cd package
zip -r ../lambda-function.zip . > /dev/null
cd ..

# Show package info
ls -lh lambda-function.zip
echo "Build complete!"
```

### 4. Download Package
- Click **Actions** → **Download file**
- Enter: `lambda-processor/lambda-function.zip`
- Save the file

### 5. Deploy Locally (Run on your Mac)

```bash
cd ~/Downloads
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1
```

### 6. Verify Deployment

```bash
# Check Lambda code size (should be ~46MB with image libraries)
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.CodeSize'

# Test with a report
# Image extraction logs should now appear: [IMAGE-EXTRACT], [R2-UPLOAD], [D1-IMAGES]
```

## What This Fixes

✅ Adds Linux-compiled image processing libraries (PyMuPDF, Pillow)
✅ Enables image extraction from PDF reports
✅ Includes all batch processing modules (job_state, structured_logger, batch_processor)
✅ Proper Lambda package size (~46MB vs current 20MB)

## Expected Logs After Deployment

When processing a report with images, you should see:
- `[IMAGE-EXTRACT] Extracted X images`
- `[R2-UPLOAD] Uploaded image {id}`
- `[D1-IMAGES] Stored X image records`
- `[IMAGE-SAFE] No images found` (if PDF has no images)

## Alternative: Deploy Without Image Extraction

If you want to keep the current batch processing but skip image extraction temporarily:

1. Comment out image extraction call in handler.py:
   ```python
   # images = extract_images_from_pdf(pdf_data, start_page, max_images=50)
   images = []  # Temporarily disable
   ```

2. Deploy the smaller package (20MB, no image libraries needed)

This would keep all the batch processing improvements while deferring image extraction.
