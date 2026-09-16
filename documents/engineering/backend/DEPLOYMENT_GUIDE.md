# 🚀 Lambda Image Extraction - Complete Deployment Guide

## ✅ What's Ready

All image extraction code is implemented:
- ✅ PyMuPDF & Pillow for image extraction
- ✅ R2 storage integration for images & thumbnails
- ✅ Claude Vision API for image analysis
- ✅ Database storage with finding associations
- ✅ Task drafts linking with image_ids

## 📦 Files Prepared

1. **cloudshell-deploy.tar.gz** - Package for AWS CloudShell build
2. **cloudshell-commands.txt** - Commands to run in CloudShell
3. **reprocess-report.sh** - Trigger Lambda with existing report
4. **test-image-extraction.sh** - Verify images extracted

## 🎯 Deployment Steps

### Step 1: Deploy to Lambda (via CloudShell)

**Open CloudShell:**
```
https://us-east-1.console.aws.amazon.com/cloudshell/home?region=us-east-1
```

**Upload File:**
- Click **Actions** → **Upload file**
- Select: `cloudshell-deploy.tar.gz`

**Run Commands:**
```bash
# Extract
tar -xzf cloudshell-deploy.tar.gz

# Build
mkdir -p package
pip3 install --target package/ -r requirements.txt
cp handler.py package/
cd package && zip -r ../lambda-function.zip . && cd ..

# Deploy
aws lambda update-function-code \
  --function-name inspection-report-processor \
  --zip-file fileb://lambda-function.zip \
  --region us-east-1

# Verify
aws lambda get-function \
  --function-name inspection-report-processor \
  --region us-east-1 \
  --query 'Configuration.[LastUpdateStatus,State]' \
  --output table
```

### Step 2: Reprocess Report with Image Extraction

**Run locally:**
```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend
bash reprocess-report.sh
```

This will:
- Clean existing data for the test report
- Trigger Lambda processing with the new code
- Extract 20+ images from Electrical report.pdf
- Analyze images with Claude Vision
- Link images to task drafts

**Monitor Progress:**
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

### Step 3: Verify Image Extraction

**Run test script:**
```bash
bash test-image-extraction.sh
```

**Expected Results:**
- ✅ 20+ images extracted
- ✅ Images have AI descriptions & system categories
- ✅ Task drafts have image_ids populated
- ✅ Images uploaded to R2 storage

## 📊 What Gets Extracted

For each image:
- **Original** → `reports/{reportId}/images/{imageId}.{ext}`
- **Thumbnail** → `reports/{reportId}/thumbnails/{imageId}.jpg`
- **Metadata:**
  - Page number
  - Dimensions (width/height)
  - System category (electrical, plumbing, etc.)
  - AI description (from Claude Vision)
  - Image type (photo, diagram, chart)
  - Linked finding IDs

## 🔍 Database Tables

**report_images:**
- Stores all extracted images with metadata
- Links to findings via `finding_id` and `finding_ids`
- Tracks extraction method and confidence

**task_drafts:**
- Now includes `image_ids` field (JSON array)
- Automatically populated during generation
- Links to images via report_images.id

## 🎉 Success Criteria

After deployment and reprocessing:
1. ✅ Lambda deploys successfully (no import errors)
2. ✅ 20+ images extracted from test report
3. ✅ Images stored in R2 with thumbnails
4. ✅ Images have AI-generated descriptions
5. ✅ Task drafts show linked image_ids
6. ✅ Report status includes image_count

## 🆘 Troubleshooting

**Lambda Import Error:**
- Must build on Linux (CloudShell required)
- PyMuPDF & Pillow need native Linux binaries

**No Images Extracted:**
- Check Lambda logs for errors
- Verify PyMuPDF installed correctly
- Check R2 bucket permissions

**Images Not Linked to Drafts:**
- Verify findings have page numbers
- Check image_ids field in task_drafts
- Run vision analysis step completed

---

**Current Status:** ✅ Ready for deployment
**Files Location:** `/Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/lambda-processor/`
**Next Step:** Deploy via CloudShell → Reprocess → Test
