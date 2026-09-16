#!/bin/bash

# Test Calendar and Notification Override APIs
# Usage: ./test-calendar-api.sh <email> <password> [environment]
# Example: ./test-calendar-api.sh user@example.com mypassword production

EMAIL="$1"
PASSWORD="$2"
ENV="${3:-production}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Usage: ./test-calendar-api.sh <email> <password> [environment]"
  echo "Environment: staging or production (default: production)"
  exit 1
fi

if [ "$ENV" = "staging" ]; then
  API_URL="https://simple-house-api-staging.a-tekhtelev.workers.dev"
else
  API_URL="https://simple-house-api.a-tekhtelev.workers.dev"
fi

echo "================================================"
echo "Testing Calendar & Notification APIs on $ENV"
echo "API URL: $API_URL"
echo "================================================"
echo ""

# Step 1: Login to get token
echo "=== Step 1: Logging in ==="
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to login!"
  echo "$LOGIN_RESPONSE"
  exit 1
fi
echo "Login successful!"
echo ""

# Step 2: Test Calendar Settings
echo "=== Step 2: GET /calendar/settings ==="
SETTINGS_RESPONSE=$(curl -s -w "\nHTTP: %{http_code}" "$API_URL/calendar/settings" \
  -H "Authorization: Bearer $TOKEN")
echo "$SETTINGS_RESPONSE"
echo ""

# Step 3: Update Calendar Settings
echo "=== Step 3: PUT /calendar/settings ==="
UPDATE_SETTINGS=$(curl -s -w "\nHTTP: %{http_code}" -X PUT "$API_URL/calendar/settings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"auto_sync_tasks":true,"task_event_duration_minutes":60}')
echo "$UPDATE_SETTINGS"
echo ""

# Step 4: Create Subscribe Token
echo "=== Step 4: POST /calendar/subscribe ==="
CREATE_TOKEN=$(curl -s -w "\nHTTP: %{http_code}" -X POST "$API_URL/calendar/subscribe" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Calendar","include_tasks":true,"include_appointments":true,"include_garbage":true}')
echo "$CREATE_TOKEN"
echo ""

# Extract the token for testing iCal
ICAL_TOKEN=$(echo "$CREATE_TOKEN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Step 5: List Subscribe Tokens
echo "=== Step 5: GET /calendar/subscribe/tokens ==="
LIST_TOKENS=$(curl -s -w "\nHTTP: %{http_code}" "$API_URL/calendar/subscribe/tokens" \
  -H "Authorization: Bearer $TOKEN")
echo "$LIST_TOKENS"
echo ""

# Step 6: Test iCal Feed
if [ -n "$ICAL_TOKEN" ]; then
  echo "=== Step 6: GET /calendar/ical/:token (iCal Feed) ==="
  ICAL_RESPONSE=$(curl -s -w "\nHTTP: %{http_code}" "$API_URL/calendar/ical/$ICAL_TOKEN")
  echo "$ICAL_RESPONSE" | head -30
  echo "..."
  echo ""
fi

# Step 7: Test Notification Overrides
echo "=== Step 7: GET /notifications/overrides ==="
OVERRIDES=$(curl -s -w "\nHTTP: %{http_code}" "$API_URL/notifications/overrides" \
  -H "Authorization: Bearer $TOKEN")
echo "$OVERRIDES"
echo ""

# Step 8: Create Notification Override for a category
echo "=== Step 8: PUT /notifications/overrides/category/hvac ==="
CREATE_OVERRIDE=$(curl -s -w "\nHTTP: %{http_code}" -X PUT "$API_URL/notifications/overrides/category/hvac" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"reminder_days_before":3,"reminder_time":"09:00"}')
echo "$CREATE_OVERRIDE"
echo ""

# Step 9: List Overrides again
echo "=== Step 9: GET /notifications/overrides (after creating) ==="
OVERRIDES_AFTER=$(curl -s -w "\nHTTP: %{http_code}" "$API_URL/notifications/overrides" \
  -H "Authorization: Bearer $TOKEN")
echo "$OVERRIDES_AFTER"
echo ""

# Cleanup: Delete the test subscribe token
if [ -n "$ICAL_TOKEN" ]; then
  # Get token ID from list
  TOKEN_ID=$(echo "$LIST_TOKENS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$TOKEN_ID" ]; then
    echo "=== Cleanup: DELETE /calendar/subscribe/tokens/:id ==="
    DELETE_RESPONSE=$(curl -s -w "\nHTTP: %{http_code}" -X DELETE "$API_URL/calendar/subscribe/tokens/$TOKEN_ID" \
      -H "Authorization: Bearer $TOKEN")
    echo "$DELETE_RESPONSE"
    echo ""
  fi
fi

echo "================================================"
echo "All tests completed!"
echo "================================================"
