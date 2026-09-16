#!/usr/bin/env bash
# End-to-end test: upload the real floor-plan fixture to staging and run
# per-region analysis. The image comes from the shared fixture manifest
# (e2e/fixtures/manifest.json -> resourses/testing/); override with IMAGE=...
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API="${API:-https://simple-house-api-staging.a-tekhtelev.workers.dev}"
IMAGE="${IMAGE:-$(node -e 'console.log(require(process.argv[1]).fixture("house-floor-plan-image").absPath)' "$REPO_ROOT/e2e/fixtures/index.js")}"
EMAIL="fp_test_$(date +%s)@example.com"
PASSWORD="TestFloorPlan123!"

echo "=== Floor plan per-region E2E against $API ==="
echo "Image: $IMAGE"
ls -la "$IMAGE"

echo ""
echo "1. Register test user..."
REG=$(curl -sS -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"display_name\":\"Floor Plan Test\"}")
echo "Register keys: $(echo "$REG" | jq -r 'keys|join(",")' 2>/dev/null || echo raw)"
echo "$REG" | jq '{user_id: .user.id, email: .user.email, has_token: (.access_token != null), error: .error}' 2>/dev/null || echo "$REG"

TOKEN=$(echo "$REG" | jq -r '.access_token // .accessToken // .token // .tokens.accessToken // empty')
HH_ID=$(echo "$REG" | jq -r '.user.householdId // .householdId // .household.id // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Trying login..."
  LOGIN=$(curl -sS -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  TOKEN=$(echo "$LOGIN" | jq -r '.access_token // .accessToken // .token // .tokens.accessToken // empty')
  HH_ID=$(echo "$LOGIN" | jq -r '.user.householdId // .householdId // .household.id // empty')
  echo "Login keys: $(echo "$LOGIN" | jq -r 'keys|join(",")' 2>/dev/null || true)"
fi

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ Failed to authenticate"
  exit 1
fi

# List households if still missing
if [ -z "$HH_ID" ] || [ "$HH_ID" = "null" ]; then
  echo "Listing households..."
  LIST=$(curl -sS "$API/households" -H "Authorization: Bearer $TOKEN")
  HH_ID=$(echo "$LIST" | jq -r '.households[0].id // empty')
  if [ -z "$HH_ID" ] || [ "$HH_ID" = "null" ]; then
    HH_ID=$(echo "$LIST" | jq -r 'if type=="array" then .[0].id else empty end')
  fi
fi

if [ -z "$HH_ID" ] || [ "$HH_ID" = "null" ]; then
  echo "Creating household..."
  HH=$(curl -sS -X POST "$API/households" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"FP Test Home","address_line1":"8135 138 Street","city":"Surrey","state_province":"BC","country":"CA"}')
  HH_ID=$(echo "$HH" | jq -r '.household.id // .id // empty')
  echo "$HH" | jq '{id: (.household.id // .id), name: (.household.name // .name), error: .error}' 2>/dev/null || echo "$HH"
fi

if [ -z "$HH_ID" ] || [ "$HH_ID" = "null" ]; then
  echo "❌ Failed to resolve household"
  exit 1
fi

echo "✅ Token: ${TOKEN:0:24}..."
echo "✅ Household: $HH_ID"

FILE_SIZE=$(wc -c < "$IMAGE" | tr -d ' ')
FILENAME="${FILENAME:-floor-plan.jpeg}"

echo ""
echo "2. Request upload URL..."
UP=$(curl -sS -X POST "$API/households/$HH_ID/floor-plans/upload-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"filename\":\"$FILENAME\",\"file_size\":$FILE_SIZE,\"content_type\":\"image/jpeg\",\"building_name\":\"Main Building\"}")

FP_ID=$(echo "$UP" | jq -r '.floor_plan_id // empty')
UPLOAD_URL=$(echo "$UP" | jq -r '.upload_url // empty')
echo "$UP" | jq '{floor_plan_id, upload_url, expires_at}'

if [ -z "$FP_ID" ] || [ -z "$UPLOAD_URL" ]; then
  echo "❌ Failed to get upload URL"
  exit 1
fi

echo ""
echo "3. Upload JPEG ($FILE_SIZE bytes)..."
# upload_url may be relative
if [[ "$UPLOAD_URL" != http* ]]; then
  UPLOAD_URL="$API$UPLOAD_URL"
fi

HTTP_CODE=$(curl -sS -o /tmp/fp-upload-resp.txt -w "%{http_code}" -X PUT "$UPLOAD_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @"$IMAGE")
echo "Upload HTTP $HTTP_CODE"
cat /tmp/fp-upload-resp.txt
echo ""

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "❌ Upload failed"
  exit 1
fi

echo ""
echo "4. Confirm upload..."
CONF=$(curl -sS -X POST "$API/households/$HH_ID/floor-plans/$FP_ID/confirm-upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"building_name":"Main Building","floor_label":"Surrey Flyer"}')
echo "$CONF" | jq '{id: .floor_plan.id, status: .floor_plan.status, content_type: .floor_plan.content_type}'

echo ""
echo "5. Trigger analyze (background waitUntil)..."
AN=$(curl -sS -X POST "$API/households/$HH_ID/floor-plans/$FP_ID/analyze" \
  -H "Authorization: Bearer $TOKEN")
echo "$AN" | jq .

echo ""
echo "6. Wait for layout (Pass 1) to create regions..."
for i in $(seq 1 60); do
  R=$(curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/regions" \
    -H "Authorization: Bearer $TOKEN")
  RCOUNT=$(echo "$R" | jq '.regions | length')
  FP=$(curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID" \
    -H "Authorization: Bearer $TOKEN")
  STAGE=$(echo "$FP" | jq -r '.floor_plan.processing_stage // empty')
  ASTATUS=$(echo "$FP" | jq -r '.floor_plan.ai_analysis_status // empty')
  echo "[layout $i] regions=$RCOUNT stage=$STAGE analysis=$ASTATUS"
  if [ "$ASTATUS" = "failed" ]; then
    echo "$FP" | jq '{error: .floor_plan.error_message}'
    echo "❌ Layout detect failed"
    exit 1
  fi
  if [ "$RCOUNT" -gt 0 ] && [ "$STAGE" = "region_extract" ]; then
    break
  fi
  sleep 3
done

RCOUNT=$(curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/regions" \
  -H "Authorization: Bearer $TOKEN" | jq '.regions | length')
if [ "$RCOUNT" -eq 0 ]; then
  echo "❌ No regions after waiting for layout"
  exit 1
fi

echo ""
echo "7. Process regions one-by-one (Pass 2)..."
STATUS="processing"
for i in $(seq 1 20); do
  STEP=$(curl -sS -X POST "$API/households/$HH_ID/floor-plans/$FP_ID/regions/process-pending" \
    -H "Authorization: Bearer $TOKEN" \
    --max-time 180)
  echo "$STEP" | jq -c '{status, remaining, processed: (.processed.name // null), proc_status: (.processed.status // null), error}' 2>/dev/null \
    || echo "raw: $STEP"
  STATUS=$(echo "$STEP" | jq -r '.status // "unknown"')
  REMAINING=$(echo "$STEP" | jq -r '.remaining // -1')
  if [ "$STATUS" = "completed" ] || [ "$REMAINING" = "0" ]; then
    STATUS="completed"
    break
  fi
  # remaining=-1 means layout still not ready
  if [ "$REMAINING" = "-1" ]; then
    sleep 3
  else
    sleep 1
  fi
done

echo ""
echo "=== FINAL ANALYSIS ==="
curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/analysis" \
  -H "Authorization: Bearer $TOKEN" | jq '{
    status,
    address: .analysis.property_address,
    total_area: .analysis.total_area,
    floors: [.analysis.floors[]? | {name, level, spaces: (.spaces|length), bbox: .bounding_box}],
    detached: [.analysis.detached_areas[]? | {name, type, spaces: (.spaces|length), bbox: .bounding_box}],
    metadata: .analysis.metadata
  }'

echo ""
echo "=== FINAL REGIONS ==="
curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/regions" \
  -H "Authorization: Bearer $TOKEN" | jq '{
    count: (.regions|length),
    regions: [.regions[] | {
      name, kind, status, trace_status,
      spaces: (.spaces|length),
      has_crop: (.crop_image_key != null),
      has_semantic: (.vector_semantic_key != null),
      has_trace: (.vector_trace_key != null),
      error: .error_message
    }]
  }'

if [ "$STATUS" != "completed" ]; then
  echo "❌ Analysis did not complete (status=$STATUS)"
  exit 1
fi

FLOOR_COUNT=$(curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/analysis" \
  -H "Authorization: Bearer $TOKEN" | jq '.analysis.floors | length')
DETACHED_COUNT=$(curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/analysis" \
  -H "Authorization: Bearer $TOKEN" | jq '.analysis.detached_areas | length')
REGION_COUNT=$(curl -sS "$API/households/$HH_ID/floor-plans/$FP_ID/regions" \
  -H "Authorization: Bearer $TOKEN" | jq '.regions | length')

echo ""
echo "floors=$FLOOR_COUNT detached=$DETACHED_COUNT regions=$REGION_COUNT"
if [ "$REGION_COUNT" -lt 2 ]; then
  echo "⚠️ Expected at least 2 regions for the Surrey flyer (Main + Below Main); got $REGION_COUNT"
  exit 1
fi

echo "✅ E2E passed — floor plan id=$FP_ID household=$HH_ID"
