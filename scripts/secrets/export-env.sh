#!/usr/bin/env bash
# Emit export statements for agent / deploy shells.
# Usage: eval "$(./scripts/secrets/export-env.sh)"
# Missing Keychain entries are skipped (no error). Values never logged here.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"
ACCOUNT="${SYMPLY_SECRETS_ACCOUNT:-$USER}"

emit() {
  local env_name="$1"
  local service="$2"
  local value
  if value="$("$GET" "$service" 2>/dev/null)" && [[ -n "$value" ]]; then
    # Escape for single-quoted shell assignment
    local escaped="${value//\'/\'\\\'\'}"
    printf "export %s='%s'\n" "$env_name" "$escaped"
  fi
}

emit CLOUDFLARE_API_TOKEN   symply.cloudflare.api_token
emit CLOUDFLARE_ACCOUNT_ID  symply.cloudflare.account_id
emit SENTRY_AUTH_TOKEN      symply.sentry.auth_token
emit EXPO_TOKEN             symply.expo.token
emit RESEND_API_KEY         symply.resend.api_key
emit AWS_ACCESS_KEY_ID      symply.aws.access_key_id
emit AWS_SECRET_ACCESS_KEY  symply.aws.secret_access_key

# Google Places (address autocomplete on CreateHouseholdScreen). Publishable —
# it ships in the app binary — but it lives in Keychain rather than eas.json so
# it is restricted and rotatable in one place. Without it the address field
# renders as a plain TextInput and no suggestions appear; nothing errors.
emit EXPO_PUBLIC_GOOGLE_PLACES_API_KEY symply.google.places_key

# Default region for Lambda processor if not already set
if [[ -z "${AWS_REGION:-}" ]] && [[ -z "${AWS_DEFAULT_REGION:-}" ]]; then
  if region="$("$GET" symply.aws.region 2>/dev/null)" && [[ -n "$region" ]]; then
    escaped="${region//\'/\'\\\'\'}"
    printf "export AWS_REGION='%s'\n" "$escaped"
    printf "export AWS_DEFAULT_REGION='%s'\n" "$escaped"
  else
    printf "export AWS_REGION='us-east-1'\n"
    printf "export AWS_DEFAULT_REGION='us-east-1'\n"
  fi
fi

# Data Bridge (ES256 + edge tokens) — used by set-data-bridge.sh / local Worker tests
emit PLATFORM_JWT_PRIVATE_JWK              symply.platform.jwt_private_jwk
emit PLATFORM_JWT_PUBLIC_KEYS              symply.platform.jwt_public_keys
emit PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE symply.platform.token_budget_to_house
emit PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE symply.platform.token_kaizen_to_house
emit PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET symply.platform.token_house_to_budget
emit PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN symply.platform.token_house_to_kaizen
emit PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE symply.platform.token_lambda_to_house

# Markers for agents (no secrets)
printf 'export SYMPLY_SECRETS_LOADED=1\n'
printf '# secrets loaded from Keychain account=%s\n' "$ACCOUNT" >&2
