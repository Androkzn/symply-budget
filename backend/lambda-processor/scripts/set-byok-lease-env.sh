#!/bin/bash
#
# Set the BYOK credential-lease env vars on the report-processor Lambda so it can
# exchange a job-bound lease for the acting user's own API key (§18.5).
#
#   SIMPLEHOUSE_API_BASE     — the backend Worker base URL (non-secret).
#   AI_CREDENTIAL_LEASE_SECRET — shared bearer secret; MUST match the value set on
#                                the Worker via `wrangler secret put`. Read from
#                                the environment only — never hard-coded here.
#
# Both are optional at runtime: if either is unset, or the exchange fails, the
# Lambda falls back to the SimpleHouse-managed key, so a partial/failed setup can
# never break report processing.
#
# This MERGES into the function's existing environment (fetch → add two keys →
# update); it never replaces the whole env, so ANTHROPIC_API_KEY / R2 creds / etc.
# are preserved.
#
# Usage:
#   AI_CREDENTIAL_LEASE_SECRET=<secret> ./scripts/set-byok-lease-env.sh staging
#   AI_CREDENTIAL_LEASE_SECRET=<secret> ./scripts/set-byok-lease-env.sh production
#   # SIMPLEHOUSE_API_BASE defaults per env; override by exporting it.
#
set -euo pipefail
cd "$(dirname "$0")"

DEPLOY_ENV="${1:-${DEPLOY_ENV:-staging}}"
export DEPLOY_ENV
# shellcheck source=./env-config.sh
source ./env-config.sh   # sets FUNCTION_NAME + AWS_REGION per env

# Default Worker base URL per environment (override by exporting SIMPLEHOUSE_API_BASE).
if [ -z "${SIMPLEHOUSE_API_BASE:-}" ]; then
  case "$DEPLOY_ENV" in
    production|prod) SIMPLEHOUSE_API_BASE="https://simple-house-api.a-tekhtelev.workers.dev" ;;
    *)              SIMPLEHOUSE_API_BASE="https://simple-house-api-staging.a-tekhtelev.workers.dev" ;;
  esac
fi

if [ -z "${AI_CREDENTIAL_LEASE_SECRET:-}" ]; then
  echo "❌ AI_CREDENTIAL_LEASE_SECRET is not set in the environment."
  echo "   Export the same value you set on the Worker (wrangler secret put AI_CREDENTIAL_LEASE_SECRET)."
  exit 1
fi

echo "Target: $FUNCTION_NAME ($ENV_LABEL) in $AWS_REGION"
echo "SIMPLEHOUSE_API_BASE=$SIMPLEHOUSE_API_BASE"
echo "AI_CREDENTIAL_LEASE_SECRET=**** (from env, ${#AI_CREDENTIAL_LEASE_SECRET} chars)"

# 1) Fetch the current environment so we merge rather than clobber.
current="$(aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" --region "$AWS_REGION" \
  --query 'Environment.Variables' --output json)"

# 2) Merge in the two new keys.
merged="$(echo "$current" | jq \
  --arg base "$SIMPLEHOUSE_API_BASE" \
  --arg secret "$AI_CREDENTIAL_LEASE_SECRET" \
  '. + {SIMPLEHOUSE_API_BASE: $base, AI_CREDENTIAL_LEASE_SECRET: $secret}')"

# Safety: refuse to proceed if the merge somehow dropped the managed AI key.
if ! echo "$merged" | jq -e 'has("ANTHROPIC_API_KEY")' >/dev/null; then
  echo "⚠️  Merged env is missing ANTHROPIC_API_KEY — aborting to avoid clobbering config."
  exit 1
fi

payload="$(echo "$merged" | jq -c '{Variables: .}')"

# 3) Apply.
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" --region "$AWS_REGION" \
  --environment "$payload" \
  --query 'LastModified' --output text

echo "✅ Set SIMPLEHOUSE_API_BASE + AI_CREDENTIAL_LEASE_SECRET on $FUNCTION_NAME (existing keys preserved)."
