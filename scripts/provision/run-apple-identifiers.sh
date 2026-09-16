#!/usr/bin/env bash
# Load ASC credentials from Keychain and run the Apple identifier provisioner.
# The private .p8 never enters argv/chat — only its path is exported; the node
# script reads the file directly.
#
# Usage:
#   ./scripts/provision/run-apple-identifiers.sh            # apply
#   ./scripts/provision/run-apple-identifiers.sh --dry-run  # plan only

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

exec node "$ROOT/scripts/provision/apple-identifiers.mjs" "$@"
