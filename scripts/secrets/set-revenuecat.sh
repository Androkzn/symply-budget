#!/usr/bin/env bash
# RevenueCat → Worker secrets (all 4 Workers × staging + production) + Keychain public keys.
# Never prints secret values.
#
#   cp backend/.env.revenuecat.example backend/.env.revenuecat
#   # fill values from RevenueCat dashboard, then:
#   bash scripts/secrets/set-revenuecat.sh
#
# See documents/ecosystem/PROVISIONING.md §9 and documents/ecosystem/SERVICES.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
eval "$(./scripts/secrets/export-env.sh)" 2>/dev/null || true

ENVFILE="${1:-backend/.env.revenuecat}"
if [[ ! -f "$ENVFILE" ]]; then
  echo "Missing $ENVFILE"
  echo "  cp backend/.env.revenuecat.example backend/.env.revenuecat"
  echo "  # fill values from RevenueCat dashboard, then re-run this script"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENVFILE"
set +a

PUT="$ROOT/scripts/secrets/put.sh"
WRANGLER_CONFIGS=(
  wrangler.toml
  wrangler.budget.toml
  wrangler.kaizen.toml
  wrangler.health.toml
  wrangler.language.toml
)
WORKER_SECRETS=(
  REVENUECAT_SECRET_API_KEY
  REVENUECAT_WEBHOOK_AUTH
  REVENUECAT_PROJECT_ID
)

put_worker_secret() {
  local cfg="$1" env="$2" name="$3" value="$4"
  if [[ -z "$value" ]]; then
    echo "  SKIP  $name ($cfg / $env) — blank"
    return 0
  fi
  if printf '%s' "$value" | npx wrangler secret put "$name" -c "$cfg" --env "$env" >/dev/null 2>&1; then
    echo "  SET   $name ($cfg / $env)"
  else
    echo "  FAIL  $name ($cfg / $env)" >&2
    return 1
  fi
}

fail=0
cd "$ROOT/backend"

echo "== Worker secrets (4 configs × staging + production) =="
for cfg in "${WRANGLER_CONFIGS[@]}"; do
  echo "-- $cfg --"
  for env in staging production; do
    for name in "${WORKER_SECRETS[@]}"; do
      val="${!name:-}"
      put_worker_secret "$cfg" "$env" "$name" "$val" || fail=1
    done
  done
done

echo ""
echo "== Keychain public SDK keys (local dev; last brand wins if re-run) =="
if [[ -n "${EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:-}" ]]; then
  "$PUT" symply.revenuecat.ios_public "$EXPO_PUBLIC_REVENUECAT_IOS_API_KEY"
  echo "  SET   symply.revenuecat.ios_public"
else
  echo "  SKIP  symply.revenuecat.ios_public — EXPO_PUBLIC_REVENUECAT_IOS_API_KEY blank"
fi
if [[ -n "${EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY:-}" ]]; then
  "$PUT" symply.revenuecat.android_public "$EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY"
  echo "  SET   symply.revenuecat.android_public"
else
  echo "  SKIP  symply.revenuecat.android_public — EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY blank"
fi

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "COMPLETED WITH FAILURES — check CLOUDFLARE_API_TOKEN and wrangler login"
  exit 1
fi

echo ""
echo "Done. Worker secrets apply live (no redeploy required)."
echo ""
echo "=== Next: EAS public keys (one RC app per Symply app — 5 total) ==="
echo "Each brand needs its own RevenueCat Apple + Google public SDK keys on its EAS project."
echo "Option A — EAS env (recommended; per project, repeat for each brand's keys):"
echo "  eval \"\$(./scripts/secrets/export-env.sh)\""
echo "  # House example (easProjectId in brands/symply-house/brand.cjs):"
echo "  eas env:create --scope project --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY \\"
echo "    --value '<RC Apple public key for com.symply.house>' --environment production --visibility plaintext"
echo "  eas env:create --scope project --name EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY \\"
echo "    --value '<RC Google public key for com.symply.house>' --environment production --visibility plaintext"
echo "  # Repeat for preview / staging profiles; switch EAS project for Budget, Kaizen, Language, Health."
echo ""
echo "Option B — eas.json env (once keys exist; commit-safe public keys only):"
echo "  Add EXPO_PUBLIC_REVENUECAT_IOS_API_KEY and EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY"
echo "  under each brand's build profile env block in eas.json."
echo ""
echo "Local dev: copy Keychain values into .env.local, or re-run this script with that brand's"
echo "  public keys in backend/.env.revenuecat (Keychain holds one brand at a time)."
echo ""
echo "EAS project IDs (brand.cjs easProjectId):"
echo "  symply-house     349d934d-f0ca-4dab-ba2a-a4d6c54df62e"
echo "  symply-budget    7e6f549f-c8ed-4018-8f20-fc578b812c20"
echo "  symply-kaizen    69d4f08f-a4c0-4e11-b4eb-07d480120ed2"
echo "  symply-language  6050e6dd-acf4-4182-91b2-0d9dd9deb8f6"
echo "  symply-health    46cfc2d8-2474-4f3c-b224-8a96179f9b6e"
echo ""
echo "RevenueCat webhooks (configure in RC dashboard after Worker secrets are set):"
echo "  House staging     https://simple-house-api-staging.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  House production  https://simple-house-api.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Budget staging    https://simple-budget-api-staging.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Budget production https://simple-budget-api.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Kaizen staging    https://symply-kaizen-api-staging.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Kaizen production https://symply-kaizen-api.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Health staging    https://symply-health-api-staging.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Health production https://symply-health-api.a-tekhtelev.workers.dev/webhooks/revenuecat"
echo "  Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH value you set above>"
