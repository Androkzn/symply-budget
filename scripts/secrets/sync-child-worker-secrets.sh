#!/usr/bin/env bash
# Sync Keychain-backed secrets onto Budget / Kaizen / Health Workers (both envs).
# Never prints secret values. Does NOT overwrite JWT_SECRET (kept unique per Worker).
# Does NOT copy WeatherKit (House-only) or RevenueCat — use scripts/secrets/set-revenuecat.sh.
#
# Usage:
#   ./scripts/secrets/sync-child-worker-secrets.sh
#   ./scripts/secrets/sync-child-worker-secrets.sh budget kaizen   # subset
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
eval "$(./scripts/secrets/export-env.sh)" >/dev/null

GET="$ROOT/scripts/secrets/get.sh"
ACCOUNT_ID="907308712679"
REGION="us-east-1"
LAMBDA_STAGING="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:inspection-report-processor-staging"
LAMBDA_PROD="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:inspection-report-processor"
APPLE_TEAM_ID="B2ZY5M2YW2"

# Local-first `/v2` control-plane gate. NOT sensitive, but it must be a SECRET
# rather than a `[vars]` entry: vars and secrets share one namespace on `env`,
# so a var of this name shadows the secret and the next `wrangler deploy`
# silently re-arms `/v2` (Health V2 plan §1.7a, Commit 3). Fail-CLOSED — only
# the literal "true" enables — so an unset secret 404s `/v2` AND stops the cron
# mailbox / checkpoint TTL sweeps. Only the brands with the `localFirstApi`
# capability carry it (House, Budget, Health); Kaizen and Language do not.
# The kill switch is `LOCAL_FIRST_API="false" ... health` (or a direct
# `wrangler secret put`), which applies live with no redeploy.
LOCAL_FIRST_API="${LOCAL_FIRST_API:-true}"
LOCAL_FIRST_BRANDS=" house budget health "

TARGETS=("$@")
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=(budget kaizen health language)
fi

cfg_for() {
  case "$1" in
    budget)   echo "wrangler.budget.toml" ;;
    kaizen)   echo "wrangler.kaizen.toml" ;;
    health)   echo "wrangler.health.toml" ;;
    language) echo "wrangler.language.toml" ;;
    house)    echo "wrangler.toml" ;;
    *) echo "unknown target: $1" >&2; return 1 ;;
  esac
}

put_secret() {
  local cfg="$1" env="$2" name="$3" value="$4"
  if [[ -z "$value" ]]; then
    echo "  SKIP  $name ($env) — empty"
    return 0
  fi
  if printf '%s' "$value" | npx wrangler secret put "$name" -c "$cfg" --env "$env" >/dev/null 2>&1; then
    echo "  SET   $name ($env)"
  else
    echo "  FAIL  $name ($env)" >&2
    return 1
  fi
}

KEK="$("$GET" symply.ai.kek 2>/dev/null || true)"
LEASE="$("$GET" symply.ai.lease-secret 2>/dev/null || true)"
GEMINI="$("$GET" symply.gemini.api_key 2>/dev/null || true)"
[[ -z "$GEMINI" ]] && GEMINI="$("$GET" symply.gemini.managed 2>/dev/null || true)"
ANTHROPIC="$("$GET" symply.test.anthropic 2>/dev/null || true)"
OPENAI="$("$GET" symply.test.openai 2>/dev/null || true)"
RESEND="$("$GET" symply.resend.api_key 2>/dev/null || true)"
AWS_KEY="$("$GET" symply.aws.access_key_id 2>/dev/null || true)"
AWS_SECRET="$("$GET" symply.aws.secret_access_key 2>/dev/null || true)"
GOOGLE_OAUTH_SECRET="$("$GET" symply.google.oauth.client_secret 2>/dev/null || true)"

cd "$ROOT/backend"
fail=0
for target in "${TARGETS[@]}"; do
  cfg="$(cfg_for "$target")" || { fail=1; continue; }
  echo "== $target ($cfg) =="
  for env in staging production; do
    put_secret "$cfg" "$env" AI_CREDENTIAL_KEK_V1 "$KEK" || fail=1
    put_secret "$cfg" "$env" AI_CREDENTIAL_LEASE_SECRET "$LEASE" || fail=1
    put_secret "$cfg" "$env" GEMINI_API_KEY "$GEMINI" || fail=1
    put_secret "$cfg" "$env" ANTHROPIC_API_KEY "$ANTHROPIC" || fail=1
    put_secret "$cfg" "$env" OPENAI_API_KEY "$OPENAI" || fail=1
    put_secret "$cfg" "$env" RESEND_API_KEY "$RESEND" || fail=1
    put_secret "$cfg" "$env" APPLE_TEAM_ID "$APPLE_TEAM_ID" || fail=1
    put_secret "$cfg" "$env" AWS_ACCESS_KEY_ID "$AWS_KEY" || fail=1
    put_secret "$cfg" "$env" AWS_SECRET_ACCESS_KEY "$AWS_SECRET" || fail=1
    put_secret "$cfg" "$env" AWS_REGION "$REGION" || fail=1
    put_secret "$cfg" "$env" GOOGLE_OAUTH_CLIENT_SECRET "$GOOGLE_OAUTH_SECRET" || fail=1
    if [[ "$LOCAL_FIRST_BRANDS" == *" $target "* ]]; then
      put_secret "$cfg" "$env" LOCAL_FIRST_API_ENABLED "$LOCAL_FIRST_API" || fail=1
    fi
    if [[ "$env" == "staging" ]]; then
      put_secret "$cfg" "$env" AWS_LAMBDA_ARN "$LAMBDA_STAGING" || fail=1
    else
      put_secret "$cfg" "$env" AWS_LAMBDA_ARN "$LAMBDA_PROD" || fail=1
    fi
  done
done

# House staging often lacks Lambda ARN — fill from AWS list
echo "== house (wrangler.toml) Lambda ARNs =="
put_secret "wrangler.toml" "staging" AWS_LAMBDA_ARN "$LAMBDA_STAGING" || fail=1
put_secret "wrangler.toml" "production" AWS_LAMBDA_ARN "$LAMBDA_PROD" || fail=1
put_secret "wrangler.toml" "staging" AWS_ACCESS_KEY_ID "$AWS_KEY" || fail=1
put_secret "wrangler.toml" "staging" AWS_SECRET_ACCESS_KEY "$AWS_SECRET" || fail=1
put_secret "wrangler.toml" "staging" AWS_REGION "$REGION" || fail=1
put_secret "wrangler.toml" "staging" GOOGLE_OAUTH_CLIENT_SECRET "$GOOGLE_OAUTH_SECRET" || fail=1
put_secret "wrangler.toml" "production" GOOGLE_OAUTH_CLIENT_SECRET "$GOOGLE_OAUTH_SECRET" || fail=1

# House is never in TARGETS (it is the parent), so its /v2 gate is set here.
echo "== house (wrangler.toml) local-first /v2 gate =="
put_secret "wrangler.toml" "staging" LOCAL_FIRST_API_ENABLED "$LOCAL_FIRST_API" || fail=1
put_secret "wrangler.toml" "production" LOCAL_FIRST_API_ENABLED "$LOCAL_FIRST_API" || fail=1

if [[ "$fail" -ne 0 ]]; then
  echo "SYNC COMPLETED WITH FAILURES"
  exit 1
fi
echo "SYNC OK — secrets apply live (no redeploy required for secret puts)."
echo "Google Calendar OAuth: store client secret in Keychain as symply.google.oauth.client_secret, then re-run this script (House + child Workers)."
echo "Optional feature secrets (only if shipping that surface): TWILIO_* (removed — SMS channel disabled server-side)."
echo "AI: BYOK via user vault + managed Worker keys (entitlement-service)."
echo "RevenueCat: fill backend/.env.revenuecat then bash scripts/secrets/set-revenuecat.sh"
