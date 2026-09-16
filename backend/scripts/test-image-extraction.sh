#!/bin/bash
set -e

REPORT_ID="28fd554e-b641-45ea-97d3-afe8f0509854"
PROPERTY_ID="b5e4fe57-b3dc-46dc-9c20-98d78bf4407c"

echo "=========================================="
echo "Testing Image Extraction Feature"
echo "=========================================="
echo ""

# Step 1: Check images extracted
echo "1. Checking extracted images..."
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT COUNT(*) as count FROM report_images WHERE report_id = '$REPORT_ID'" \
  2>&1 | grep '"count"' -A 1

# Step 2: Sample images with metadata
echo ""
echo "2. Sample images with AI descriptions..."
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT page_number, image_type, system_category, SUBSTR(ai_description, 1, 50) as description_preview FROM report_images WHERE report_id = '$REPORT_ID' LIMIT 5" \
  2>&1 | grep -A 20 '"page_number"'

# Step 3: Task drafts with images
echo ""
echo "3. Task drafts with linked images..."
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT title, SUBSTR(image_ids, 1, 100) as image_ids FROM task_drafts WHERE report_id = '$REPORT_ID' AND image_ids IS NOT NULL AND image_ids != '[]' LIMIT 5" \
  2>&1 | grep -A 20 '"title"'

# Step 4: Summary
echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
npx wrangler d1 execute simple-house-db --env production --remote \
  --command "SELECT 
    (SELECT COUNT(*) FROM report_images WHERE report_id = '$REPORT_ID') as total_images,
    (SELECT COUNT(*) FROM report_images WHERE report_id = '$REPORT_ID' AND ai_description IS NOT NULL AND ai_description != '') as images_with_ai,
    (SELECT COUNT(*) FROM task_drafts WHERE report_id = '$REPORT_ID' AND image_ids IS NOT NULL AND image_ids != '[]') as drafts_with_images" \
  2>&1 | grep -A 10 '"total_images"'

echo ""
echo "✅ Test complete!"
