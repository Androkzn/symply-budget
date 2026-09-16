# Image Extraction Feature - Documentation Index

## 🚀 Start Here

**New to this feature?** Start with [QUICK_START.md](QUICK_START.md)

**Ready to deploy?** Run from this folder:
```bash
./ONE_COMMAND_DEPLOY.sh
```

## 📚 Documentation Files

### Getting Started
- **[QUICK_START.md](QUICK_START.md)** - 3-step deployment guide (fastest path)
- **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** - Complete deployment checklist with verification steps
- **[README.md](README.md)** - Overview of all scripts and their usage

### Technical Reference
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Complete implementation details
  - 8 functions added to handler.py
  - Database schema
  - Performance characteristics
  - Error handling strategy

- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Detailed deployment documentation
  - CloudShell instructions
  - Troubleshooting guide
  - Manual deployment steps

### Scripts
- **[ONE_COMMAND_DEPLOY.sh](ONE_COMMAND_DEPLOY.sh)** - Semi-automated deployment (recommended)
- **[auto-deploy-complete.sh](auto-deploy-complete.sh)** - Fully automated (requires EC2 permissions)
- **[reprocess-report.sh](reprocess-report.sh)** - Reprocess test report
- **[test-image-extraction.sh](test-image-extraction.sh)** - Verify extraction results

## 📖 Documentation Structure

```
backend/scripts/
├── INDEX.md                        ← You are here
├── QUICK_START.md                  ← Start here for deployment
├── DEPLOYMENT_CHECKLIST.md         ← Step-by-step checklist
├── IMPLEMENTATION_SUMMARY.md       ← Technical details
├── DEPLOYMENT_GUIDE.md             ← Detailed instructions
├── README.md                       ← Scripts overview
├── ONE_COMMAND_DEPLOY.sh          ← Main deployment script
├── auto-deploy-complete.sh        ← Alternative deployment
├── reprocess-report.sh            ← Reprocess utility
└── test-image-extraction.sh       ← Testing utility
```

## 🎯 Quick Links by Task

### I want to deploy the feature
→ [QUICK_START.md](QUICK_START.md)

### I want to understand what was implemented
→ [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)

### I want step-by-step deployment instructions
→ [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)

### I want to troubleshoot an issue
→ [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) (Troubleshooting section)

### I want to test if images are extracted
→ Run `./test-image-extraction.sh`

### I want to reprocess a report
→ Run `./reprocess-report.sh`

### I want to know what each script does
→ [README.md](README.md)

## 🔧 Quick Reference

### Test Report Details
- **Report ID:** `28fd554e-b641-45ea-97d3-afe8f0509854`
- **Household ID:** `b5e4fe57-b3dc-46dc-9c20-98d78bf4407c`
- **File:** Electrical report.pdf
- **Expected Images:** 20+

### Lambda Function
- **Name:** `inspection-report-processor`
- **Region:** `us-east-1`
- **Timeout:** 15 minutes
- **Memory:** 10GB

### Database
- **Name:** `simple-house-db`
- **Environment:** production
- **Tables:** `report_images`, `task_drafts`, `findings`, `inspection_reports`

### R2 Storage
- **Bucket:** `simple-house-reports`
- **Image Path:** `reports/{reportId}/images/{imageId}.{ext}`
- **Thumbnail Path:** `reports/{reportId}/thumbnails/{imageId}.jpg`

## ⚡ Quick Commands

### Deploy Feature
```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/scripts
./ONE_COMMAND_DEPLOY.sh
```

### Verify Deployment
```bash
./test-image-extraction.sh
```

### Reprocess Report
```bash
./reprocess-report.sh
```

### Check Images in Database
```bash
cd ../
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT COUNT(*) as count FROM report_images WHERE report_id = '28fd554e-b641-45ea-97d3-afe8f0509854'"
```

### View Lambda Logs
```bash
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

## 📊 Feature Overview

### What It Does
- Extracts 20+ images from inspection reports
- Generates thumbnails for fast loading
- Analyzes images with Claude Vision AI
- Links images to findings and task drafts
- Stores in R2 with database metadata

### Key Benefits
- Visual evidence for task drafts
- AI-generated image descriptions
- Automatic categorization (electrical, plumbing, etc.)
- Fast loading with thumbnails
- Seamless integration with existing pipeline

### Performance
- Image extraction: ~3 minutes
- Vision analysis: ~3 minutes
- Total added time: ~8 minutes
- Cost: ~$6/month for 2,000 images

## ✅ Implementation Status

- ✅ Code complete ([handler.py](../lambda-processor/handler.py))
- ✅ Dependencies added ([requirements.txt](../lambda-processor/requirements.txt))
- ✅ Scripts ready (this folder)
- ✅ Documentation complete
- ⏳ **Pending:** Lambda deployment

**Status:** Ready for deployment

## 🆘 Need Help?

1. **Quick issues:** Check [README.md](README.md) troubleshooting section
2. **Detailed issues:** See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
3. **Understanding code:** Read [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
4. **Step-by-step help:** Follow [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)

## 📝 Notes

- All scripts must be run from `backend/scripts/` directory
- CloudShell is required for Linux-compatible build
- Test report (Electrical report.pdf) is used for verification
- Feature has graceful error handling (won't break existing pipeline)

---

**Ready to deploy?** → [QUICK_START.md](QUICK_START.md)
