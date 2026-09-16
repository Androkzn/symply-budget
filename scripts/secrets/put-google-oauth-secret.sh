#!/usr/bin/env bash
# Store Google Calendar OAuth web client secret in Keychain, then sync to all Workers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
read -rs -p "Paste Google OAuth client secret (web client): " SECRET
echo
if [[ -z "$SECRET" ]]; then echo "Empty — aborted"; exit 1; fi
./scripts/secrets/put.sh symply.google.oauth.client_secret "$SECRET"
echo "Stored in Keychain. Syncing to Workers…"
./scripts/secrets/sync-child-worker-secrets.sh
echo "Done. Google Calendar OAuth secret is on House + Budget + Kaizen + Health (stg+prd)."
