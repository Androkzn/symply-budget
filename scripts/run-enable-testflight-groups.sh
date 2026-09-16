#!/usr/bin/env bash
# Enable TestFlight Internal + External POC groups for all 5 Symply apps (ASC API).
# Usage:
#   ./scripts/run-enable-testflight-groups.sh
#   ./scripts/run-enable-testflight-groups.sh --dry-run
# Optional: ASC_CONTACT_PHONE=+1XXXXXXXXXX
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"

export ASC_ISSUER_ID="$("$GET" symply.asc.issuer_id)"
export ASC_KEY_ID="$("$GET" symply.asc.key_id)"
export ASC_KEY_PATH="$("$GET" symply.asc.key_path)"

if [[ ! -f "$ASC_KEY_PATH" ]]; then
  echo "error: .p8 not found at stored path" >&2
  exit 1
fi

exec node "$ROOT/scripts/enable-testflight-groups.mjs" "$@"
