#!/usr/bin/env bash
# Apply Health D1 migrations while Data Bridge 0092 is held.
# Skips 0092_* (platform authority schema) and migrations that require 0092 tables.
# Does NOT set HEALTH_ALLOW_0092 — use only until Health join DoD (empty-table + route-unmount).
#
# Usage: migrate-health-skip-0092.sh <staging|production>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_NAME="${1:?usage: migrate-health-skip-0092.sh <staging|production>}"
cd "$ROOT/backend"

# 0093 references platform_deletion_requests from 0092 — must stay skipped until 0092 lift.
SKIP_ALWAYS=(
  "0092_shared_user_entitlements.sql"
  "0093_platform_profile_revocation.sql"
)

is_applied() {
  local name="$1"
  npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c wrangler.health.toml \
    --command "SELECT 1 AS ok FROM d1_migrations WHERE name = '${name}' LIMIT 1;" \
    --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);const rows=(j[0]&&j[0].results)||j.results||[];process.exit(rows.length?0:1)}catch{process.exit(1)}})"
}

should_skip() {
  local name="$1"
  if [[ "$name" == 0092_* ]]; then
    return 0
  fi
  local s
  for s in "${SKIP_ALWAYS[@]}"; do
    if [[ "$name" == "$s" ]]; then
      return 0
    fi
  done
  return 1
}

apply_one() {
  local file="$1"
  local name
  name="$(basename "$file")"
  echo "→ Checking $name on Health $ENV_NAME"
  if is_applied "$name"; then
    echo "  already applied"
    return 0
  fi
  echo "  applying SQL…"
  npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c wrangler.health.toml --file="$file"
  npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c wrangler.health.toml \
    --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', datetime('now'));"
  echo "  done"
}

APPLIED=()
SKIPPED=()

while IFS= read -r file; do
  name="$(basename "$file")"
  if should_skip "$name"; then
    SKIPPED+=("$name")
    echo "⊘ Skipping $name (Data Bridge 0092 hold)"
    continue
  fi
  apply_one "$file"
  APPLIED+=("$name")
done < <(find migrations -maxdepth 1 -name '*.sql' -type f | sort)

echo ""
echo "✅ Health $ENV_NAME skip-0092 migrate complete"
if ((${#APPLIED[@]})); then
  echo "Applied this run (includes already-applied checks):"
  printf '  - %s\n' "${APPLIED[@]}"
fi
if ((${#SKIPPED[@]})); then
  echo "Still skipped (0092 hold — lift only after Health join DoD):"
  printf '  - %s\n' "${SKIPPED[@]}"
fi
