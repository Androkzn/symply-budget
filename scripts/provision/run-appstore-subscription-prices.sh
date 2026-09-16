#!/usr/bin/env bash
# Load ASC credentials from Keychain and set territory availability (all 175
# territories) + USA base price (monthly $1.99 / yearly $19.99; Apple auto-equalizes)
# on the Pro subscriptions. Idempotent. Edit prices in appstore-subscription-prices.mjs.
#
# NOTE: a per-subscription App Review screenshot is still required before a product
# leaves MISSING_METADATA → READY_TO_SUBMIT (upload the real paywall screenshot in ASC).
#
# Usage:
#   ./scripts/provision/run-appstore-subscription-prices.sh            # apply
#   ./scripts/provision/run-appstore-subscription-prices.sh --dry-run
#   ./scripts/provision/run-appstore-subscription-prices.sh --only=house.pro.monthly
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"

export ASC_ISSUER_ID="$("$GET" symply.asc.issuer_id)"
export ASC_KEY_ID="$("$GET" symply.asc.key_id)"
export ASC_KEY_PATH="$("$GET" symply.asc.key_path)"

if [[ ! -f "$ASC_KEY_PATH" ]]; then
  echo "error: .p8 not found at stored path" >&2
  exit 1
fi

exec node "$ROOT/scripts/provision/appstore-subscription-prices.mjs" "$@"
