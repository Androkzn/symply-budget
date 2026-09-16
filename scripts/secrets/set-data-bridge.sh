#!/usr/bin/env bash
# Provision Data Bridge secrets (staging|production). Never prints secret values.
#
#   ./scripts/secrets/set-data-bridge.sh staging
#   ./scripts/secrets/set-data-bridge.sh production
#
# Expects Keychain / env vars already loaded via:
#   eval "$(./scripts/secrets/export-env.sh)"
#
# Required env (generate ES256 JWKs offline; do not commit):
#   PLATFORM_JWT_PRIVATE_JWK   — House only (JSON JWK string)
#   PLATFORM_JWT_PUBLIC_KEYS   — JWKS JSON {"keys":[...]} for House/Budget/Kaizen
# Optional per-edge HTTP fallback tokens (unique each direction):
#   PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE
#   PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE
#   PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET
#   PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN
#   PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE
#   PLATFORM_DELETION_TOMBSTONE_PEPPERS
#   TRANSFER_METADATA_PEPPERS (per Worker — set manually if needed)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
eval "$(./scripts/secrets/export-env.sh)" 2>/dev/null || true

ENV_NAME="${1:-}"
if [[ "$ENV_NAME" != "staging" && "$ENV_NAME" != "production" ]]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 1
fi

put_secret() {
  local cfg="$1" name="$2" value="$3"
  if [[ -z "${value:-}" ]]; then
    echo "  SKIP  $name ($cfg / $ENV_NAME) — blank"
    return 0
  fi
  if printf '%s' "$value" | npx wrangler secret put "$name" -c "$cfg" --env "$ENV_NAME" >/dev/null 2>&1; then
    echo "  SET   $name ($cfg / $ENV_NAME)"
  else
    echo "  FAIL  $name ($cfg / $ENV_NAME)" >&2
    return 1
  fi
}

fail=0
cd "$ROOT/backend"

echo "== House-only secrets =="
put_secret wrangler.toml PLATFORM_JWT_PRIVATE_JWK "${PLATFORM_JWT_PRIVATE_JWK:-}" || fail=1
put_secret wrangler.toml PLATFORM_DELETION_TOMBSTONE_PEPPERS "${PLATFORM_DELETION_TOMBSTONE_PEPPERS:-}" || fail=1
put_secret wrangler.toml PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE "${PLATFORM_SERVICE_TOKEN_LAMBDA_TO_HOUSE:-}" || fail=1

echo "== Joined Workers public JWKS =="
for cfg in wrangler.toml wrangler.budget.toml wrangler.kaizen.toml; do
  put_secret "$cfg" PLATFORM_JWT_PUBLIC_KEYS "${PLATFORM_JWT_PUBLIC_KEYS:-}" || fail=1
done

echo "== Per-edge service tokens (HTTP fallback + House verify) =="
# Children send these; House must hold the same values to verify X-Platform-Service-Token.
put_secret wrangler.budget.toml PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE "${PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE:-}" || fail=1
put_secret wrangler.toml PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE "${PLATFORM_SERVICE_TOKEN_BUDGET_TO_HOUSE:-}" || fail=1
put_secret wrangler.kaizen.toml PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE "${PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE:-}" || fail=1
put_secret wrangler.toml PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE "${PLATFORM_SERVICE_TOKEN_KAIZEN_TO_HOUSE:-}" || fail=1
put_secret wrangler.toml PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET "${PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET:-}" || fail=1
put_secret wrangler.toml PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN "${PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN:-}" || fail=1
# Budget/Kaizen may later verify House→child; mirror outbound tokens onto children when present.
put_secret wrangler.budget.toml PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET "${PLATFORM_SERVICE_TOKEN_HOUSE_TO_BUDGET:-}" || fail=1
put_secret wrangler.kaizen.toml PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN "${PLATFORM_SERVICE_TOKEN_HOUSE_TO_KAIZEN:-}" || fail=1

echo "== Verify House-only secrets absent on children =="
for cfg in wrangler.budget.toml wrangler.kaizen.toml wrangler.health.toml; do
  if npx wrangler secret list -c "$cfg" --env "$ENV_NAME" 2>/dev/null | grep -q 'PLATFORM_JWT_PRIVATE_JWK'; then
    echo "  FAIL  PLATFORM_JWT_PRIVATE_JWK present on $cfg — remove it" >&2
    fail=1
  else
    echo "  OK    no PLATFORM_JWT_PRIVATE_JWK on $cfg"
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "set-data-bridge finished with errors" >&2
  exit 1
fi
echo "set-data-bridge complete for $ENV_NAME"
