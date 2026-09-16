#!/usr/bin/env bash
# B6 preflight: fail if LAMBDA_CALLBACK_API_KEY is missing on staging/production
# for House + Budget + Kaizen + Health. Does not print secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECRET_NAME="LAMBDA_CALLBACK_API_KEY"
FAIL=0

check() {
  local label="$1"
  shift
  # wrangler secret list prints names only (JSON array of {name, type})
  local out
  if ! out=$(npx wrangler secret list "$@" 2>/dev/null); then
    echo "❌ ${label}: wrangler secret list failed"
    FAIL=1
    return
  fi
  if echo "$out" | grep -q "\"name\": \"${SECRET_NAME}\""; then
    echo "✅ ${label}: ${SECRET_NAME} present"
  else
    echo "❌ ${label}: missing ${SECRET_NAME}"
    FAIL=1
  fi
}

echo "Checking ${SECRET_NAME} on fleet Workers (staging + production)…"

check "House staging" --env staging
check "House production" --env production
check "Budget staging" --env staging -c wrangler.budget.toml
check "Budget production" --env production -c wrangler.budget.toml
check "Kaizen staging" --env staging -c wrangler.kaizen.toml
check "Kaizen production" --env production -c wrangler.kaizen.toml
check "Health staging" --env staging -c wrangler.health.toml
check "Health production" --env production -c wrangler.health.toml

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "Provision via: wrangler secret put ${SECRET_NAME} --env <env> [-c wrangler.<brand>.toml]"
  echo "Keychain: symply.lambda.callback_api_key (see documents/ecosystem/SERVICES.md)"
  exit 1
fi

echo "✅ All fleet Workers have ${SECRET_NAME}"
