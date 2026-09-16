#!/usr/bin/env bash
# Upload an App Review screenshot to each Pro subscription (reserve -> PUT -> commit).
# Idempotent — a subscription that already has a COMPLETE screenshot is skipped.
#
#   $1 = image path (Apple-accepted size, e.g. 1242x2208 PNG).
#        Defaults to the labeled placeholder in assets/ — REPLACE with the real
#        paywall screenshot before submitting to Apple.
#
# NOTE: products stay MISSING_METADATA until the account's **Paid Applications
# Agreement** (App Store Connect → Business → Agreements, Tax, and Banking) is active,
# even with a screenshot uploaded. That step is Account-Holder-only and has no API.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"

export ASC_ISSUER_ID="$("$GET" symply.asc.issuer_id)"
export ASC_KEY_ID="$("$GET" symply.asc.key_id)"
export ASC_KEY_PATH="$("$GET" symply.asc.key_path)"
export IMG_PATH="${1:-$ROOT/scripts/provision/assets/review-placeholder.png}"

if [[ ! -f "$IMG_PATH" ]]; then echo "error: image not found: $IMG_PATH" >&2; exit 1; fi
exec node "$ROOT/scripts/provision/appstore-review-screenshots.mjs"
