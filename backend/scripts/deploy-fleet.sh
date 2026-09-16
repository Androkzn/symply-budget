#!/usr/bin/env bash
# Deploy shared Worker fleet: House, Budget, Kaizen, Health (NOT Language).
# Order: all staging first, then all production. Halts on first failure.
#
# Health D1 migrate uses refuse-health-0092.sh (blocks while 0092_* is present
# unless HEALTH_ALLOW_0092=1). This script deploys Workers only — run fleet
# migrations separately when schema changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

run() {
  echo ""
  echo "▶ $*"
  "$@"
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  deploy:fleet — House + Budget + Kaizen + Health             ║"
echo "║  staging (all brands) → production (all brands)              ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# B6: refuse fleet deploy if LAMBDA_CALLBACK_API_KEY missing (names only).
# Skip with SKIP_LAMBDA_SECRET_CHECK=1 for emergency rollbacks only.
if [[ "${SKIP_LAMBDA_SECRET_CHECK:-}" != "1" ]]; then
  echo ""
  echo "── Preflight: LAMBDA_CALLBACK_API_KEY ──"
  bash scripts/verify-lambda-callback-secret.sh
fi

echo ""
echo "── Preflight: shared wrangler AIHOUSEKEEPER vars (BUILD-6) ──"
bash scripts/verify-shared-wrangler-vars.sh

# He0 (Health V2 §1.7a): the /v2 gate is fail-CLOSED and lives in secrets, not
# [vars]. Deploying without it 404s Budget's certified /v2 and stops the cron
# mailbox/checkpoint TTL sweeps — refuse rather than ship that silently.
# Skip with SKIP_LOCAL_FIRST_SECRET_CHECK=1 for emergency rollbacks only.
if [[ "${SKIP_LOCAL_FIRST_SECRET_CHECK:-}" != "1" ]]; then
  echo ""
  echo "── Preflight: LOCAL_FIRST_API_ENABLED is a secret, not a var ──"
  bash scripts/verify-local-first-api-secret.sh
fi

echo ""
echo "── Staging ──"
run npm run deploy:staging
run npm run deploy:budget:staging
run npm run deploy:kaizen:staging
run npm run deploy:health:staging

echo ""
echo "── Production ──"
run npm run deploy:production
run npm run deploy:budget:production
run npm run deploy:kaizen:production
run npm run deploy:health:production

echo ""
echo "✅ deploy:fleet complete (Language excluded — use deploy:language:*)"
