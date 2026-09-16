#!/bin/bash

# Enhanced Contractor Search - Production API Test Suite
# Tests all endpoints with enhanced metadata

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API Configuration
API_URL="https://simple-house-api.a-tekhtelev.workers.dev"
HOUSEHOLD_ID="${TEST_HOUSEHOLD_ID}"
AUTH_TOKEN="${TEST_AUTH_TOKEN}"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Helper functions
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}\n"
}

print_test() {
    echo -e "${YELLOW}Testing:${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    ((TESTS_PASSED++))
    ((TESTS_TOTAL++))
}

print_failure() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
}

print_info() {
    echo -e "${BLUE}ℹ INFO:${NC} $1"
}

# Check if required environment variables are set
if [ -z "$TEST_HOUSEHOLD_ID" ] || [ -z "$TEST_AUTH_TOKEN" ]; then
    echo -e "${RED}ERROR: Required environment variables not set${NC}"
    echo "Please set:"
    echo "  export TEST_HOUSEHOLD_ID='your-household-id'"
    echo "  export TEST_AUTH_TOKEN='your-auth-token'"
    echo ""
    echo "Skipping authenticated tests and running basic health checks only..."
    SKIP_AUTH_TESTS=true
else
    SKIP_AUTH_TESTS=false
fi

# ============================================
# TEST 1: Health Check
# ============================================
print_header "TEST 1: Health Check"
print_test "GET /health"

RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"status":"ok"'; then
    print_success "Health check passed"
    print_info "Response: $BODY"
else
    print_failure "Health check failed (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# Skip authenticated tests if credentials not provided
if [ "$SKIP_AUTH_TESTS" = true ]; then
    echo -e "\n${YELLOW}════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Skipping authenticated tests${NC}"
    echo -e "${YELLOW}To run full test suite, set TEST_HOUSEHOLD_ID and TEST_AUTH_TOKEN${NC}"
    echo -e "${YELLOW}════════════════════════════════════════${NC}\n"

    # Print summary
    print_header "TEST SUMMARY"
    echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
    echo -e "Total Tests:  ${BLUE}$TESTS_TOTAL${NC}"

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "\n${GREEN}✓ Basic health checks PASSED${NC}"
        exit 0
    else
        echo -e "\n${RED}✗ Some tests FAILED${NC}"
        exit 1
    fi
fi

# ============================================
# TEST 2: Basic Contractor Search (Backward Compatibility)
# ============================================
print_header "TEST 2: Basic Contractor Search (Backward Compatibility)"
print_test "POST /households/:householdId/contractors/search (basic params)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Test Basic Search",
    "problem_description": "Testing backward compatibility with basic params only",
    "system_category": "plumbing",
    "location": {
      "city": "Vancouver",
      "state": "BC"
    },
    "source_type": "maintenance_task",
    "source_id": "test-basic-'$(date +%s)'"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"contractors"'; then
    print_success "Basic search works (backward compatible)"
    CONTRACTOR_COUNT=$(echo "$BODY" | grep -o '"contractors":\[' | wc -l)
    print_info "Found contractors in response"
else
    print_failure "Basic search failed (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 3: Enhanced Contractor Search (All Metadata)
# ============================================
print_header "TEST 3: Enhanced Contractor Search (All Metadata)"
print_test "POST /households/:householdId/contractors/search (all enhanced fields)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "HVAC Annual Maintenance",
    "problem_description": "Need comprehensive HVAC service including filter replacement and coil cleaning",
    "system_category": "hvac",
    "location": {
      "city": "Vancouver",
      "state": "BC",
      "address": "123 Main St, Vancouver, BC"
    },
    "source_type": "maintenance_task",
    "source_id": "test-enhanced-'$(date +%s)'",
    "contractor_category": "HVAC technician",
    "subtasks": [
      "Replace air filter",
      "Clean condenser coils",
      "Check refrigerant levels"
    ],
    "severity": "minor",
    "urgency_score": 4,
    "source_page_numbers": [15, 16],
    "source_quotes": [
      "HVAC system requires annual maintenance to maintain efficiency",
      "Filters should be replaced every 3 months"
    ]
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"contractors"'; then
    print_success "Enhanced search with all metadata works"
    print_info "Successfully passed subtasks, severity, urgency, quotes, and pages"
else
    print_failure "Enhanced search failed (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 4: Government/Municipal Search
# ============================================
print_header "TEST 4: Government/Municipal Department Search"
print_test "POST /households/:householdId/contractors/search (government type)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Surrey Secondary Suite Inspection",
    "problem_description": "Need to schedule inspection for secondary suite compliance with City of Surrey",
    "system_category": "inspection",
    "location": {
      "city": "Surrey",
      "state": "BC",
      "address": "123 Main St, Surrey, BC"
    },
    "source_type": "task_draft",
    "source_id": "test-govt-'$(date +%s)'",
    "contractor_category": "city/municipal department",
    "severity": "critical",
    "urgency_score": 9,
    "source_quotes": [
      "Secondary suite must be inspected for compliance with municipal bylaws"
    ]
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"contractors"'; then
    print_success "Government/municipal search works"
    print_info "Successfully handled city/municipal department search"

    # Check if phone number is included (critical for government services)
    if echo "$BODY" | grep -q '"phone"'; then
        print_success "Phone numbers included in government search results"
    else
        print_failure "Phone numbers missing from government search results"
    fi
else
    print_failure "Government/municipal search failed (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 5: Task Draft Source Type
# ============================================
print_header "TEST 5: Task Draft Source Type"
print_test "POST /households/:householdId/contractors/search (source_type: task_draft)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Electrical Panel Upgrade",
    "problem_description": "Panel shows signs of overheating and requires immediate professional attention",
    "system_category": "electrical",
    "location": {
      "city": "Vancouver",
      "state": "BC"
    },
    "source_type": "task_draft",
    "source_id": "test-draft-'$(date +%s)'",
    "severity": "critical",
    "urgency_score": 10,
    "source_page_numbers": [7, 8],
    "source_quotes": [
      "Electrical panel shows signs of overheating",
      "Several breakers are loose and require immediate professional attention"
    ]
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"contractors"'; then
    print_success "Task draft source type works"
    print_info "Successfully handled task_draft source_type"
else
    print_failure "Task draft source type failed (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 6: Validation - Contractor Category Too Long
# ============================================
print_header "TEST 6: Validation Tests"
print_test "POST /households/:householdId/contractors/search (contractor_category > 100 chars)"

LONG_CATEGORY=$(python3 -c "print('a' * 101)")
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Test Validation",
    "problem_description": "Testing validation limits",
    "system_category": "plumbing",
    "location": {"city": "Vancouver", "state": "BC"},
    "source_type": "maintenance_task",
    "source_id": "test-val-'$(date +%s)'",
    "contractor_category": "'$LONG_CATEGORY'"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "400" ] || echo "$BODY" | grep -q "validation\|error"; then
    print_success "Validation rejected contractor_category > 100 chars"
else
    print_failure "Validation did not reject too-long contractor_category (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 7: Validation - Urgency Score Out of Range
# ============================================
print_test "POST /households/:householdId/contractors/search (urgency_score > 10)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Test Validation",
    "problem_description": "Testing validation limits",
    "system_category": "plumbing",
    "location": {"city": "Vancouver", "state": "BC"},
    "source_type": "maintenance_task",
    "source_id": "test-val-'$(date +%s)'",
    "urgency_score": 15
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "400" ] || echo "$BODY" | grep -q "validation\|error"; then
    print_success "Validation rejected urgency_score > 10"
else
    print_failure "Validation did not reject urgency_score > 10 (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 8: Validation - Too Many Subtasks
# ============================================
print_test "POST /households/:householdId/contractors/search (subtasks > 20)"

# Generate 21 subtasks
SUBTASKS=$(python3 -c "import json; print(json.dumps(['Task ' + str(i) for i in range(21)]))")
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Test Validation",
    "problem_description": "Testing validation limits",
    "system_category": "plumbing",
    "location": {"city": "Vancouver", "state": "BC"},
    "source_type": "maintenance_task",
    "source_id": "test-val-'$(date +%s)'",
    "subtasks": '"$SUBTASKS"'
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "400" ] || echo "$BODY" | grep -q "validation\|error"; then
    print_success "Validation rejected > 20 subtasks"
else
    print_failure "Validation did not reject > 20 subtasks (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 9: Validation - Invalid Severity
# ============================================
print_test "POST /households/:householdId/contractors/search (invalid severity)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Test Validation",
    "problem_description": "Testing validation limits",
    "system_category": "plumbing",
    "location": {"city": "Vancouver", "state": "BC"},
    "source_type": "maintenance_task",
    "source_id": "test-val-'$(date +%s)'",
    "severity": "invalid_severity"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "400" ] || echo "$BODY" | grep -q "validation\|error"; then
    print_success "Validation rejected invalid severity"
else
    print_failure "Validation did not reject invalid severity (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# TEST 10: Validation - Invalid Source Type
# ============================================
print_test "POST /households/:householdId/contractors/search (invalid source_type)"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/households/$HOUSEHOLD_ID/contractors/search" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "problem_title": "Test Validation",
    "problem_description": "Testing validation limits",
    "system_category": "plumbing",
    "location": {"city": "Vancouver", "state": "BC"},
    "source_type": "invalid_type",
    "source_id": "test-val-'$(date +%s)'"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed $d)

if [ "$HTTP_CODE" = "400" ] || echo "$BODY" | grep -q "validation\|error"; then
    print_success "Validation rejected invalid source_type"
else
    print_failure "Validation did not reject invalid source_type (HTTP $HTTP_CODE)"
    print_info "Response: $BODY"
fi

# ============================================
# FINAL SUMMARY
# ============================================
print_header "TEST SUMMARY"

echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Total Tests:  ${BLUE}$TESTS_TOTAL${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}Production API is ready for use!${NC}"
    echo -e "${GREEN}════════════════════════════════════════${NC}\n"
    exit 0
else
    echo -e "\n${RED}════════════════════════════════════════${NC}"
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo -e "${RED}Please review the failures above${NC}"
    echo -e "${RED}════════════════════════════════════════${NC}\n"
    exit 1
fi
