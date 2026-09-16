# API Testing Guide

This guide explains how to run and extend the API endpoint tests.

## Running Tests

### Quick Test
```bash
cd backend
./test-endpoints.sh
```

This will test all API endpoints and show you:
- ✅ Which tests passed
- ❌ Which tests failed
- Response data from each endpoint
- Overall pass rate

### Example Output
```
=========================================
Simple House API Test Suite
API: https://simple-house-api.a-tekhtelev.workers.dev
=========================================

=== Section 1: Health & Info ===

Test 1: Health Check
  → GET /health
  ← 200: {"status":"ok"}
  ✓ PASSED

Test 2: API Info
  → GET /
  ← 200: {"name":"Simple House API","version":"1.0.0",...}
  ✓ PASSED

...

=========================================
Test Summary
=========================================
Total Tests:  27
Passed:       25
Failed:       2

Pass Rate: 92%
```

## Adding New Tests

### 1. Simple GET Request Test

Add this to the appropriate section in `test-endpoints.sh`:

```bash
test_api "Test Name" "GET" "/endpoint/path" "" "$ACCESS_TOKEN" "200"
```

**Parameters:**
- `"Test Name"`: Description shown in output
- `"GET"`: HTTP method
- `"/endpoint/path"`: The endpoint URL path
- `""`: Empty string (no request body for GET)
- `"$ACCESS_TOKEN"`: Auth token (or "" if not required)
- `"200"`: Expected HTTP status code

### 2. POST Request with Body

```bash
# Create JSON file
REQUEST_JSON=$(create_json "my_request.json" '{
  "field1": "value1",
  "field2": "value2"
}')

# Test endpoint
test_api "Create Something" "POST" "/endpoint" "$REQUEST_JSON" "$ACCESS_TOKEN" "201"
```

### 3. Capture Response Data

```bash
test_api "Create Item" "POST" "/items" "$REQUEST_JSON" "$ACCESS_TOKEN" "201"

# Extract ID from response
if [ -f "$TEST_DATA_DIR/last_response.json" ]; then
    ITEM_ID=$(jq -r '.id // empty' "$TEST_DATA_DIR/last_response.json")
    echo -e "${GREEN}→ Captured Item ID: $ITEM_ID${NC}\n"
fi

# Use in next test
test_api "Get Item" "GET" "/items/$ITEM_ID" "" "$ACCESS_TOKEN" "200"
```

### 4. Test Error Cases

```bash
# Test with invalid data
INVALID_DATA=$(create_json "invalid.json" '{"email":"not-an-email"}')
test_api "Invalid Email" "POST" "/auth/register" "$INVALID_DATA" "" "400"

# Test without auth
test_api "Unauthorized" "GET" "/users/me" "" "" "401"

# Test with wrong permissions
test_api "Forbidden" "DELETE" "/households/$OTHER_USER_HOUSEHOLD" "" "$ACCESS_TOKEN" "403"
```

## Example: Adding a New Feature Test

Let's say you added a new "Notes" feature. Here's how to add tests:

```bash
# ==========================================
# 11. NOTES (NEW)
# ==========================================
echo -e "${YELLOW}=== Section 11: Notes ===${NC}\n"

if [ -n "$ACCESS_TOKEN" ] && [ -n "$HOUSEHOLD_ID" ]; then
    # List notes
    test_api "List Notes" "GET" "/households/$HOUSEHOLD_ID/notes" "" "$ACCESS_TOKEN" "200"

    # Create note
    CREATE_NOTE=$(create_json "create_note.json" '{
        "title": "Kitchen Renovation Ideas",
        "content": "Need to replace countertops and add new lighting",
        "tags": ["renovation", "kitchen"]
    }')
    test_api "Create Note" "POST" "/households/$HOUSEHOLD_ID/notes" "$CREATE_NOTE" "$ACCESS_TOKEN" "201"

    # Get note ID from response
    if [ -f "$TEST_DATA_DIR/last_response.json" ]; then
        NOTE_ID=$(jq -r '.id // empty' "$TEST_DATA_DIR/last_response.json")

        if [ -n "$NOTE_ID" ] && [ "$NOTE_ID" != "null" ]; then
            echo -e "${GREEN}→ Captured Note ID: $NOTE_ID${NC}\n"

            # Get note details
            test_api "Get Note" "GET" "/households/$HOUSEHOLD_ID/notes/$NOTE_ID" "" "$ACCESS_TOKEN" "200"

            # Update note
            UPDATE_NOTE=$(create_json "update_note.json" '{"title":"Updated Kitchen Plan"}')
            test_api "Update Note" "PATCH" "/households/$HOUSEHOLD_ID/notes/$NOTE_ID" "$UPDATE_NOTE" "$ACCESS_TOKEN" "200"

            # Delete note
            test_api "Delete Note" "DELETE" "/households/$HOUSEHOLD_ID/notes/$NOTE_ID" "" "$ACCESS_TOKEN" "204"

            # Verify deleted
            test_api "Verify Note Deleted" "GET" "/households/$HOUSEHOLD_ID/notes/$NOTE_ID" "" "$ACCESS_TOKEN" "404"
        fi
    fi
else
    echo -e "${RED}Skipping note tests - no access token or household${NC}\n"
fi
```

## Test Structure

The test script is organized into sections:

1. **Health & Info** - Basic connectivity
2. **Authentication** - Login, register, tokens
3. **User Management** - Profile operations
4. **Household Management** - CRUD operations
5. **Invitations** - Invite flow
6. **Reports** - PDF uploads and listing
7. **Action Items** - Task management
8. **Maintenance Tasks** - Recurring tasks
9. **Notifications** - User notifications
10. **Jobs** - Background job status

Add your new feature tests as a new section or within an existing section.

## Testing Tips

### 1. Use Descriptive Test Names
```bash
# Good
test_api "Create Household with Valid Data" ...

# Bad
test_api "Test 1" ...
```

### 2. Test Both Success and Failure Cases
```bash
# Success case
test_api "Create Item Success" "POST" "/items" "$VALID_DATA" "$TOKEN" "201"

# Failure cases
test_api "Create Item Missing Field" "POST" "/items" "$MISSING_FIELD" "$TOKEN" "400"
test_api "Create Item Unauthorized" "POST" "/items" "$VALID_DATA" "" "401"
test_api "Create Item Duplicate" "POST" "/items" "$DUPLICATE_DATA" "$TOKEN" "409"
```

### 3. Clean Up After Tests
```bash
# Create resource for testing
test_api "Create Test Resource" ...
RESOURCE_ID=$(jq -r '.id' "$TEST_DATA_DIR/last_response.json")

# ... run tests using the resource ...

# Clean up
test_api "Delete Test Resource" "DELETE" "/resources/$RESOURCE_ID" "" "$ACCESS_TOKEN" "204"
```

### 4. Handle Rate Limits
If you see rate limit errors (429), the script is testing too fast. Add delays:

```bash
# Add small delay between tests
sleep 1

test_api "Next Test" ...
```

Or wait for the rate limit to reset:

```bash
echo "Waiting for rate limit to reset..."
sleep 60
```

### 5. Use Dynamic Test Data
```bash
# Use timestamp to ensure unique data
UNIQUE_EMAIL="test$(date +%s)@example.com"

CREATE_USER=$(create_json "user.json" "{
    \"email\": \"$UNIQUE_EMAIL\",
    \"password\": \"Test123!@#\"
}")
```

## Debugging Failed Tests

### View Full Response
The script saves the last response to:
```bash
cat /tmp/api-test-data/last_response.json | jq .
```

### Test Single Endpoint Manually
```bash
curl -s -X POST "https://simple-house-api.a-tekhtelev.workers.dev/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}' | jq .
```

### Check Logs
```bash
cd backend
source ~/.nvm/nvm.sh && nvm use 20
wrangler tail --env production --format pretty
```

### Common Issues

**Issue:** 429 Rate Limited
```
Solution: Wait for rate limit to reset or test less frequently
```

**Issue:** 401 Unauthorized
```
Solution: Check that ACCESS_TOKEN is set correctly
```

**Issue:** 404 Not Found
```
Solution: Verify the endpoint path and that the resource exists
```

**Issue:** 500 Internal Error
```
Solution: Check backend logs with `wrangler tail`
```

## Best Practices

1. **Run tests before deploying** to ensure nothing broke
2. **Add tests when adding features** to verify they work
3. **Test error cases** to ensure proper error handling
4. **Keep tests independent** - each test should work on its own
5. **Use meaningful assertions** - check the response data, not just status codes

## Continuous Integration

You can run these tests in CI/CD:

```yaml
# .github/workflows/test.yml
name: API Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run API Tests
        run: |
          cd backend
          chmod +x test-endpoints.sh
          ./test-endpoints.sh
```

## Need Help?

- Check [API_ENDPOINTS.md](API_ENDPOINTS.md) for endpoint documentation
- View [DEPLOYMENT_STATUS.md](../DEPLOYMENT_STATUS.md) for current status
- Run tests with `bash -x test-endpoints.sh` for verbose output
