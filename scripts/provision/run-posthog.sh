#!/usr/bin/env bash
# Load the PostHog personal API key from Keychain and provision the 4 projects.
# Usage: ./scripts/provision/run-posthog.sh [--dry-run]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"

export POSTHOG_PERSONAL_API_KEY="$("$GET" symply.posthog.personal_api_key)"
export POSTHOG_HOST="$("$GET" symply.posthog.host 2>/dev/null || echo 'https://us.posthog.com')"

exec node "$ROOT/scripts/provision/posthog-projects.mjs" "$@"
