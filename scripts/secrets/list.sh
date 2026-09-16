#!/usr/bin/env bash
# List known symply.* Keychain items that exist (names only).
# Usage: ./scripts/secrets/list.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"

KNOWN=(
  symply.cloudflare.api_token
  symply.cloudflare.account_id
  symply.sentry.auth_token
  symply.expo.token
  symply.resend.api_key
  symply.aws.access_key_id
  symply.aws.secret_access_key
  symply.aws.region
  symply.revenuecat.ios_public
  symply.revenuecat.android_public
  symply.google.places_key
)

for s in "${KNOWN[@]}"; do
  if "$GET" "$s" >/dev/null 2>&1; then
    echo "$s"
  fi
done
