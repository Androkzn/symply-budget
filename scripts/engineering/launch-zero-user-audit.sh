#!/usr/bin/env bash
# Appendix A zero-user audit — House / Budget / Kaizen production (and optional staging).
# Archives JSON under documents/engineering/launch-zero-user-audits/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
eval "$(./scripts/secrets/export-env.sh)" 2>/dev/null || true

ENV_NAME="${1:-production}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$ROOT/documents/engineering/launch-zero-user-audits"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/${STAMP}-${ENV_NAME}.jsonl"

SQL_USERS="SELECT COUNT(*) AS users_total FROM users WHERE deleted_at IS NULL;"
SQL_REFRESH="SELECT COUNT(*) AS refresh_active FROM refresh_tokens WHERE revoked_at IS NULL AND datetime(expires_at) > datetime('now');"
SQL_LINKS="SELECT COUNT(*) AS platform_identity_links FROM platform_identity_links;"
SQL_PREF="SELECT COUNT(*) AS platform_refresh_active FROM platform_refresh_tokens WHERE revoked_at IS NULL;"
SQL_ENT="SELECT COUNT(*) AS user_app_entitlements FROM user_app_entitlements;"
SQL_CONSENT="SELECT COUNT(*) AS transfer_consents FROM transfer_consents;"
SQL_DEL="SELECT COUNT(*) AS platform_deletion_requests FROM platform_deletion_requests;"

run_one() {
  local cfg="$1" label="$2"
  echo "{\"worker\":\"$label\",\"env\":\"$ENV_NAME\",\"ts\":\"$STAMP\"}" >>"$OUT"
  for q in "$SQL_USERS" "$SQL_REFRESH" "$SQL_LINKS" "$SQL_PREF" "$SQL_ENT" "$SQL_CONSENT" "$SQL_DEL"; do
    echo "--- $label: $q" >&2
    npx wrangler d1 execute DB --remote --env "$ENV_NAME" -c "$cfg" --command "$q" --json >>"$OUT" 2>/dev/null \
      || echo "{\"error\":\"query_failed\",\"sql\":$(printf '%s' "$q" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" >>"$OUT"
  done
}

cd "$ROOT/backend"
run_one wrangler.toml house
run_one wrangler.budget.toml budget
run_one wrangler.kaizen.toml kaizen

echo "Archived: $OUT"
echo "Review counts manually — launch requires zeros (or documented synthetics only)."
