#!/bin/bash

# 🧪 Production API Verification Script
# Comprehensive testing of all visit checklist endpoints

echo "🔍 PRODUCTION API VERIFICATION"
echo "================================"
echo ""

PROD_URL="https://simple-house-api.a-tekhtelev.workers.dev"
PASS=0
FAIL=0

test_endpoint() {
    local NAME=$1
    local METHOD=$2
    local PATH=$3
    local EXPECTED=$4

    echo "Testing: $NAME"
    echo "  → $METHOD $PATH"

    RESULT=$(curl -s -w "\n%{http_code}" -X "$METHOD" "$PROD_URL$PATH" -H "Content-Type: application/json" 2>&1)
    STATUS=$(echo "$RESULT" | tail -1)
    BODY=$(echo "$RESULT" | head -n -1)

    if [ "$STATUS" = "$EXPECTED" ]; then
        echo "  ✓ PASS (HTTP $STATUS)"
        PASS=$((PASS + 1))
    else
        echo "  ✗ FAIL (Expected: $EXPECTED, Got: $STATUS)"
        echo "  Response: $BODY"
        FAIL=$((FAIL + 1))
    fi
    echo ""
}

echo "=== Basic Health Checks ==="
test_endpoint "Health Check" "GET" "/health" "200"
test_endpoint "Root Endpoint" "GET" "/" "200"

echo "=== Visit Checklist Endpoints ==="
test_endpoint "Generate AI Suggestions" "POST" "/households/test/visit-checklists/test/generate-ai-suggestions" "401"
test_endpoint "Accept AI Suggestion" "POST" "/households/test/visit-checklists/test/items/test/accept" "401"
test_endpoint "Dismiss AI Suggestion" "POST" "/households/test/visit-checklists/test/items/test/dismiss" "401"
test_endpoint "Add Photo to Item" "POST" "/households/test/visit-checklists/test/items/test/photos" "401"
test_endpoint "Get Item Photos" "GET" "/households/test/visit-checklists/test/items/test/photos" "401"
test_endpoint "Delete Item Photo" "DELETE" "/households/test/visit-checklists/test/items/test/photos/test" "401"
test_endpoint "Get Task Checklists" "GET" "/households/test/visit-checklists/for-task/test" "401"
test_endpoint "Multi-Contractor Comparison" "GET" "/households/test/visit-checklists/comparison/test" "401"

echo "=== Contractor Visit Endpoints ==="
test_endpoint "Start Visit Mode" "POST" "/households/test/contractors/visits/test/start" "401"
test_endpoint "Complete Visit" "POST" "/households/test/contractors/visits/test/complete" "401"

echo "=== SUMMARY ==="
echo "Total Tests: $((PASS + FAIL))"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "✓ ALL TESTS PASSED!"
    exit 0
else
    echo "✗ SOME TESTS FAILED"
    exit 1
fi
