#!/usr/bin/env bash
#
# test-all-endpoints.sh — Single-script API smoke runner for CI/CD.
#
# Hits every HTTP route mounted in backend/src/index.ts and verifies the
# response is in the expected class (no 5xx, correct auth gate behavior).
#
# Usage:
#   scripts/test-all-endpoints.sh [flags]
#
# Common invocations:
#   # Smoke-test staging without auth (default):
#   scripts/test-all-endpoints.sh
#
#   # Smoke + authenticated GETs against production:
#   API_URL=https://simple-house-api.a-tekhtelev.workers.dev \
#   TEST_EMAIL=ci@example.com TEST_PASSWORD=secret \
#   TEST_HOUSEHOLD_ID=abc123 \
#   scripts/test-all-endpoints.sh --mode all
#
#   # In CI with JUnit output:
#   scripts/test-all-endpoints.sh --junit reports/api-tests.xml
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed
#   2  setup error (bad flags, login failed, missing deps)

set -o pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ENVIRONMENT="${ENVIRONMENT:-staging}"
API_URL="${API_URL:-}"
TEST_AUTH_TOKEN="${TEST_AUTH_TOKEN:-}"
TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"
TEST_HOUSEHOLD_ID="${TEST_HOUSEHOLD_ID:-00000000-0000-0000-0000-000000000000}"
TEST_RESOURCE_ID="${TEST_RESOURCE_ID:-00000000-0000-0000-0000-000000000000}"
MODE="smoke"
FILTER=""
JUNIT_FILE=""
JSON_OUTPUT=0
FAIL_FAST=0
VERBOSE=0
TIMEOUT=15
PARALLEL=1   # sequential by default; bump for speed if your CI runner allows

# ---------------------------------------------------------------------------
# CLI parsing
# ---------------------------------------------------------------------------

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)            ENVIRONMENT="$2"; shift 2 ;;
    --api-url)        API_URL="$2"; shift 2 ;;
    --token)          TEST_AUTH_TOKEN="$2"; shift 2 ;;
    --email)          TEST_EMAIL="$2"; shift 2 ;;
    --password)       TEST_PASSWORD="$2"; shift 2 ;;
    --household-id)   TEST_HOUSEHOLD_ID="$2"; shift 2 ;;
    --resource-id)    TEST_RESOURCE_ID="$2"; shift 2 ;;
    --mode)           MODE="$2"; shift 2 ;;
    --filter)         FILTER="$2"; shift 2 ;;
    --junit)          JUNIT_FILE="$2"; shift 2 ;;
    --json)           JSON_OUTPUT=1; shift ;;
    --fail-fast)      FAIL_FAST=1; shift ;;
    --verbose|-v)     VERBOSE=1; shift ;;
    --timeout)        TIMEOUT="$2"; shift 2 ;;
    -h|--help)        usage ;;
    *)                echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Resolve API URL from environment if not explicitly provided.
if [[ -z "$API_URL" ]]; then
  case "$ENVIRONMENT" in
    production) API_URL="https://simple-house-api.a-tekhtelev.workers.dev" ;;
    staging)    API_URL="https://simple-house-api-staging.a-tekhtelev.workers.dev" ;;
    local)      API_URL="http://localhost:8787" ;;
    *) echo "Unknown environment: $ENVIRONMENT (use staging|production|local)" >&2; exit 2 ;;
  esac
fi

case "$MODE" in
  smoke|auth|all) ;;
  *) echo "Invalid --mode: $MODE (use smoke|auth|all)" >&2; exit 2 ;;
esac

command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [[ -t 1 && "$JSON_OUTPUT" -eq 0 ]]; then
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_DIM=""; C_RESET=""
fi

log()  { [[ "$JSON_OUTPUT" -eq 0 ]] && echo "$*"; }
info() { [[ "$JSON_OUTPUT" -eq 0 ]] && echo "${C_BLUE}$*${C_RESET}"; }
warn() { [[ "$JSON_OUTPUT" -eq 0 ]] && echo "${C_YELLOW}$*${C_RESET}" >&2; }
err()  { echo "${C_RED}$*${C_RESET}" >&2; }

# Counters and result store (parallel arrays, indexed by test number).
TOTAL=0
PASSED=0
FAILED=0
SKIPPED=0
declare -a R_NAMES R_METHODS R_PATHS R_EXPECTED R_ACTUAL R_STATUS R_CATEGORY R_MS

# ---------------------------------------------------------------------------
# HTTP helper. Returns "<http_code>|<elapsed_ms>" on stdout.
# ---------------------------------------------------------------------------

http_call() {
  local method="$1" path="$2" use_auth="$3" body="${4:-}"
  local url="${API_URL}${path}"
  local hdr_auth=()
  if [[ "$use_auth" == "1" && -n "$TEST_AUTH_TOKEN" ]]; then
    hdr_auth=(-H "Authorization: Bearer ${TEST_AUTH_TOKEN}")
  fi

  local out code total_s elapsed_ms
  # curl emits "<http_code> <total_time_seconds>"; we parse both. -w handles
  # timing in a portable way across macOS/Linux without relying on `date +%N`.
  if [[ "$method" == "GET" || "$method" == "DELETE" ]]; then
    out=$(curl -sS -o /dev/null -w "%{http_code} %{time_total}" \
      --max-time "$TIMEOUT" \
      -X "$method" "${hdr_auth[@]}" "$url" 2>/dev/null) || out="000 0"
  else
    out=$(curl -sS -o /dev/null -w "%{http_code} %{time_total}" \
      --max-time "$TIMEOUT" \
      -X "$method" "${hdr_auth[@]}" \
      -H "Content-Type: application/json" \
      -d "${body:-{\}}" "$url" 2>/dev/null) || out="000 0"
  fi
  code="${out%% *}"
  total_s="${out##* }"
  elapsed_ms=$(awk -v t="$total_s" 'BEGIN{printf "%d", t*1000}')
  [[ -z "$code" ]] && code="000"
  echo "${code}|${elapsed_ms}"
}

# ---------------------------------------------------------------------------
# Test executor.
#   run_test METHOD PATH KIND CATEGORY [BODY]
#
# KIND describes expected response class:
#   public-get   200
#   public-post  200,201,400,422              (missing body may 4xx)
#   public       200,201,202,204,400,422
#   protected    401                          (must require auth)
#   protected-or-public  401,200              (some routes optionally auth)
#   auth-get     200,204,400,404,422          (auth mode only — should not 401/5xx)
#   auth-mut     200,201,204,400,404,422,409  (auth mode mutating endpoint)
# ---------------------------------------------------------------------------

substitute_path() {
  local p="$1"
  p="${p//:householdId/$TEST_HOUSEHOLD_ID}"
  p="${p//:id/$TEST_RESOURCE_ID}"
  p="${p//:contractorId/$TEST_RESOURCE_ID}"
  p="${p//:visitId/$TEST_RESOURCE_ID}"
  p="${p//:taskId/$TEST_RESOURCE_ID}"
  p="${p//:projectId/$TEST_RESOURCE_ID}"
  p="${p//:milestoneId/$TEST_RESOURCE_ID}"
  p="${p//:paymentId/$TEST_RESOURCE_ID}"
  p="${p//:photoId/$TEST_RESOURCE_ID}"
  p="${p//:noteId/$TEST_RESOURCE_ID}"
  p="${p//:invitationId/$TEST_RESOURCE_ID}"
  p="${p//:memberId/$TEST_RESOURCE_ID}"
  p="${p//:sessionId/$TEST_RESOURCE_ID}"
  p="${p//:templateId/$TEST_RESOURCE_ID}"
  p="${p//:conversationId/$TEST_RESOURCE_ID}"
  p="${p//:ratingId/$TEST_RESOURCE_ID}"
  p="${p//:itemId/$TEST_RESOURCE_ID}"
  p="${p//:checklistId/$TEST_RESOURCE_ID}"
  p="${p//:subtaskId/$TEST_RESOURCE_ID}"
  p="${p//:billId/$TEST_RESOURCE_ID}"
  p="${p//:accountId/$TEST_RESOURCE_ID}"
  p="${p//:taxId/$TEST_RESOURCE_ID}"
  p="${p//:markerId/$TEST_RESOURCE_ID}"
  p="${p//:annotationId/$TEST_RESOURCE_ID}"
  p="${p//:draftId/$TEST_RESOURCE_ID}"
  p="${p//:imageKey/test-image.jpg}"
  p="${p//:filename/test.jpg}"
  p="${p//:imageId/test-image-id}"
  p="${p//:documentId/$TEST_RESOURCE_ID}"
  p="${p//:entityType/test}"
  p="${p//:entityId/$TEST_RESOURCE_ID}"
  p="${p//:termKey/test-term}"
  p="${p//:category/general}"
  p="${p//:spaceId/$TEST_RESOURCE_ID}"
  p="${p//:step/profile}"
  p="${p//:name/Vancouver}"
  p="${p//:year/2026}"
  echo "$p"
}

expected_codes_for_kind() {
  case "$1" in
    public-get)          echo "200 404" ;;
    public-post)         echo "200 201 204 400 401 403 404 409 422" ;;
    public)              echo "200 201 202 204 400 401 403 404 409 422" ;;
    protected)           echo "401" ;;
    protected-or-public) echo "401 200" ;;
    auth-get)            echo "200 204 400 404 422" ;;
    auth-mut)            echo "200 201 204 400 404 409 422" ;;
    *) echo "200" ;;
  esac
}

run_test() {
  local method="$1" raw_path="$2" kind="$3" category="$4" body="${5:-{\}}"
  local path use_auth expected actual_pair actual_code elapsed status name
  path=$(substitute_path "$raw_path")
  name="${method} ${raw_path}"

  if [[ -n "$FILTER" && ! "$name" =~ $FILTER ]]; then
    return 0
  fi

  case "$kind" in
    auth-get|auth-mut) use_auth=1 ;;
    *)                 use_auth=0 ;;
  esac

  if [[ "$use_auth" == "1" && -z "$TEST_AUTH_TOKEN" ]]; then
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  expected=$(expected_codes_for_kind "$kind")
  actual_pair=$(http_call "$method" "$path" "$use_auth" "$body")
  actual_code="${actual_pair%%|*}"
  elapsed="${actual_pair##*|}"

  status="FAIL"
  for ec in $expected; do
    if [[ "$actual_code" == "$ec" ]]; then status="PASS"; break; fi
  done
  # Treat any 5xx as a hard fail regardless of `expected` (would be a deploy regression).
  if [[ "$actual_code" =~ ^5 ]]; then status="FAIL"; fi
  # curl couldn't connect.
  if [[ "$actual_code" == "000" ]]; then status="FAIL"; fi

  TOTAL=$((TOTAL + 1))
  R_NAMES[TOTAL]="$name"
  R_METHODS[TOTAL]="$method"
  R_PATHS[TOTAL]="$path"
  R_EXPECTED[TOTAL]="$expected"
  R_ACTUAL[TOTAL]="$actual_code"
  R_STATUS[TOTAL]="$status"
  R_CATEGORY[TOTAL]="$category"
  R_MS[TOTAL]="$elapsed"

  if [[ "$status" == "PASS" ]]; then
    PASSED=$((PASSED + 1))
    if [[ "$JSON_OUTPUT" -eq 0 ]]; then
      printf "  ${C_GREEN}✓${C_RESET} %-6s %-70s ${C_DIM}[%s, %sms]${C_RESET}\n" \
        "$method" "$raw_path" "$actual_code" "$elapsed"
    fi
  else
    FAILED=$((FAILED + 1))
    if [[ "$JSON_OUTPUT" -eq 0 ]]; then
      printf "  ${C_RED}✗${C_RESET} %-6s %-70s ${C_RED}[got %s, want %s]${C_RESET}\n" \
        "$method" "$raw_path" "$actual_code" "$expected"
      [[ "$VERBOSE" -eq 1 ]] && echo "      url: ${API_URL}${path}"
    fi
    if [[ "$FAIL_FAST" -eq 1 ]]; then
      finalize
      exit 1
    fi
  fi
}

# ---------------------------------------------------------------------------
# Authentication setup (auth + all modes).
# ---------------------------------------------------------------------------

login_and_get_token() {
  if [[ -n "$TEST_AUTH_TOKEN" ]]; then
    info "Using provided TEST_AUTH_TOKEN"
    return 0
  fi
  if [[ -z "$TEST_EMAIL" || -z "$TEST_PASSWORD" ]]; then
    warn "auth mode requested but no TEST_AUTH_TOKEN / TEST_EMAIL+TEST_PASSWORD provided — skipping authenticated tests"
    return 1
  fi
  info "Logging in as $TEST_EMAIL"
  local resp http_code body
  resp=$(curl -sS -w "\n%{http_code}" \
    --max-time "$TIMEOUT" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}" \
    "${API_URL}/auth/login" 2>/dev/null) || true
  http_code=$(echo "$resp" | tail -n1)
  body=$(echo "$resp" | sed '$d')
  if [[ "$http_code" != "200" ]]; then
    err "Login failed (HTTP $http_code). Cannot run authenticated tests."
    return 1
  fi
  TEST_AUTH_TOKEN=$(echo "$body" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [[ -z "$TEST_AUTH_TOKEN" ]]; then
    err "Login succeeded but couldn't extract access_token from response."
    return 1
  fi
  info "Login successful"
  return 0
}

# ---------------------------------------------------------------------------
# Route registry — every endpoint mounted in backend/src/index.ts.
# Format: run_test METHOD PATH KIND CATEGORY
#
# Updates: when adding/removing routes in the backend, update this list.
# ---------------------------------------------------------------------------

run_smoke_tests() {
  info "=== Public / health ==="
  run_test GET  "/"                                                    public-get   "health"
  run_test GET  "/health"                                              public-get   "health"
  run_test GET  "/.well-known/apple-app-site-association"              public-get   "health"
  run_test GET  "/.well-known/assetlinks.json"                         public-get   "health"

  info "=== Auth ==="
  run_test POST "/auth/test"           public-post "auth" '{"ok":true}'
  run_test POST "/auth/register"       public-post "auth" '{"email":"smoke-test@example.com","password":"WrongPass123!","display_name":"Smoke"}'
  run_test POST "/auth/login"          public-post "auth" '{"email":"smoke-test@example.com","password":"WrongPass123!"}'
  run_test POST "/auth/refresh"        public-post "auth" '{"refresh_token":"invalid-smoke-token"}'
  run_test POST "/auth/logout"         public-post "auth" '{"refresh_token":"invalid-smoke-token"}'
  run_test POST "/auth/forgot-password" public-post "auth" '{"email":"smoke-test@example.com"}'
  run_test POST "/auth/reset-password" public-post "auth" '{"token":"invalid","password":"NewPass123!"}'
  run_test POST "/auth/verify-email"   public-post "auth" '{"token":"invalid-smoke-token"}'
  run_test POST "/auth/apple"          public-post "auth" '{"identity_token":"invalid","authorization_code":"invalid"}'
  run_test POST "/auth/google"         public-post "auth" '{"id_token":"invalid"}'
  run_test POST "/auth/resend-verification"                            protected    "auth"
  run_test POST "/auth/change-password"                                protected    "auth"
  run_test POST "/auth/accept-terms"                                   protected    "auth"
  run_test DELETE "/auth/account"                                      protected    "auth"

  info "=== Users ==="
  run_test GET    "/users/me"                                          protected    "users"
  run_test PATCH  "/users/me"                                          protected    "users"
  run_test GET    "/users/me/sessions"                                 protected    "users"
  run_test DELETE "/users/me/sessions"                                 protected    "users"
  run_test DELETE "/users/me/sessions/:sessionId"                      protected    "users"
  run_test GET    "/users/:id"                                         protected    "users"
  run_test GET    "/users/me/onboarding"                               protected    "users"
  run_test POST   "/users/me/onboarding/:step"                         protected    "users"

  info "=== Households ==="
  run_test GET    "/households"                                        protected    "households"
  run_test POST   "/households"                                        protected    "households"
  run_test GET    "/households/:id"                                    protected    "households"
  run_test PATCH  "/households/:id"                                    protected    "households"
  run_test DELETE "/households/:id"                                    protected    "households"
  run_test POST   "/households/:id/invite"                             protected    "households"
  run_test GET    "/households/:id/invitations"                        protected    "households"
  run_test DELETE "/households/:id/invitations/:invitationId"          protected    "households"
  run_test DELETE "/households/:id/members/:memberId"                  protected    "households"
  run_test PATCH  "/households/:id/members/:memberId"                  protected    "households"
  run_test POST   "/households/:id/photo/upload-url"                   protected    "households"
  run_test PUT    "/households/:id/photo"                              protected    "households"
  run_test DELETE "/households/:id/photo"                              protected    "households"

  info "=== Spaces ==="
  run_test GET    "/households/:householdId/spaces"                    protected    "spaces"
  run_test GET    "/households/:householdId/spaces/presets"            protected    "spaces"
  run_test POST   "/households/:householdId/spaces"                    protected    "spaces"
  run_test POST   "/households/:householdId/spaces/bulk"               protected    "spaces"
  run_test GET    "/households/:householdId/spaces/:id"                protected    "spaces"
  run_test PATCH  "/households/:householdId/spaces/:id"                protected    "spaces"
  run_test DELETE "/households/:householdId/spaces/:id"                protected    "spaces"
  run_test POST   "/households/:householdId/spaces/reorder"            protected    "spaces"

  info "=== Invitations ==="
  run_test POST   "/invitations/validate"                              protected    "invitations"
  run_test POST   "/invitations/accept"                                protected    "invitations"

  info "=== Reports ==="
  run_test POST   "/households/:householdId/reports/upload-url"        protected    "reports"
  run_test PUT    "/households/:householdId/reports/:id/upload"        protected    "reports"
  run_test POST   "/households/:householdId/reports/:id/confirm-upload" protected   "reports"
  run_test POST   "/households/:householdId/reports/:id/process"       protected    "reports"
  run_test POST   "/households/:householdId/reports/:id/process-sync"  protected    "reports"
  run_test POST   "/households/:householdId/reports/:id/process-enhanced" protected "reports"
  run_test GET    "/households/:householdId/reports/:id/status"        protected    "reports"
  run_test GET    "/households/:householdId/reports/:id/summaries"     protected    "reports"
  run_test GET    "/households/:householdId/reports"                   protected    "reports"
  run_test GET    "/households/:householdId/reports/:id"               protected    "reports"
  run_test GET    "/households/:householdId/reports/:id/pdf-url"       protected    "reports"
  run_test GET    "/households/:householdId/reports/:id/pdf"           protected    "reports"
  run_test GET    "/households/:householdId/reports/:id/findings"      protected    "reports"
  run_test GET    "/households/:householdId/reports/:id/action-plans"  protected    "reports"
  run_test DELETE "/households/:householdId/reports/:id"               protected    "reports"

  info "=== Action items ==="
  run_test GET    "/households/:householdId/action-items"              protected    "action-items"
  run_test GET    "/households/:householdId/action-items/summary"      protected    "action-items"
  run_test GET    "/households/:householdId/action-items/:id"          protected    "action-items"
  run_test PATCH  "/households/:householdId/action-items/:id"          protected    "action-items"

  info "=== Maintenance ==="
  run_test GET    "/households/:householdId/maintenance-tasks"                 protected "maintenance"
  run_test GET    "/households/:householdId/maintenance-tasks/upcoming"        protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks"                 protected "maintenance"
  run_test GET    "/households/:householdId/maintenance-tasks/:id"             protected "maintenance"
  run_test PATCH  "/households/:householdId/maintenance-tasks/:id"             protected "maintenance"
  run_test DELETE "/households/:householdId/maintenance-tasks/:id"             protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:id/complete"    protected "maintenance"
  run_test GET    "/households/:householdId/maintenance-tasks/:id/history"     protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:id/snooze"      protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:id/clear-snooze" protected "maintenance"
  run_test GET    "/households/:householdId/maintenance-tasks/:taskId/quotes"  protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/quotes/request"     protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/quotes/compare-ai"  protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/select-quote"       protected "maintenance"
  run_test PATCH  "/households/:householdId/maintenance-tasks/:taskId/workflow-stage"     protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/schedule-work"      protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/photos/upload-url"          protected "maintenance"
  run_test PUT    "/households/:householdId/maintenance-tasks/photos/:photoId/upload"     protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/subtasks"           protected "maintenance"
  run_test GET    "/households/:householdId/maintenance-tasks/:taskId/subtasks"           protected "maintenance"
  run_test GET    "/households/:householdId/maintenance-tasks/:taskId/subtasks/:subtaskId" protected "maintenance"
  run_test PATCH  "/households/:householdId/maintenance-tasks/:taskId/subtasks/:subtaskId" protected "maintenance"
  run_test DELETE "/households/:householdId/maintenance-tasks/:taskId/subtasks/:subtaskId" protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/subtasks/:subtaskId/complete"   protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/subtasks/:subtaskId/uncomplete" protected "maintenance"
  run_test POST   "/households/:householdId/maintenance-tasks/:taskId/subtasks/reorder"   protected "maintenance"

  info "=== Garbage / municipalities ==="
  run_test GET    "/municipalities"                                    public-get   "municipalities"
  run_test GET    "/municipalities/:name"                              public-get   "municipalities"
  run_test GET    "/municipalities/:name/waste-regulations"            public-get   "municipalities"
  run_test GET    "/households/:householdId/garbage-collection"        protected    "garbage"
  run_test POST   "/households/:householdId/garbage-collection"        protected    "garbage"
  run_test GET    "/households/:householdId/garbage-collection/:id"    protected    "garbage"
  run_test GET    "/households/:householdId/garbage-collection/:id/next-collections" protected "garbage"
  run_test PATCH  "/households/:householdId/garbage-collection/:id"    protected    "garbage"
  run_test PATCH  "/households/:householdId/garbage-collection/:id/reminders" protected "garbage"

  info "=== Templates ==="
  run_test GET    "/maintenance-templates"                             protected    "templates"
  run_test GET    "/maintenance-templates/categories"                  protected    "templates"
  run_test GET    "/maintenance-templates/:id"                         protected    "templates"
  run_test GET    "/households/:householdId/maintenance-templates"     protected    "templates"
  run_test GET    "/households/:householdId/maintenance-templates/categories" protected "templates"
  run_test GET    "/households/:householdId/maintenance-templates/:id" protected    "templates"

  info "=== Appliances ==="
  run_test GET    "/households/:householdId/appliances"                protected    "appliances"
  run_test POST   "/households/:householdId/appliances"                protected    "appliances"
  run_test GET    "/households/:householdId/appliances/:id"            protected    "appliances"
  run_test PATCH  "/households/:householdId/appliances/:id"            protected    "appliances"
  run_test DELETE "/households/:householdId/appliances/:id"            protected    "appliances"
  run_test GET    "/households/:householdId/appliances/:id/documents"  protected    "appliances"
  run_test POST   "/households/:householdId/appliances/:id/documents"  protected    "appliances"
  run_test GET    "/households/:householdId/appliances/:id/service-history" protected "appliances"
  run_test POST   "/households/:householdId/appliances/:id/service-history" protected "appliances"

  info "=== Seasonal checklists ==="
  run_test GET    "/households/:householdId/seasonal-checklists"                      protected "seasonal"
  run_test POST   "/households/:householdId/seasonal-checklists"                      protected "seasonal"
  run_test GET    "/households/:householdId/seasonal-checklists/current"              protected "seasonal"
  run_test GET    "/households/:householdId/seasonal-checklists/:id"                  protected "seasonal"
  run_test POST   "/households/:householdId/seasonal-checklists/:id/items"            protected "seasonal"
  run_test PATCH  "/households/:householdId/seasonal-checklists/:checklistId/items/:itemId" protected "seasonal"

  info "=== Service providers ==="
  run_test GET    "/service-providers"                                 public-get   "service-providers"
  run_test GET    "/service-providers/:id"                             public-get   "service-providers"
  run_test GET    "/service-providers/:id/reviews"                     public-get   "service-providers"
  run_test POST   "/households/:householdId/service-providers/:id/reviews" protected "service-providers"

  info "=== Contractors ==="
  run_test GET    "/households/:householdId/contractors/test"                          protected "contractors"
  run_test GET    "/households/:householdId/contractors"                               protected "contractors"
  run_test POST   "/households/:householdId/contractors"                               protected "contractors"
  run_test GET    "/households/:householdId/contractors/:id"                           protected "contractors"
  run_test PATCH  "/households/:householdId/contractors/:id"                           protected "contractors"
  run_test DELETE "/households/:householdId/contractors/:id"                           protected "contractors"
  run_test GET    "/households/:householdId/contractors/visits"                        protected "contractors"
  run_test GET    "/households/:householdId/contractors/:contractorId/visits"          protected "contractors"
  run_test POST   "/households/:householdId/contractors/:contractorId/visits"          protected "contractors"
  run_test PATCH  "/households/:householdId/contractors/visits/:visitId"               protected "contractors"
  run_test DELETE "/households/:householdId/contractors/visits/:visitId"               protected "contractors"
  run_test POST   "/households/:householdId/contractors/visits/:visitId/start"         protected "contractors"
  run_test POST   "/households/:householdId/contractors/visits/:visitId/complete"      protected "contractors"
  run_test POST   "/households/:householdId/contractors/visits/:visitId/request-receipt" protected "contractors"
  run_test POST   "/households/:householdId/contractors/visits/:visitId/receipt-reminder-task" protected "contractors"
  run_test GET    "/households/:householdId/contractors/documents"                     protected "contractors"
  run_test GET    "/households/:householdId/contractors/:contractorId/documents"       protected "contractors"
  run_test POST   "/households/:householdId/contractors/documents/upload"              protected "contractors"
  run_test POST   "/households/:householdId/contractors/documents/upload-url"          protected "contractors"
  run_test POST   "/households/:householdId/contractors/documents"                     protected "contractors"
  run_test GET    "/households/:householdId/contractors/documents/:documentId/download" protected "contractors"
  run_test DELETE "/households/:householdId/contractors/documents/:documentId"         protected "contractors"
  run_test POST   "/households/:householdId/contractors/ai-lookup"                     protected "contractors"
  run_test POST   "/households/:householdId/contractors/search"                        protected "contractors"
  run_test POST   "/households/:householdId/contractors/generate-email"                protected "contractors"
  run_test POST   "/households/:householdId/contractors/send-email"                    protected "contractors"

  info "=== Representatives ==="
  run_test GET    "/households/:householdId/contractors/:contractorId/representatives"        protected "representatives"
  run_test POST   "/households/:householdId/contractors/:contractorId/representatives"        protected "representatives"
  run_test GET    "/households/:householdId/contractors/:contractorId/representatives/:id"    protected "representatives"
  run_test PATCH  "/households/:householdId/contractors/:contractorId/representatives/:id"    protected "representatives"
  run_test DELETE "/households/:householdId/contractors/:contractorId/representatives/:id"    protected "representatives"
  run_test POST   "/households/:householdId/contractors/:contractorId/representatives/:id/set-primary" protected "representatives"

  info "=== Ratings ==="
  run_test GET    "/households/:householdId/contractors/:contractorId/ratings"          protected "ratings"
  run_test GET    "/households/:householdId/contractors/:contractorId/ratings/summary"  protected "ratings"
  run_test GET    "/households/:householdId/contractors/:contractorId/ratings/:ratingId" protected "ratings"
  run_test POST   "/households/:householdId/contractors/:contractorId/ratings"          protected "ratings"
  run_test PATCH  "/households/:householdId/contractors/:contractorId/ratings/:ratingId" protected "ratings"
  run_test DELETE "/households/:householdId/contractors/:contractorId/ratings/:ratingId" protected "ratings"

  info "=== Chat ==="
  run_test POST   "/households/:householdId/chat"                                  protected "chat"
  run_test GET    "/households/:householdId/chat/suggestions"                      protected "chat"

  info "=== Checklists ==="
  run_test GET    "/households/:householdId/checklists"                            protected "checklists"
  run_test POST   "/households/:householdId/checklists"                            protected "checklists"
  run_test DELETE "/households/:householdId/checklists/:id"                        protected "checklists"
  run_test GET    "/households/:householdId/checklists/progress"                   protected "checklists"
  run_test GET    "/households/:householdId/checklists/:id/current"                protected "checklists"
  run_test POST   "/households/:householdId/checklists/instances/:id/items/:itemId/complete"   protected "checklists"
  run_test DELETE "/households/:householdId/checklists/instances/:id/items/:itemId/complete"   protected "checklists"
  run_test POST   "/households/:householdId/checklists/create-defaults"            protected "checklists"

  info "=== Appointments ==="
  run_test GET    "/households/:householdId/appointments"                          protected "appointments"
  run_test GET    "/households/:householdId/appointments/upcoming"                 protected "appointments"
  run_test GET    "/households/:householdId/appointments/calendar"                 protected "appointments"
  run_test GET    "/households/:householdId/appointments/:id"                      protected "appointments"
  run_test POST   "/households/:householdId/appointments"                          protected "appointments"
  run_test PATCH  "/households/:householdId/appointments/:id"                      protected "appointments"
  run_test DELETE "/households/:householdId/appointments/:id"                      protected "appointments"
  run_test POST   "/households/:householdId/appointments/:id/confirm"              protected "appointments"
  run_test POST   "/households/:householdId/appointments/:id/cancel"               protected "appointments"
  run_test POST   "/households/:householdId/appointments/:id/reschedule"           protected "appointments"
  run_test POST   "/households/:householdId/appointments/:id/start"                protected "appointments"
  run_test POST   "/households/:householdId/appointments/:id/complete"             protected "appointments"
  run_test POST   "/households/:householdId/appointments/:id/no-show"              protected "appointments"

  info "=== Quotes ==="
  run_test GET    "/households/:householdId/quotes"                                protected "quotes"
  run_test GET    "/households/:householdId/quotes/pending"                        protected "quotes"
  run_test GET    "/households/:householdId/quotes/:id"                            protected "quotes"
  run_test POST   "/households/:householdId/quotes"                                protected "quotes"
  run_test POST   "/households/:householdId/quotes/request"                        protected "quotes"
  run_test POST   "/households/:householdId/quotes/compare"                        protected "quotes"
  run_test POST   "/households/:householdId/quotes/compare-ai"                     protected "quotes"
  run_test PATCH  "/households/:householdId/quotes/:id"                            protected "quotes"
  run_test DELETE "/households/:householdId/quotes/:id"                            protected "quotes"
  run_test POST   "/households/:householdId/quotes/:id/accept"                     protected "quotes"
  run_test POST   "/households/:householdId/quotes/:id/decline"                    protected "quotes"
  run_test POST   "/households/:householdId/quotes/:id/mark-received"              protected "quotes"
  run_test GET    "/households/:householdId/quotes/:id/document"                   protected "quotes"

  info "=== Projects ==="
  run_test GET    "/households/:householdId/projects"                              protected "projects"
  run_test GET    "/households/:householdId/projects/active"                       protected "projects"
  run_test GET    "/households/:householdId/projects/:id"                          protected "projects"
  run_test POST   "/households/:householdId/projects"                              protected "projects"
  run_test PATCH  "/households/:householdId/projects/:id"                          protected "projects"
  run_test DELETE "/households/:householdId/projects/:id"                          protected "projects"
  run_test GET    "/households/:householdId/projects/:projectId/milestones"        protected "projects"
  run_test POST   "/households/:householdId/projects/:projectId/milestones"        protected "projects"
  run_test PATCH  "/households/:householdId/projects/:projectId/milestones/:milestoneId" protected "projects"
  run_test DELETE "/households/:householdId/projects/:projectId/milestones/:milestoneId" protected "projects"
  run_test POST   "/households/:householdId/projects/:projectId/milestones/:milestoneId/complete" protected "projects"
  run_test GET    "/households/:householdId/projects/:projectId/payments"          protected "projects"
  run_test POST   "/households/:householdId/projects/:projectId/payments"          protected "projects"
  run_test PATCH  "/households/:householdId/projects/:projectId/payments/:paymentId" protected "projects"
  run_test POST   "/households/:householdId/projects/:projectId/payments/:paymentId/mark-paid" protected "projects"
  run_test GET    "/households/:householdId/projects/:projectId/photos"            protected "projects"
  run_test POST   "/households/:householdId/projects/:projectId/photos"            protected "projects"
  run_test DELETE "/households/:householdId/projects/:projectId/photos/:photoId"   protected "projects"

  info "=== Visit checklists ==="
  run_test GET    "/households/:householdId/visit-checklists"                      protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/:id"                  protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists"                      protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/from-template/:templateId" protected "visit-checklists"
  run_test PATCH  "/households/:householdId/visit-checklists/:id"                  protected "visit-checklists"
  run_test DELETE "/households/:householdId/visit-checklists/:id"                  protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/:id/items"            protected "visit-checklists"
  run_test PATCH  "/households/:householdId/visit-checklists/:id/items/:itemId"    protected "visit-checklists"
  run_test DELETE "/households/:householdId/visit-checklists/:id/items/:itemId"    protected "visit-checklists"
  run_test PUT    "/households/:householdId/visit-checklists/:id/items/:itemId/check" protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/:id/items/:itemId/voice-note" protected "visit-checklists"
  run_test PUT    "/households/:householdId/visit-checklists/:id/reorder"          protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/templates/all"        protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/templates/category/:category" protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/templates/:templateId" protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/ai/conversation"      protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/ai/conversation/:conversationId/message" protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/technical-terms/:termKey" protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/:id/generate-ai-suggestions" protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/:id/items/:itemId/accept" protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/:id/items/:itemId/dismiss" protected "visit-checklists"
  run_test POST   "/households/:householdId/visit-checklists/:id/items/:itemId/photos" protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/:id/items/:itemId/photos" protected "visit-checklists"
  run_test DELETE "/households/:householdId/visit-checklists/:id/items/:itemId/photos/:photoId" protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/for-task/:taskId"     protected "visit-checklists"
  run_test GET    "/households/:householdId/visit-checklists/comparison/:taskId"   protected "visit-checklists"

  info "=== Visit notes ==="
  run_test GET    "/households/:householdId/visits/:visitId/notes"                 protected "visit-notes"
  run_test GET    "/households/:householdId/visits/:visitId/notes/grouped"         protected "visit-notes"
  run_test GET    "/households/:householdId/visits/:visitId/notes/timeline"        protected "visit-notes"
  run_test GET    "/households/:householdId/visits/:visitId/notes/:noteId"         protected "visit-notes"
  run_test POST   "/households/:householdId/visits/:visitId/notes"                 protected "visit-notes"
  run_test POST   "/households/:householdId/visits/:visitId/notes/text"            protected "visit-notes"
  run_test POST   "/households/:householdId/visits/:visitId/notes/photo"           protected "visit-notes"
  run_test POST   "/households/:householdId/visits/:visitId/notes/voice"           protected "visit-notes"
  run_test PATCH  "/households/:householdId/visits/:visitId/notes/:noteId"         protected "visit-notes"
  run_test POST   "/households/:householdId/visits/:visitId/notes/:noteId/transcription" protected "visit-notes"
  run_test POST   "/households/:householdId/visits/:visitId/notes/:noteId/tags"    protected "visit-notes"
  run_test DELETE "/households/:householdId/visits/:visitId/notes/:noteId/tags"    protected "visit-notes"
  run_test DELETE "/households/:householdId/visits/:visitId/notes/:noteId"         protected "visit-notes"
  run_test GET    "/households/:householdId/notes"                                 protected "visit-notes"
  run_test GET    "/households/:householdId/notes/search"                          protected "visit-notes"

  info "=== Messages ==="
  run_test GET    "/households/:householdId/messages"                              protected "messages"
  run_test GET    "/households/:householdId/messages/conversations"                protected "messages"
  run_test GET    "/households/:householdId/messages/conversation/:contractorId"   protected "messages"
  run_test GET    "/households/:householdId/messages/:id"                          protected "messages"
  run_test POST   "/households/:householdId/messages"                              protected "messages"
  run_test POST   "/households/:householdId/messages/:id/read"                     protected "messages"
  run_test POST   "/households/:householdId/messages/conversation/:contractorId/read" protected "messages"
  run_test DELETE "/households/:householdId/messages/:id"                          protected "messages"
  run_test GET    "/households/:householdId/messages/templates/all"                protected "messages"
  run_test GET    "/households/:householdId/messages/templates/:templateId"        protected "messages"
  run_test POST   "/households/:householdId/messages/templates/:templateId/apply"  protected "messages"

  info "=== Notifications ==="
  run_test POST   "/notifications/tokens"                                          protected "notifications"
  run_test DELETE "/notifications/tokens"                                          protected "notifications"
  run_test GET    "/notifications/tokens"                                          protected "notifications"
  run_test GET    "/notifications/preferences"                                     protected "notifications"
  run_test PATCH  "/notifications/preferences"                                     protected "notifications"
  run_test GET    "/notifications/history"                                         protected "notifications"
  run_test GET    "/notifications/unread-count"                                    protected "notifications"
  run_test POST   "/notifications/:id/read"                                        protected "notifications"
  run_test POST   "/notifications/read-all"                                        protected "notifications"
  run_test GET    "/notifications/overrides"                                       protected "notifications"
  run_test POST   "/notifications/overrides"                                       protected "notifications"
  run_test GET    "/notifications/overrides/:id"                                   protected "notifications"
  run_test PATCH  "/notifications/overrides/:id"                                   protected "notifications"
  run_test DELETE "/notifications/overrides/:id"                                   protected "notifications"
  run_test PUT    "/notifications/overrides/category/:category"                    protected "notifications"
  run_test PUT    "/notifications/overrides/space/:spaceId"                        protected "notifications"

  info "=== Jobs ==="
  run_test GET    "/jobs/:id"                                                      protected "jobs"

  info "=== Subscriptions ==="
  run_test GET    "/subscriptions/me"                                              protected "subscriptions"
  run_test GET    "/subscriptions/plans"                                           protected "subscriptions"
  run_test GET    "/subscriptions/limits"                                          protected "subscriptions"
  run_test POST   "/subscriptions/checkout"                                        protected "subscriptions"
  run_test POST   "/subscriptions/portal"                                          protected "subscriptions"
  run_test POST   "/subscriptions/cancel"                                          protected "subscriptions"
  run_test POST   "/subscriptions/reactivate"                                      protected "subscriptions"

  info "=== Budget ==="
  run_test GET    "/households/:householdId/budget/categories"                     protected "budget"
  run_test GET    "/households/:householdId/budget/timeline"                       protected "budget"
  run_test POST   "/households/:householdId/budget/items"                          protected "budget"
  run_test PATCH  "/households/:householdId/budget/items/:id"                      protected "budget"
  run_test DELETE "/households/:householdId/budget/items/:id"                      protected "budget"
  run_test POST   "/households/:householdId/budget/sync-action-items"              protected "budget"
  run_test POST   "/households/:householdId/budget/expenses"                       protected "budget"
  run_test GET    "/households/:householdId/budget/expenses"                       protected "budget"

  info "=== Utilities ==="
  run_test GET    "/utilities/providers"                                           public-get "utilities"
  run_test POST   "/utilities/calculate-homeowner-grant"                           public-post "utilities"
  run_test GET    "/households/:householdId/utilities/municipality"                protected "utilities"
  run_test POST   "/households/:householdId/utilities/accounts"                    protected "utilities"
  run_test GET    "/households/:householdId/utilities/accounts"                    protected "utilities"
  run_test PATCH  "/households/:householdId/utilities/accounts/:accountId"         protected "utilities"
  run_test DELETE "/households/:householdId/utilities/accounts/:accountId"         protected "utilities"
  run_test POST   "/households/:householdId/utilities/bills"                       protected "utilities"
  run_test GET    "/households/:householdId/utilities/bills"                       protected "utilities"
  run_test PATCH  "/households/:householdId/utilities/bills/:billId"               protected "utilities"
  run_test DELETE "/households/:householdId/utilities/bills/:billId"               protected "utilities"
  run_test POST   "/households/:householdId/utilities/property-taxes"              protected "utilities"
  run_test GET    "/households/:householdId/utilities/property-taxes"              protected "utilities"
  run_test GET    "/households/:householdId/utilities/property-taxes/:year"        protected "utilities"
  run_test PATCH  "/households/:householdId/utilities/property-taxes/:taxId"       protected "utilities"
  run_test POST   "/households/:householdId/utilities/property-taxes/:taxId/calculate-penalties" protected "utilities"
  run_test POST   "/households/:householdId/utilities/property-taxes/calculate-due-date" protected "utilities"
  run_test POST   "/households/:householdId/utilities/bc-assessment"               protected "utilities"
  run_test GET    "/households/:householdId/utilities/bc-assessment"               protected "utilities"
  run_test GET    "/households/:householdId/utilities/dashboard"                   protected "utilities"
  run_test GET    "/households/:householdId/utilities/analytics"                   protected "utilities"
  run_test POST   "/households/:householdId/utilities/analytics/calculate-trends"  protected "utilities"
  run_test POST   "/households/:householdId/utilities/bills/:billId/reminders"     protected "utilities"
  run_test DELETE "/households/:householdId/utilities/bills/:billId/reminders"     protected "utilities"
  run_test GET    "/households/:householdId/utilities/reminders"                   protected "utilities"
  run_test POST   "/households/:householdId/utilities/bills/upload"                protected "utilities"
  run_test POST   "/households/:householdId/utilities/bills/extract"               protected "utilities"

  info "=== Task drafts ==="
  run_test GET    "/households/:householdId/task-drafts"                           protected "task-drafts"
  run_test GET    "/households/:householdId/task-drafts/summary"                   protected "task-drafts"
  run_test POST   "/households/:householdId/task-drafts/generate"                  protected "task-drafts"
  run_test POST   "/households/:householdId/task-drafts/bulk-convert"              protected "task-drafts"
  run_test GET    "/households/:householdId/task-drafts/:id"                       protected "task-drafts"
  run_test POST   "/households/:householdId/task-drafts/:id/convert"               protected "task-drafts"
  run_test POST   "/households/:householdId/task-drafts/:id/dismiss"               protected "task-drafts"
  run_test DELETE "/households/:householdId/task-drafts/:id"                       protected "task-drafts"

  info "=== Home features / maintenance suggestions ==="
  run_test GET    "/households/:householdId/home-features"                         protected "home-features"
  run_test POST   "/households/:householdId/home-features"                         protected "home-features"
  run_test POST   "/households/:householdId/home-features/bulk"                    protected "home-features"
  run_test GET    "/households/:householdId/home-features/:id"                     protected "home-features"
  run_test GET    "/households/:householdId/maintenance-suggestions"               protected "home-features"
  run_test POST   "/households/:householdId/maintenance-suggestions/generate"      protected "home-features"
  run_test POST   "/households/:householdId/maintenance-suggestions/apply"         protected "home-features"
  run_test POST   "/households/:householdId/maintenance-suggestions/:id/dismiss"   protected "home-features"

  info "=== Floor plans ==="
  run_test POST   "/households/:householdId/floor-plans/upload-url"                protected "floor-plans"
  run_test PUT    "/households/:householdId/floor-plans/:id/upload"                protected "floor-plans"
  run_test POST   "/households/:householdId/floor-plans/:id/confirm-upload"        protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans"                           protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/:id"                       protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/:id/status"                protected "floor-plans"
  run_test POST   "/households/:householdId/floor-plans/:id/analyze"               protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/:id/analysis"              protected "floor-plans"
  run_test POST   "/households/:householdId/floor-plans/:id/vectorize"             protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/:id/vector"                protected "floor-plans"
  run_test PATCH  "/households/:householdId/floor-plans/:id/analysis"              protected "floor-plans"
  run_test PATCH  "/households/:householdId/floor-plans/:id"                       protected "floor-plans"
  run_test DELETE "/households/:householdId/floor-plans/:id"                       protected "floor-plans"
  run_test POST   "/households/:householdId/floor-plans/:id/calibrate-scale"       protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/:id/markers"               protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/markers-for-entity"        protected "floor-plans"
  run_test POST   "/households/:householdId/floor-plans/:id/markers"               protected "floor-plans"
  run_test PATCH  "/households/:householdId/floor-plans/markers/:markerId"         protected "floor-plans"
  run_test DELETE "/households/:householdId/floor-plans/markers/:markerId"         protected "floor-plans"
  run_test GET    "/households/:householdId/floor-plans/:id/annotations"           protected "floor-plans"
  run_test POST   "/households/:householdId/floor-plans/:id/annotations"           protected "floor-plans"
  run_test DELETE "/households/:householdId/floor-plans/annotations/:annotationId" protected "floor-plans"

  info "=== Garden plans ==="
  run_test POST   "/households/:householdId/garden-plans/upload-url"               protected "garden-plans"
  run_test PUT    "/households/:householdId/garden-plans/:id/upload"               protected "garden-plans"
  run_test POST   "/households/:householdId/garden-plans/:id/confirm-upload"       protected "garden-plans"
  run_test POST   "/households/:householdId/garden-plans/boundary-drafts"          protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans/boundary-drafts"          protected "garden-plans"
  run_test PATCH  "/households/:householdId/garden-plans/boundary-drafts/:draftId/boundary" protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans/boundary-drafts/:draftId" protected "garden-plans"
  run_test DELETE "/households/:householdId/garden-plans/boundary-drafts/:draftId" protected "garden-plans"
  run_test POST   "/households/:householdId/garden-plans/boundary-drafts/:draftId/generate" protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans"                          protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans/:id"                      protected "garden-plans"
  run_test PATCH  "/households/:householdId/garden-plans/:id/boundary"             protected "garden-plans"
  run_test PATCH  "/households/:householdId/garden-plans/:id"                      protected "garden-plans"
  run_test DELETE "/households/:householdId/garden-plans/:id"                      protected "garden-plans"
  run_test POST   "/households/:householdId/garden-plans/:id/cancel"               protected "garden-plans"
  run_test POST   "/households/:householdId/garden-plans/:id/retry"                protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans/:id/objects"              protected "garden-plans"
  run_test PUT    "/households/:householdId/garden-plans/:id/objects"              protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans/:id/markers"              protected "garden-plans"
  run_test POST   "/households/:householdId/garden-plans/:id/markers"              protected "garden-plans"
  run_test PATCH  "/households/:householdId/garden-plans/markers/:markerId"        protected "garden-plans"
  run_test DELETE "/households/:householdId/garden-plans/markers/:markerId"        protected "garden-plans"
  run_test GET    "/households/:householdId/garden-plans/markers/for-entity/:entityType/:entityId" protected "garden-plans"

  info "=== Settings / AI mount points ==="
  run_test GET    "/api/settings"                                                  protected-or-public "settings"
  run_test GET    "/api/ai-housekeeper"                                            protected-or-public "ai-housekeeper"
  # /calendar and /ai are mount points without a GET / handler — exercising
  # subpaths happens via the protected routes already covered above.
}

# ---------------------------------------------------------------------------
# Authenticated GETs — only run in `auth` / `all` mode and only against
# list-style endpoints. We expect them to return without 401 / 5xx.
# ---------------------------------------------------------------------------

run_auth_tests() {
  info "=== Authenticated smoke (GET only) ==="
  run_test GET "/users/me"                                                         auth-get "users"
  run_test GET "/users/me/sessions"                                                auth-get "users"
  run_test GET "/users/me/onboarding"                                              auth-get "users"
  run_test GET "/households"                                                       auth-get "households"
  run_test GET "/households/:householdId"                                          auth-get "households"
  run_test GET "/households/:householdId/spaces"                                   auth-get "spaces"
  run_test GET "/households/:householdId/spaces/presets"                           auth-get "spaces"
  run_test GET "/households/:householdId/reports"                                  auth-get "reports"
  run_test GET "/households/:householdId/action-items"                             auth-get "action-items"
  run_test GET "/households/:householdId/action-items/summary"                     auth-get "action-items"
  run_test GET "/households/:householdId/maintenance-tasks"                        auth-get "maintenance"
  run_test GET "/households/:householdId/maintenance-tasks/upcoming"               auth-get "maintenance"
  run_test GET "/households/:householdId/garbage-collection"                       auth-get "garbage"
  run_test GET "/households/:householdId/appliances"                               auth-get "appliances"
  run_test GET "/households/:householdId/seasonal-checklists"                      auth-get "seasonal"
  run_test GET "/households/:householdId/seasonal-checklists/current"              auth-get "seasonal"
  run_test GET "/maintenance-templates"                                            auth-get "templates"
  run_test GET "/maintenance-templates/categories"                                 auth-get "templates"
  run_test GET "/households/:householdId/contractors"                              auth-get "contractors"
  run_test GET "/households/:householdId/contractors/visits"                       auth-get "contractors"
  run_test GET "/households/:householdId/contractors/documents"                    auth-get "contractors"
  run_test GET "/households/:householdId/checklists"                               auth-get "checklists"
  run_test GET "/households/:householdId/checklists/progress"                      auth-get "checklists"
  run_test GET "/households/:householdId/appointments"                             auth-get "appointments"
  run_test GET "/households/:householdId/appointments/upcoming"                    auth-get "appointments"
  run_test GET "/households/:householdId/appointments/calendar"                    auth-get "appointments"
  run_test GET "/households/:householdId/quotes"                                   auth-get "quotes"
  run_test GET "/households/:householdId/quotes/pending"                           auth-get "quotes"
  run_test GET "/households/:householdId/projects"                                 auth-get "projects"
  run_test GET "/households/:householdId/projects/active"                          auth-get "projects"
  run_test GET "/households/:householdId/visit-checklists"                         auth-get "visit-checklists"
  run_test GET "/households/:householdId/visit-checklists/templates/all"           auth-get "visit-checklists"
  run_test GET "/households/:householdId/notes"                                    auth-get "visit-notes"
  run_test GET "/households/:householdId/messages"                                 auth-get "messages"
  run_test GET "/households/:householdId/messages/conversations"                   auth-get "messages"
  run_test GET "/households/:householdId/messages/templates/all"                   auth-get "messages"
  run_test GET "/notifications/tokens"                                             auth-get "notifications"
  run_test GET "/notifications/preferences"                                        auth-get "notifications"
  run_test GET "/notifications/history"                                            auth-get "notifications"
  run_test GET "/notifications/unread-count"                                       auth-get "notifications"
  run_test GET "/notifications/overrides"                                          auth-get "notifications"
  run_test GET "/subscriptions/me"                                                 auth-get "subscriptions"
  run_test GET "/subscriptions/plans"                                              auth-get "subscriptions"
  run_test GET "/subscriptions/limits"                                             auth-get "subscriptions"
  run_test GET "/households/:householdId/budget/categories"                        auth-get "budget"
  run_test GET "/households/:householdId/budget/timeline"                          auth-get "budget"
  run_test GET "/households/:householdId/budget/expenses"                          auth-get "budget"
  run_test GET "/households/:householdId/utilities/accounts"                       auth-get "utilities"
  run_test GET "/households/:householdId/utilities/bills"                          auth-get "utilities"
  run_test GET "/households/:householdId/utilities/property-taxes"                 auth-get "utilities"
  run_test GET "/households/:householdId/utilities/dashboard"                      auth-get "utilities"
  run_test GET "/households/:householdId/utilities/analytics"                      auth-get "utilities"
  run_test GET "/households/:householdId/utilities/reminders"                      auth-get "utilities"
  run_test GET "/households/:householdId/task-drafts"                              auth-get "task-drafts"
  run_test GET "/households/:householdId/task-drafts/summary"                      auth-get "task-drafts"
  run_test GET "/households/:householdId/home-features"                            auth-get "home-features"
  run_test GET "/households/:householdId/maintenance-suggestions"                  auth-get "home-features"
  run_test GET "/households/:householdId/floor-plans"                              auth-get "floor-plans"
  run_test GET "/households/:householdId/garden-plans"                             auth-get "garden-plans"
  run_test GET "/households/:householdId/garden-plans/boundary-drafts"             auth-get "garden-plans"
}

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

write_junit() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    printf '<testsuite name="api-endpoints" tests="%d" failures="%d" skipped="%d">\n' \
      "$TOTAL" "$FAILED" "$SKIPPED"
    for i in $(seq 1 "$TOTAL"); do
      local name="${R_NAMES[$i]}"
      local cls="${R_CATEGORY[$i]}"
      local ms="${R_MS[$i]:-0}"
      local seconds
      seconds=$(awk -v ms="$ms" 'BEGIN{printf "%.3f", ms/1000}')
      printf '  <testcase classname="%s" name="%s" time="%s">\n' \
        "${cls//&/&amp;}" "${name//&/&amp;}" "$seconds"
      if [[ "${R_STATUS[$i]}" == "FAIL" ]]; then
        printf '    <failure message="got %s, want one of %s">%s %s</failure>\n' \
          "${R_ACTUAL[$i]}" "${R_EXPECTED[$i]}" "${R_METHODS[$i]}" "${R_PATHS[$i]//&/&amp;}"
      fi
      echo "  </testcase>"
    done
    echo "</testsuite>"
  } > "$file"
  info "Wrote JUnit report to $file"
}

write_json_summary() {
  printf '{"total":%d,"passed":%d,"failed":%d,"skipped":%d,"api_url":"%s","mode":"%s","tests":[' \
    "$TOTAL" "$PASSED" "$FAILED" "$SKIPPED" "$API_URL" "$MODE"
  local first=1
  for i in $(seq 1 "$TOTAL"); do
    [[ $first -eq 0 ]] && printf ','
    first=0
    printf '{"name":"%s","method":"%s","path":"%s","expected":"%s","actual":"%s","status":"%s","category":"%s","ms":%s}' \
      "${R_NAMES[$i]}" "${R_METHODS[$i]}" "${R_PATHS[$i]}" \
      "${R_EXPECTED[$i]}" "${R_ACTUAL[$i]}" "${R_STATUS[$i]}" \
      "${R_CATEGORY[$i]}" "${R_MS[$i]:-0}"
  done
  printf ']}\n'
}

finalize() {
  log ""
  log "========================================="
  log "Total:   $TOTAL"
  log "${C_GREEN}Passed:  $PASSED${C_RESET}"
  log "${C_RED}Failed:  $FAILED${C_RESET}"
  log "${C_YELLOW}Skipped: $SKIPPED${C_RESET}"
  log "========================================="

  if [[ -n "$JUNIT_FILE" ]]; then write_junit "$JUNIT_FILE"; fi
  if [[ "$JSON_OUTPUT" -eq 1 ]]; then write_json_summary; fi

  if [[ "$FAILED" -gt 0 ]]; then
    log ""
    log "${C_RED}Failures:${C_RESET}"
    for i in $(seq 1 "$TOTAL"); do
      if [[ "${R_STATUS[$i]}" == "FAIL" ]]; then
        log "  - ${R_NAMES[$i]} → got ${R_ACTUAL[$i]}, want ${R_EXPECTED[$i]}"
      fi
    done
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

info "API: $API_URL"
info "Mode: $MODE"
[[ -n "$FILTER" ]] && info "Filter: $FILTER"

if [[ "$MODE" == "auth" || "$MODE" == "all" ]]; then
  if ! login_and_get_token; then
    if [[ "$MODE" == "auth" ]]; then
      err "auth mode requires a valid token; aborting."
      exit 2
    fi
  fi
fi

case "$MODE" in
  smoke) run_smoke_tests ;;
  auth)  run_auth_tests ;;
  all)   run_smoke_tests; run_auth_tests ;;
esac

finalize

if [[ "$FAILED" -gt 0 ]]; then exit 1; fi
exit 0
