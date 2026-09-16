# Lambda Image Extraction - Deployment Scripts

This folder contains reusable scripts for deploying and testing the Lambda image extraction feature.

## 🚀 Quick Start

**Run the one-command deployment:**
```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/scripts
./ONE_COMMAND_DEPLOY.sh
```

**Important:** All scripts must be run from the `backend/scripts/` directory.

This will:
1. Prepare the deployment package
2. Open CloudShell and copy commands  
3. After you paste in CloudShell, it automatically reprocesses & tests
4. Shows complete verification results

## 📜 Available Scripts

### Main Deployment
- **ONE_COMMAND_DEPLOY.sh** - Semi-automated deployment (1 manual step in CloudShell)
- **auto-deploy-complete.sh** - Fully automated (requires EC2 permissions)

### Testing & Verification  
- **reprocess-report.sh** - Reprocess report with new Lambda code
- **test-image-extraction.sh** - Verify images extracted and linked
- **DEPLOYMENT_GUIDE.md** - Complete deployment documentation

## 📋 What Each Script Does

### ONE_COMMAND_DEPLOY.sh
```bash
./ONE_COMMAND_DEPLOY.sh
```
- ✅ Prepares deployment package
- ✅ Opens CloudShell and copies commands  
- ⏸️  **Manual step:** Paste commands in CloudShell
- ✅ Automatically reprocesses report
- ✅ Verifies and displays results

**Best for:** Manual deployments with minimal steps

---

### auto-deploy-complete.sh
```bash
./auto-deploy-complete.sh
```
- Fully automated (no manual steps)
- Creates EC2 instance to build on Linux
- Builds, deploys, reprocesses, and tests
- **Requires:** EC2/SSM permissions

**Best for:** Automated CI/CD pipelines

---

### reprocess-report.sh
```bash
./reprocess-report.sh
```
- Cleans existing data for test report
- Triggers Lambda processing
- Monitors progress

**Use when:** Testing after Lambda code changes

---

### test-image-extraction.sh
```bash
./test-image-extraction.sh
```
- Queries database for extracted images
- Shows AI descriptions & categories
- Lists task drafts with linked images
- Displays summary statistics

**Use when:** Verifying extraction results

---

## 🔧 Configuration

Scripts use these defaults:
- **Report ID:** `28fd554e-b641-45ea-97d3-afe8f0509854` (Electrical report.pdf)
- **Lambda:** `inspection-report-processor`
- **Region:** `us-east-1`
- **Database:** `simple-house-db` (production)

To use with different reports, edit the REPORT_ID variable in each script.

## 📊 Expected Results

After successful deployment:
- ✅ 20+ images extracted from test report
- ✅ Images stored in R2 with thumbnails  
- ✅ AI descriptions from Claude Vision
- ✅ Task drafts have image_ids populated
- ✅ Report status includes image_count

## 🆘 Troubleshooting

**Lambda Import Error:**
- Must build on Linux (CloudShell required)
- PyMuPDF & Pillow need native binaries

**Permission Errors:**
- ONE_COMMAND_DEPLOY.sh: Only needs Lambda update permission
- auto-deploy-complete.sh: Requires EC2/SSM permissions

**No Images Found:**
- Check Lambda logs: `aws logs tail /aws/lambda/inspection-report-processor --follow`
- Verify PyMuPDF installed correctly
- Check R2 bucket permissions

## 📝 Notes

- Scripts are idempotent (safe to re-run)
- CloudShell build takes ~3 minutes
- Lambda processing takes ~2-5 minutes  
- Total deployment time: ~5-10 minutes

---

**Location:** `/Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/scripts/`
**Last Updated:** January 27, 2026
