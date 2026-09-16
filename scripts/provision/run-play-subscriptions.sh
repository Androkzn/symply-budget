#!/usr/bin/env bash
# Load the Google service-account key from Keychain and create the Pro subscription
# products (monthly + yearly) for all 5 apps in Google Play Console, matching the
# App Store Connect product IDs. Idempotent.
#
# Requires (interactive, one-time — see header of play-subscriptions.mjs):
#   • the 5 app records exist in Play Console
#   • the service account is linked in Play Console → Users & permissions / API access
#
# Usage:
#   ./scripts/provision/run-play-subscriptions.sh            # apply
#   ./scripts/provision/run-play-subscriptions.sh --dry-run  # plan only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"

export SA_PATH="$("$GET" symply.firebase.sa_key_path)"
if [[ ! -f "$SA_PATH" ]]; then
  echo "error: service-account JSON not found at stored path" >&2
  exit 1
fi

exec node "$ROOT/scripts/provision/play-subscriptions.mjs" "$@"
