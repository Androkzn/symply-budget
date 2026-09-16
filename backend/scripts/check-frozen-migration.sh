#!/usr/bin/env bash
# Refuse edits to frozen migrations that were already applied remotely.
# Currently frozen: 0017_add_waste_regulations.sql (DATA-1 / B8).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FROZEN="backend/migrations/0017_add_waste_regulations.sql"
REF="${MIGRATION_FROZEN_REF:-origin/main}"

if [[ ! -f "$ROOT/$FROZEN" ]]; then
  echo "error: expected frozen migration missing: $FROZEN" >&2
  exit 1
fi

if ! git -C "$ROOT" rev-parse --verify "$REF" >/dev/null 2>&1; then
  echo "warn: ref $REF not found — skipping frozen migration check" >&2
  exit 0
fi

if git -C "$ROOT" diff --quiet "$REF" -- "$FROZEN"; then
  exit 0
fi

echo "error: frozen migration was modified: $FROZEN" >&2
echo "Migrations are immutable once applied. Add a new numbered SQL file instead." >&2
echo "Diff against $REF:" >&2
git -C "$ROOT" diff "$REF" -- "$FROZEN" >&2 || true
exit 1
