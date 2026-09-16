#!/usr/bin/env bash
# B5: raise Cloudflare Queues DLQ retention to 14 days (1_209_600s).
# Wrangler TOML cannot set this — CLI only. See documents/engineering/ops/dlq-retention.md
set -euo pipefail

RETENTION_SECS="${DLQ_RETENTION_SECS:-1209600}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUEUES=(
  # House
  aihousekeeper-outbound-dlq
  aihousekeeper-outbound-staging-dlq
  garden-plan-generation-dlq
  garden-plan-generation-staging-dlq
  task-enrichment-dlq
  task-enrichment-staging-dlq
  # Budget
  simple-budget-aihousekeeper-outbound-dlq
  simple-budget-aihousekeeper-outbound-staging-dlq
  simple-budget-garden-plan-dlq
  simple-budget-garden-plan-staging-dlq
  simple-budget-task-enrichment-dlq
  simple-budget-task-enrichment-staging-dlq
  # Kaizen
  symply-kaizen-aihousekeeper-outbound-dlq
  symply-kaizen-aihousekeeper-outbound-staging-dlq
  symply-kaizen-garden-plan-dlq
  symply-kaizen-garden-plan-staging-dlq
  symply-kaizen-task-enrichment-dlq
  symply-kaizen-task-enrichment-staging-dlq
  # Health
  symply-health-aihousekeeper-outbound-dlq
  symply-health-aihousekeeper-outbound-staging-dlq
  symply-health-garden-plan-dlq
  symply-health-garden-plan-staging-dlq
  symply-health-task-enrichment-dlq
  symply-health-task-enrichment-staging-dlq
)

# Language (separate Worker)
LANGUAGE_QUEUES=(
  kaizen-processing-dlq
  kaizen-processing-staging-dlq
)

fail=0
for q in "${QUEUES[@]}"; do
  echo "==> $q → ${RETENTION_SECS}s"
  if ! npx wrangler queues update "$q" --message-retention-period-secs "$RETENTION_SECS"; then
    echo "WARN: failed to update $q (may not exist yet)" >&2
    fail=1
  fi
done

cd "$ROOT/../backend-language"
for q in "${LANGUAGE_QUEUES[@]}"; do
  echo "==> language/$q → ${RETENTION_SECS}s"
  if ! npx wrangler queues update "$q" --message-retention-period-secs "$RETENTION_SECS"; then
    echo "WARN: failed to update $q (may not exist yet)" >&2
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "Completed with warnings — review missing queues above." >&2
  exit 1
fi
echo "All DLQ retention updates succeeded."
