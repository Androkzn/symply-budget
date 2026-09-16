#!/usr/bin/env bash
# Refuse Health remote D1 migrations while Data Bridge 0092 is in the shared
# migrations folder, unless HEALTH_ALLOW_0092=1 (post Health unmount DoD only).
# POC / zero-user fleets may set HEALTH_ALLOW_0092=1 to apply 0092/0093 on Health.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_NAME="${1:?usage: refuse-health-0092.sh <staging|production>}"

if [[ "${HEALTH_ALLOW_0092:-}" != "1" ]]; then
  if ls "$ROOT/backend/migrations"/0092_*.sql >/dev/null 2>&1; then
    echo "error: Health D1 migrate blocked (Data Bridge 0092 present)." >&2
    echo "Use npm run db:migrate:health:skip-0092:<env> to apply all other pending migrations." >&2
    echo "Use House/Budget/Kaizen migrate scripts for 0092. Set HEALTH_ALLOW_0092=1 only after Health empty-table + route-unmount DoD." >&2
    exit 1
  fi
fi

cd "$ROOT/backend"
exec wrangler d1 migrations apply DB --remote --env "$ENV_NAME" -c wrangler.health.toml
