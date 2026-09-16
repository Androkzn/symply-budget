#!/usr/bin/env bash
# Print a Keychain secret to stdout (no trailing newline control — use -w as-is).
# Usage: ./scripts/secrets/get.sh symply.cloudflare.api_token
# Agents: do not paste output into chat.

set -euo pipefail

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  echo "usage: get.sh <symply.system.name>" >&2
  exit 1
fi

ACCOUNT="${SYMPLY_SECRETS_ACCOUNT:-$USER}"

security find-generic-password -a "$ACCOUNT" -s "$SERVICE" -w
