#!/usr/bin/env bash
# Put a secret into macOS Keychain.
# Usage:
#   ./scripts/secrets/put.sh symply.cloudflare.api_token 'value'
#   echo -n 'value' | ./scripts/secrets/put.sh symply.cloudflare.api_token
# Never commit values. Never echo into chat.

set -euo pipefail

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  echo "usage: put.sh <symply.system.name> [value]" >&2
  echo "  or:  echo -n value | put.sh <symply.system.name>" >&2
  exit 1
fi

if [[ "$SERVICE" != symply.* ]]; then
  echo "error: service must start with 'symply.' (got: $SERVICE)" >&2
  exit 1
fi

ACCOUNT="${SYMPLY_SECRETS_ACCOUNT:-$USER}"

if [[ $# -ge 2 ]]; then
  VALUE="$2"
else
  if [[ -t 0 ]]; then
    echo "error: pass value as arg or via stdin" >&2
    exit 1
  fi
  VALUE="$(cat)"
fi

if [[ -z "$VALUE" ]]; then
  echo "error: empty value" >&2
  exit 1
fi

# Delete existing item if present (update)
security delete-generic-password -a "$ACCOUNT" -s "$SERVICE" >/dev/null 2>&1 || true

security add-generic-password \
  -a "$ACCOUNT" \
  -s "$SERVICE" \
  -w "$VALUE" \
  -U \
  >/dev/null

echo "ok: stored $SERVICE (account=$ACCOUNT)"
