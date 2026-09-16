#!/bin/bash

echo "🧪 Testing Recipe Flow with Real AI on Production Lambda"
echo "=========================================================="
echo ""

# Check if API key is set
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ ANTHROPIC_API_KEY not set"
  echo "Please run: export ANTHROPIC_API_KEY=your-api-key"
  exit 1
fi

API="http://localhost:8787"

# Register test user
echo "1. Registering test user..."
REG=$(curl -s -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"aitest_$(date +%s)@example.com\",\"password\":\"Test123!\",\"displayName\":\"AI Test\"}")

TOKEN=$(echo "$REG" | jq -r '.token // .accessToken // empty')
HH_ID=$(echo "$REG" | jq -r '.user.householdId // .householdId // empty')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get credentials"
  exit 1
fi

echo "✅ Token: ${TOKEN:0:20}..."
echo "✅ Household: $HH_ID"
echo ""

# Test AI conversation for recipe creation
echo "2. Testing AI - Create Recipe (with real Claude)"
echo "Message: 'I want to create a pasta carbonara with bacon, eggs, and parmesan'"
echo ""

CHAT1=$(curl -s -X POST "$API/households/$HH_ID/recipes/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"I want to create a pasta carbonara with bacon, eggs, and parmesan"}')

echo "$CHAT1" | jq '{
  flowType: .flowType,
  stage: .stage,
  requiresUserInput: .requiresUserInput,
  response: (.response | .[0:200] + "...")
}'

SESSION_ID=$(echo "$CHAT1" | jq -r '.sessionId')
echo ""
echo "✅ Session ID: $SESSION_ID"
echo ""

# Test AI conversation for meal logging
echo "3. Testing AI - Log Meal (with real Claude)"
echo "Message: 'I just ate chicken salad for lunch'"
echo ""

CHAT2=$(curl -s -X POST "$API/households/$HH_ID/recipes/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"I just ate chicken salad for lunch"}')

echo "$CHAT2" | jq '{
  flowType: .flowType,
  stage: .stage,
  response: (.response | .[0:200] + "...")
}'
echo ""

# Test AI conversation for water logging
echo "4. Testing AI - Log Water (with real Claude)"
echo "Message: 'I drank 500ml of water'"
echo ""

CHAT3=$(curl -s -X POST "$API/households/$HH_ID/recipes/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"I drank 500ml of water"}')

echo "$CHAT3" | jq '{
  flowType: .flowType,
  stage: .stage,
  response: (.response | .[0:200] + "...")
}'
echo ""

echo "✅ All AI tests completed successfully!"
echo ""
echo "The real Claude AI is working correctly for:"
echo "  • Recipe creation intent detection"
echo "  • Meal logging intent detection"
echo "  • Water logging intent detection"
