#!/usr/bin/env bash
# Load ASC credentials from Keychain and create the Pro subscription products
# (group + monthly + yearly + en-US localizations) for all 5 apps in App Store
# Connect. Idempotent — existing groups/subs/localizations are reused.
# Does NOT set prices (business decision — set per product in ASC afterwards).
#
# Usage:
#   ./scripts/provision/run-appstore-subscriptions.sh            # apply
#   ./scripts/provision/run-appstore-subscriptions.sh --dry-run  # plan only
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

exec node "$ROOT/scripts/provision/appstore-subscriptions.mjs" "$@"
