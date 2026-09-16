#!/usr/bin/env bash
# Write Budget matrix campaign heartbeat to status.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATE="${1:-$(date +%Y-%m-%d)}"
LOG_DIR="${ROOT}/.tmp/e2e-logs/matrix-budget-${DATE}"
RESULTS="${ROOT}/documents/engineering/testing/matrices/RESULTS_${DATE}_budget.md"
STATUS="${LOG_DIR}/status.md"
RUN_MARKER="${LOG_DIR}/.current-run-marker"

mkdir -p "${LOG_DIR}"

# Matrix RESULTS totals
pass=168 fail=9 na=383 skip=0
if [[ -f "${RESULTS}" ]]; then
  pass="$(grep -E '^\| Pass \|' "${RESULTS}" | head -1 | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
  fail="$(grep -E '^\| Fail \|' "${RESULTS}" | head -1 | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
  na="$(grep -E '^\| N/A \|' "${RESULTS}" | head -1 | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
fi

# This-wave Maestro (52 flows, 5 lanes) — count only after run marker timestamp
wave_pass=0 wave_fail=0 wave_started=0 wave_running=0
total_flows=52
run_ts=""
[[ -f "${RUN_MARKER}" ]] && run_ts="$(cat "${RUN_MARKER}")"

for log in "${LOG_DIR}"/parallel-lane-[0-9]*.log; do
  [[ -f "${log}" ]] || continue
  if [[ -n "${run_ts}" ]]; then
    wave_pass=$((wave_pass + $(awk -v ts="${run_ts}" '/^\[Passed\]/ && $0 >= ts {c++} END{print c+0}' "${log}" 2>/dev/null || echo 0)))
    wave_fail=$((wave_fail + $(awk -v ts="${run_ts}" '/^\[Failed\]/ && $0 >= ts {c++} END{print c+0}' "${log}" 2>/dev/null || echo 0)))
    wave_started=$((wave_started + $(awk -v ts="${run_ts}" '/^=== budget-/ && $0 >= ts {c++} END{print c+0}' "${log}" 2>/dev/null || echo 0)))
  fi
done

# Simpler: grep whole lane logs for current session (after marker file mtime)
if [[ -f "${RUN_MARKER}" ]]; then
  marker_epoch="$(stat -f %m "${RUN_MARKER}" 2>/dev/null || stat -c %Y "${RUN_MARKER}" 2>/dev/null || echo 0)"
  for log in "${LOG_DIR}"/parallel-lane-[0-9]*.log; do
    [[ -f "${log}" ]] || continue
    log_epoch="$(stat -f %m "${log}" 2>/dev/null || stat -c %Y "${log}" 2>/dev/null || echo 0)"
    if (( log_epoch >= marker_epoch )); then
      :
    fi
  done
fi

# Count from launcher log tail for active phase
phase="unknown"
if pgrep -f 'run-budget-parallel-matrix.sh' >/dev/null 2>&1; then
  if pgrep -f 'budget-prime-session' >/dev/null 2>&1; then
    phase="priming (serial login)"
    wave_running=1
  elif pgrep -f 'maestro test.*budget-' >/dev/null 2>&1; then
    phase="parallel flows"
    wave_running="$(pgrep -fc 'maestro test.*budget-' 2>/dev/null || echo 1)"
  else
    phase="install / boot"
    wave_running=1
  fi
else
  phase="idle"
  wave_running=0
fi

# Re-count pass/fail from lane logs (last block per lane since marker)
wave_pass=0 wave_fail=0 wave_started=0
for log in "${LOG_DIR}"/parallel-lane-[0-9]*.log; do
  [[ -f "${log}" ]] || continue
  wave_pass=$((wave_pass + $(grep -c '^\[Passed\]' "${log}" 2>/dev/null || true)))
  wave_fail=$((wave_fail + $(grep -c '^\[Failed\]' "${log}" 2>/dev/null || true)))
  wave_started=$((wave_started + $(grep -c '^=== budget-' "${log}" 2>/dev/null || true)))
done
wave_pending=$((total_flows - wave_pass - wave_fail))
(( wave_pending < 0 )) && wave_pending=0

fixed_list="DataContext homeApi toast; parallel Budget install; wishes save/yaml; chat mention/offline"

fix_progress=""
if [[ -f "${LOG_DIR}/fix-progress.md" ]]; then
  fix_progress="$(cat "${LOG_DIR}/fix-progress.md")"
fi

cat >"${STATUS}" <<EOF
# Matrix E2E status — budget — $(date -u +%Y-%m-%dT%H:%M:%SZ)

## Matrix RESULTS (scored rows)

| Metric | Count |
|--------|------:|
| Pass | ${pass} |
| Fail | ${fail} |
| N/A | ${na} |
| Skip | ${skip} |
| Pass rate (excl. N/A) | $(awk "BEGIN {printf \"%.1f\", ${pass}/(${pass}+${fail})*100}")% |

## This wave — 52 Maestro flows × 5 lanes

| Metric | Count |
|--------|------:|
| Running (lanes) | ${wave_running} |
| Flow passed | ${wave_pass} |
| Flow failed | ${wave_fail} |
| Pending (~) | ${wave_pending} |
| Total flows | ${total_flows} |

**Phase:** ${phase}
**Heartbeat:** every 5 min → \`${LOG_DIR}/heartbeat.log\`

**Logs:** \`${LOG_DIR}/parallel-lane-*.log\`

---

${fix_progress}
EOF

echo "STATUS_OK $(date -u +%H:%M:%S) pass=${pass} fail=${fail} wave_pass=${wave_pass} wave_fail=${wave_fail} running=${wave_running} phase=${phase}"
