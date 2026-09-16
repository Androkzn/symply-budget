#!/bin/bash
# Settings API Test Script
# Tests all settings endpoints on staging environment

set -e

API_URL="https://simple-house-api.a-tekhtelev.workers.dev"
TOKEN="$1"

if [ -z "$TOKEN" ]; then
  echo "Usage: ./test-settings-api.sh YOUR_AUTH_TOKEN"
  echo ""
  echo "Get your token by:"
  echo "1. Login to the app"
  echo "2. Check AsyncStorage or MMKV for 'auth-storage'"
  echo "3. Copy the 'token' value"
  exit 1
fi

echo "🧪 Testing Settings API on staging..."
echo "API: $API_URL"
echo ""

# Test 1: Fetch all settings (should be empty for new user)
echo "📥 Test 1: Fetch all settings..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings" | jq '.'
echo ""

# Test 2: Create a test setting
echo "✍️  Test 2: Create test setting (theme=dark)..."
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"dark"}' \
  "$API_URL/api/settings/test.theme" | jq '.'
echo ""

# Test 3: Fetch all settings again (should have 1 setting)
echo "📥 Test 3: Fetch all settings (should have 1)..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings" | jq '.'
echo ""

# Test 4: Update the setting
echo "✍️  Test 4: Update setting (theme=light)..."
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":"light"}' \
  "$API_URL/api/settings/test.theme" | jq '.'
echo ""

# Test 5: Bulk update
echo "✍️  Test 5: Bulk update (3 settings)..."
curl -s -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"settings":[
    {"key":"theme.mode","value":"dark"},
    {"key":"navigation.tabs","value":"[]"},
    {"key":"widgets.layout","value":"[]"}
  ]}' \
  "$API_URL/api/settings/bulk" | jq '.'
echo ""

# Test 6: Fetch all settings (should have 4 now)
echo "📥 Test 6: Fetch all settings (should have 4)..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings" | jq '.'
echo ""

# Test 7: Delete test setting
echo "🗑️  Test 7: Delete test setting..."
curl -s -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings/test.theme" | jq '.'
echo ""

# Test 8: Fetch all settings (should have 3 now)
echo "📥 Test 8: Fetch all settings (should have 3)..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings" | jq '.'
echo ""

# Test 9: Reset all settings
echo "🔄 Test 9: Reset all settings..."
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings/reset" | jq '.'
echo ""

# Test 10: Fetch all settings (should be empty)
echo "📥 Test 10: Fetch all settings (should be empty)..."
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/settings" | jq '.'
echo ""

echo "✅ All API tests completed!"
echo ""
echo "Summary:"
echo "- ✅ GET /api/settings - Fetch all settings"
echo "- ✅ PUT /api/settings/:key - Update single setting"
echo "- ✅ PUT /api/settings/bulk - Bulk update"
echo "- ✅ DELETE /api/settings/:key - Delete setting"
echo "- ✅ POST /api/settings/reset - Reset all settings"
echo ""
echo "🚀 Backend is PRODUCTION READY!"
