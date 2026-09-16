#!/usr/bin/env bash
# He0 preflight (Health V2 plan §1.7a, Commit 3): LOCAL_FIRST_API_ENABLED must
# be a per-env SECRET on every brand with the `localFirstApi` capability —
# House, Budget, Health — and must NOT appear in any `[vars]` block.
#
# Why both halves matter:
#   * The gate is fail-CLOSED (`=== 'true'`). An unprovisioned secret does not
#     degrade — it 404s `/v2` (Budget's certified two-device sync) AND stops the
#     cron mailbox / checkpoint TTL sweeps, so R2 accumulates unswept ciphertext.
#     Refusing the deploy is strictly safer than shipping it.
#   * Vars and secrets share ONE namespace on `env`. While a `[vars]` line
#     exists it shadows the secret, and the next `deploy:fleet` — for any
#     brand's unrelated change — silently re-applies it and re-arms `/v2`. That
#     is the kill switch failing open with a green deploy log.
#
# "All three envs": the top-level config and `[env.production]` share one Worker
# name per brand (simple-house-api / simple-budget-api / symply-health-api), so
# the two `--env` puts below cover all three var blocks' worth of runtime.
#
# Does not print secret values. Skip with SKIP_LOCAL_FIRST_SECRET_CHECK=1 for
# emergency rollbacks only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECRET_NAME="LOCAL_FIRST_API_ENABLED"
FAIL=0

# ── Half 1: the var must be gone from the committed configs ──────────────────
# Assignment lines only — the explanatory comments beside them are expected.
echo "Checking ${SECRET_NAME} is absent from [vars] in fleet wrangler configs…"
for cfg in wrangler.toml wrangler.budget.toml wrangler.kaizen.toml wrangler.health.toml; do
  if grep -nE "^[[:space:]]*${SECRET_NAME}[[:space:]]*=" "$cfg" >/dev/null 2>&1; then
    echo "❌ ${cfg}: ${SECRET_NAME} is a [vars] entry — it shadows the secret"
    grep -nE "^[[:space:]]*${SECRET_NAME}[[:space:]]*=" "$cfg" | sed 's/^/     /'
    FAIL=1
  else
    echo "✅ ${cfg}: no [vars] entry"
  fi
done

# ── Half 2: the secret must be provisioned on each local-first Worker ────────
check() {
  local label="$1"
  shift
  # wrangler secret list prints names only (JSON array of {name, type})
  local out
  if ! out=$(npx wrangler secret list "$@" 2>/dev/null); then
    echo "❌ ${label}: wrangler secret list failed"
    FAIL=1
    return
  fi
  if echo "$out" | grep -q "\"name\": \"${SECRET_NAME}\""; then
    echo "✅ ${label}: ${SECRET_NAME} present"
  else
    echo "❌ ${label}: missing ${SECRET_NAME}"
    FAIL=1
  fi
}

echo ""
echo "Checking ${SECRET_NAME} on local-first Workers (staging + production)…"
# Kaizen is deliberately absent: `localFirstApi: false`, so /v2 is 404 by
# capability and the secret would be dead config.
check "House staging" --env staging
check "House production" --env production
check "Budget staging" --env staging -c wrangler.budget.toml
check "Budget production" --env production -c wrangler.budget.toml
check "Health staging" --env staging -c wrangler.health.toml
check "Health production" --env production -c wrangler.health.toml

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "Provision all six at once: ./scripts/secrets/sync-child-worker-secrets.sh"
  echo "Or one at a time:  printf 'true' | npx wrangler secret put ${SECRET_NAME} --env <env> [-c wrangler.<brand>.toml]"
  echo "Secret puts apply live — no redeploy required."
  exit 1
fi

echo ""
echo "✅ ${SECRET_NAME} is a secret on every local-first Worker, and in no [vars] block"
