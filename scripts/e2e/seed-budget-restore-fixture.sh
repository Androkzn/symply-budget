#!/usr/bin/env bash
#
# Copy the Maestro restore-smoke encrypted backup into Symply Budget's
# Documents folder so Settings → "Load pushed backup (dev)" can open it.
#
#   scripts/e2e/seed-budget-restore-fixture.sh <UDID>
#
# App reads (hardcoded in BudgetSettingsScreen):
#   Documents/sweet-home-v2-restore.backup.json
#   Documents/sweet-home-v2-restore.phrase.txt
#
# Source fixtures: e2e/fixtures/budget/restore-smoke.*
# Regenerated via:
#   cd packages/local-first && npx vite-node scripts/write-restore-smoke-fixture.ts
set -euo pipefail

UDID="${1:-}"
if [[ -z "$UDID" ]]; then
  echo "usage: $0 <UDID>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_BACKUP="$REPO_ROOT/e2e/fixtures/budget/restore-smoke.backup.json"
SRC_PHRASE="$REPO_ROOT/e2e/fixtures/budget/restore-smoke.phrase.txt"
APP_ID="${E2E_BUDGET_APP_ID:-com.symply.budget}"

if [[ ! -f "$SRC_BACKUP" || ! -f "$SRC_PHRASE" ]]; then
  echo "!! Missing restore-smoke fixtures. Generate with:" >&2
  echo "   cd packages/local-first && npx vite-node scripts/write-restore-smoke-fixture.ts" >&2
  exit 1
fi

if ! xcrun simctl get_app_container "$UDID" "$APP_ID" data >/dev/null 2>&1; then
  echo "!! No data container for $APP_ID on $UDID — launch the app once, then re-seed." >&2
  exit 1
fi

DATA_CONTAINER="$(xcrun simctl get_app_container "$UDID" "$APP_ID" data)"
DOCS="$DATA_CONTAINER/Documents"
mkdir -p "$DOCS"
cp "$SRC_BACKUP" "$DOCS/sweet-home-v2-restore.backup.json"
# Phrase file is plain 12 words (first non-empty line). Strip comments if any.
head -n 1 "$SRC_PHRASE" | tr -d '\r' | sed 's/[[:space:]]*$//' >"$DOCS/sweet-home-v2-restore.phrase.txt"

echo "Seeded Budget restore fixture → $DOCS"
echo "  sweet-home-v2-restore.backup.json ($(wc -c <"$DOCS/sweet-home-v2-restore.backup.json" | tr -d ' ') bytes)"
echo "  sweet-home-v2-restore.phrase.txt"
