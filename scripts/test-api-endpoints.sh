#!/bin/bash

# 🧪 Visit Checklist API Endpoint Testing Script
# Tests all new endpoints for the visit checklist feature

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
ENVIRONMENT=${1:-staging}
API_URL=""
AUTH_TOKEN=${2:-""}

if [ "$ENVIRONMENT" == "production" ]; then
    API_URL="https://simple-house-api.a-tekhtelev.workers.dev"
elif [ "$ENVIRONMENT" == "staging" ]; then
    API_URL="https://simple-house-api-staging.a-tekhtelev.workers.dev"
else
    API_URL="http://localhost:8787"
fi

echo -e "${BLUE}🧪 Testing Visit Checklist API Endpoints${NC}"
echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
echo -e "${BLUE}API URL: $API_URL${NC}"
echo ""

# Test counter
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

test_endpoint() {
    local METHOD=$1
    local PATH=$2
    local EXPECTED_CODE=$3
    local DESCRIPTION=$4
    local DATA=$5

    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    echo -e "${YELLOW}Testing:${NC} $DESCRIPTION"
    echo -e "  ${BLUE}$METHOD${NC} $PATH"

    if [ "$METHOD" == "GET" ]; then
        if [ -z "$AUTH_TOKEN" ]; then
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL$PATH")
        else
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL$PATH")
        fi
    else
        if [ -z "$AUTH_TOKEN" ]; then
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X $METHOD -H "Content-Type: application/json" -d "$DATA" "$API_URL$PATH")
        else
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X $METHOD -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" -d "$DATA" "$API_URL$PATH")
        fi
    fi

    if [ "$HTTP_CODE" == "$EXPECTED_CODE" ] || [ "$EXPECTED_CODE" == "*" ]; then
        echo -e "  ${GREEN}✓ PASS${NC} (HTTP $HTTP_CODE)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "  ${RED}✗ FAIL${NC} (Expected: $EXPECTED_CODE, Got: $HTTP_CODE)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    echo ""
}

# Basic health checks
echo -e "${BLUE}=== Basic Health Checks ===${NC}"
test_endpoint "GET" "/health" "200" "Health check endpoint"
test_endpoint "GET" "/" "200" "Root endpoint"

# Test visit checklist endpoints (will return 401 without auth)
echo -e "${BLUE}=== Visit Checklist Endpoints (Auth Required) ===${NC}"

# Note: These will return 401 without valid auth token, which is expected
HOUSEHOLD_ID="test-household-id"
CHECKLIST_ID="test-checklist-id"
ITEM_ID="test-item-id"
PHOTO_ID="test-photo-id"
TASK_ID="test-task-id"
VISIT_ID="test-visit-id"

test_endpoint "POST" "/households/$HOUSEHOLD_ID/visit-checklists/$CHECKLIST_ID/generate-ai-suggestions" "401" "Generate AI suggestions (expects auth)"
test_endpoint "POST" "/households/$HOUSEHOLD_ID/visit-checklists/$CHECKLIST_ID/items/$ITEM_ID/accept" "401" "Accept AI suggestion (expects auth)"
test_endpoint "POST" "/households/$HOUSEHOLD_ID/visit-checklists/$CHECKLIST_ID/items/$ITEM_ID/dismiss" "401" "Dismiss AI suggestion (expects auth)"
test_endpoint "POST" "/households/$HOUSEHOLD_ID/visit-checklists/$CHECKLIST_ID/items/$ITEM_ID/photos" "401" "Add photo (expects auth)"
test_endpoint "GET" "/households/$HOUSEHOLD_ID/visit-checklists/$CHECKLIST_ID/items/$ITEM_ID/photos" "401" "Get photos (expects auth)"
test_endpoint "DELETE" "/households/$HOUSEHOLD_ID/visit-checklists/$CHECKLIST_ID/items/$ITEM_ID/photos/$PHOTO_ID" "401" "Delete photo (expects auth)"
test_endpoint "GET" "/households/$HOUSEHOLD_ID/visit-checklists/for-task/$TASK_ID" "401" "Get checklists for task (expects auth)"
test_endpoint "GET" "/households/$HOUSEHOLD_ID/visit-checklists/comparison/$TASK_ID" "401" "Multi-contractor comparison (expects auth)"

# Test contractor visit endpoints
echo -e "${BLUE}=== Contractor Visit Endpoints (Auth Required) ===${NC}"
test_endpoint "POST" "/households/$HOUSEHOLD_ID/contractors/visits/$VISIT_ID/start" "401" "Start visit mode (expects auth)"
test_endpoint "POST" "/households/$HOUSEHOLD_ID/contractors/visits/$VISIT_ID/complete" "401" "Complete visit (expects auth)"

# Summary
echo -e "${BLUE}=== Test Summary ===${NC}"
echo -e "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
