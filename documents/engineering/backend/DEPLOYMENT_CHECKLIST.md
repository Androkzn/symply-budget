# Image Extraction Feature - Deployment Checklist

## Pre-Deployment Verification

- [x] ✅ Code implementation complete in [handler.py](../lambda-processor/handler.py)
- [x] ✅ Dependencies added to [requirements.txt](../lambda-processor/requirements.txt)
- [x] ✅ Deployment scripts ready in `backend/scripts/`
- [x] ✅ CloudShell package prepared (`cloudshell-deploy.tar.gz`)
- [x] ✅ Documentation complete

## Deployment Steps

### 1. Start Deployment Script
- [ ] Navigate to scripts folder: `cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/scripts`
- [ ] Run deployment: `./ONE_COMMAND_DEPLOY.sh`
- [ ] Verify package created: "✅ Package ready: cloudshell-deploy.tar.gz"
- [ ] Verify commands copied: "✅ CloudShell commands copied to clipboard"
- [ ] CloudShell opens in browser automatically

### 2. Build in CloudShell (Manual Step)
- [ ] CloudShell loaded in browser
- [ ] Upload file: Actions → Upload → Select `backend/lambda-processor/cloudshell-deploy.tar.gz`
- [ ] Upload complete (check progress bar)
- [ ] Paste commands: Press `Cmd+V` in CloudShell terminal
- [ ] Build starts automatically
- [ ] Wait for: "✅ Lambda deployed!" (~3 minutes)

### 3. Complete Deployment (Automatic)
- [ ] Return to local terminal where script is waiting
- [ ] Press ENTER to continue
- [ ] Script verifies Lambda deployment
- [ ] Script triggers report reprocessing
- [ ] Wait for: "✅ Image extraction complete!" (~2-5 minutes)

### 4. Verify Results
- [ ] Script displays verification results automatically
- [ ] Check: Total images extracted (expecting 20+)
- [ ] Check: Sample images with AI descriptions
- [ ] Check: Task drafts with populated image_ids
- [ ] Check: Summary statistics displayed

## Post-Deployment Verification

### Check Database
```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend

# Count images extracted
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT COUNT(*) as count FROM report_images WHERE report_id = '28fd554e-b641-45ea-97d3-afe8f0509854'"

# Expected: count = 20+
```

- [ ] Images found in database
- [ ] Count matches expectations (20+)

### Check R2 Storage
```bash
# List images in R2
npx wrangler r2 object list simple-house-reports \
  --prefix "reports/28fd554e-b641-45ea-97d3-afe8f0509854/images/" \
  --env production

# Expected: 20+ image files
```

- [ ] Original images in R2
- [ ] Thumbnails in R2

### Check AI Descriptions
```bash
# View sample with descriptions
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT page_number, system_category, ai_description FROM report_images WHERE report_id = '28fd554e-b641-45ea-97d3-afe8f0509854' LIMIT 3"

# Expected: Images with descriptions and categories
```

- [ ] Images have AI descriptions
- [ ] System categories assigned
- [ ] Confidence scores present

### Check Task Draft Linking
```bash
# Check task drafts with images
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT id, title, image_ids FROM task_drafts WHERE report_id = '28fd554e-b641-45ea-97d3-afe8f0509854' AND image_ids IS NOT NULL AND image_ids != '[]' LIMIT 3"

# Expected: Task drafts with image_ids arrays
```

- [ ] Task drafts have image_ids populated
- [ ] Image_ids are valid JSON arrays
- [ ] Image IDs match images in report_images table

### Check Report Status
```bash
# Check report metadata
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT id, status, metadata FROM inspection_reports WHERE id = '28fd554e-b641-45ea-97d3-afe8f0509854'"

# Expected: status = 'completed', metadata includes image_count
```

- [ ] Report status is "completed"
- [ ] Report metadata includes image_count
- [ ] Image count matches extracted images

## Frontend Verification

### Mobile App Testing
- [ ] Open task draft with linked images
- [ ] Thumbnail loads quickly
- [ ] Tap to view full-size image
- [ ] Image description displays
- [ ] Multiple images scroll properly
- [ ] Images match finding content

## Troubleshooting

### Issue: No images extracted
**Check:**
```bash
# View Lambda logs
aws logs tail /aws/lambda/inspection-report-processor --follow --region us-east-1
```

**Look for:**
- `[IMAGE-EXTRACT]` log entries
- `[R2-UPLOAD]` log entries
- `[D1-IMAGES]` log entries
- Any error messages

**Possible causes:**
- [ ] PyMuPDF not installed correctly (check build logs)
- [ ] R2 permissions issue (check IAM policy)
- [ ] D1 database error (check Cloudflare dashboard)

### Issue: CloudShell build fails
**Solutions:**
- [ ] Verify tar.gz uploaded correctly
- [ ] Check CloudShell has space: `df -h`
- [ ] Try pasting commands again
- [ ] Check for typos in commands

### Issue: Images found but no AI descriptions
**Check:**
```bash
# Check if vision analysis ran
aws logs tail /aws/lambda/inspection-report-processor --region us-east-1 | grep VISION
```

**Possible causes:**
- [ ] Claude API key not configured
- [ ] Vision analysis timeout (normal for >20 images)
- [ ] Rate limit reached

### Issue: Task drafts missing image_ids
**Check:**
```bash
# Verify images linked to findings
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT finding_id, COUNT(*) FROM report_images WHERE report_id = '28fd554e-b641-45ea-97d3-afe8f0509854' AND finding_id IS NOT NULL GROUP BY finding_id"
```

**Reprocess if needed:**
```bash
cd /Users/andreitekhtelev/Desktop/SimpleHouseApp/backend/scripts
./reprocess-report.sh
```

## Performance Validation

- [ ] Lambda execution time < 15 minutes
- [ ] Image extraction time < 3 minutes
- [ ] R2 upload time < 2 minutes
- [ ] Vision analysis time < 5 minutes
- [ ] Total processing time < 10 minutes

## Rollback Plan

**If issues occur:**

1. **Quick disable:**
   ```bash
   # Set Lambda environment variable
   aws lambda update-function-configuration \
     --function-name inspection-report-processor \
     --environment Variables={ENABLE_IMAGE_EXTRACTION=false} \
     --region us-east-1
   ```
   - [ ] Feature disabled
   - [ ] Pipeline continues without images

2. **Revert code:**
   - [ ] Deploy previous Lambda version
   - [ ] Restore old handler.py
   - [ ] Remove PyMuPDF and Pillow from requirements

## Sign-Off

### Implementation Team
- [x] Code reviewed
- [x] Tests written
- [x] Documentation complete
- [x] Scripts validated

### Deployment Team
- [ ] Deployment successful
- [ ] Verification passed
- [ ] Performance acceptable
- [ ] No errors in logs

### Product Team
- [ ] Feature working in app
- [ ] Images display correctly
- [ ] User experience acceptable
- [ ] Ready for production use

---

## Status: Ready for Deployment

**Next Action:** Run `./ONE_COMMAND_DEPLOY.sh` from `backend/scripts/` folder

**Estimated Time:** 6-9 minutes total

**Risk Level:** Low (graceful error handling, no breaking changes)

**Rollback Time:** < 2 minutes (environment variable change)
