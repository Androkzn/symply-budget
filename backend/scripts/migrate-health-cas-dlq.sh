#!/usr/bin/env bash
# Apply Health D1 migrations that must skip Data Bridge 0092
# (blocked by refuse-health-0092.sh): 0099 CAS, 0100 DLQ, 0101 timestamps.
# Usage: migrate-health-cas-dlq.sh <staging|production>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_NAME="${1:?usage: migrate-health-cas-dlq.sh <staging|production>}"
cd "$ROOT/backend"

apply_one() {
  local file="$1"
  local name
  name="$(basename "$file")"
  echo "→ Checking $name on Health $ENV_NAME"
  local applied
  applied="$(npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c wrangler.health.toml \
    --command "SELECT 1 AS ok FROM d1_migrations WHERE name = '${name}' LIMIT 1;" \
    --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const j=JSON.parse(s);const rows=(j[0]&&j[0].results)||j.results||[];process.exit(rows.length?0:1)}catch{process.exit(1)}})" && echo yes || echo no)"
  if [[ "$applied" == "yes" ]]; then
    echo "  already applied"
    return 0
  fi
  echo "  applying SQL…"
  npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c wrangler.health.toml --file="$file"
  npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c wrangler.health.toml \
    --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', datetime('now'));"
  echo "  done"
}

apply_one "migrations/0099_notification_delivery_cas.sql"
apply_one "migrations/0100_queue_dlq_records.sql"
apply_one "migrations/0101_timestamp_canonical_format.sql"
echo "✅ Health $ENV_NAME CAS/DLQ/timestamp migrations ready"
