#!/usr/bin/env bash
# Fleet matrix E2E status — one snapshot for loop / agent reporting.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${ROOT}/.tmp/e2e-logs"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

count_flow_outcomes() {
  local log="$1"
  if [[ ! -f "${log}" ]]; then
    echo "— no log —"
    return
  fi
  local pass fail current
  pass="$(rg '^\[Passed\] ' "${log}" 2>/dev/null | sed 's/.*\[Passed\] //;s/ (.*//' | sort -u | wc -l | tr -d ' ')"
  fail="$(rg '^\[Failed\] ' "${log}" 2>/dev/null | sed 's/.*\[Failed\] //;s/ (.*//' | sort -u | wc -l | tr -d ' ')"
  current="$(rg '^=== ' "${log}" 2>/dev/null | tail -1 | sed 's/^=== //;s/ ===$//')"
  last="$(rg '^\[Passed\] |^\[Failed\] ' "${log}" 2>/dev/null | tail -1)"
  echo "pass=${pass} fail=${fail} current=${current:-?} | ${last:-—}"
}

echo "=== Symply Fleet E2E @ ${TS} ==="

if pgrep -fl 'maestro\.cli' >/dev/null 2>&1; then
  echo "MAESTRO: $(pgrep -fl 'maestro\.cli' | wc -l | tr -d ' ') process(es)"
  pgrep -fl 'maestro\.cli' | sed 's/.*AppKt test/AppKt/' | head -3
else
  echo "MAESTRO: idle"
fi

echo ""
echo "| App | Target | Active run |"
echo "|-----|--------|------------|"

# Health — done
echo "| **Health** | **163/163 matrix · 14/14 Maestro** | ✅ complete |"

# Budget run14
BLOG="${LOG_DIR}/maestro-budget-full-2026-07-20-run14.log"
if pgrep -fl 'run-budget' >/dev/null 2>&1; then
  BRUN="active"
else
  BRUN="idle"
fi
echo "| Budget | 49/49 Maestro (46 baseline + 4 remaining) | ${BRUN} — $(count_flow_outcomes "${BLOG}") |"

# Kaizen
KLOG="$(ls -t /tmp/kaizen-*.log "${LOG_DIR}"/maestro-kaizen*.log 2>/dev/null | head -1 || true)"
if pgrep -fl 'run-kaizen' >/dev/null 2>&1; then
  KRUN="active"
else
  KRUN="idle"
fi
echo "| Kaizen | 39/39 Maestro (~33 baseline) | ${KRUN} |"

# Language
if pgrep -fl 'run-language' >/dev/null 2>&1; then
  LRUN="active ($(pgrep -fl 'maestro.*language' | sed 's/.*\///;s/\.yaml.*//' | tail -1))"
else
  LRUN="idle"
fi
echo "| Language | 14/14 Maestro (~6 baseline) | ${LRUN} |"

# House
HLOG="$(ls -t "${LOG_DIR}"/house-serial-auth-*.log "${LOG_DIR}"/house-serial-*.log 2>/dev/null | head -1 || true)"
if pgrep -fl 'run-house-suite' >/dev/null 2>&1; then
  HRUN="active (auth cluster)"
else
  HRUN="idle"
fi
echo "| House | 86/86 Maestro (39 baseline) | ${HRUN} — $(count_flow_outcomes "${HLOG:-}") |"

echo ""
echo "Logs: budget→run14.log | house→${HLOG##*/:-—}"
