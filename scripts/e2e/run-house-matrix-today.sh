#!/usr/bin/env bash
# Run full House matrix sequentially; on completion rerun failures once and regenerate RESULTS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"
eval "$(./scripts/secrets/export-env.sh)"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=240000
LOG=/tmp/maestro-house-2026-07-18.log
START="${1:-auth}"

bash scripts/e2e/prune-maestro-disk.sh || true
bash scripts/e2e/run-house-suite-sequential.sh "${START}" "${@:2}" || true

# One failure pass after the full sweep.
FAILED=()
while IFS= read -r base; do
  FAILED+=("$base")
done < <(rg -o '\[Failed\] \K[a-z0-9-]+' "${LOG}" 2>/dev/null | sort -u || true)
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "" >> "${LOG}"
  echo "=== RERUN FAILURES (${#FAILED[@]}) at $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "${LOG}"
  for base in "${FAILED[@]}"; do
    flow="$(find "${ROOT}/e2e/maestro" -name "${base}.yaml" | head -1)"
    [[ -n "${flow}" ]] || continue
    tmp_out="$(mktemp /tmp/maestro-flow.XXXXXX)"
    echo ">>> ${flow}" >> "${LOG}"
    if bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${flow}" >"${tmp_out}" 2>&1; then
      tail -8 "${tmp_out}" >> "${LOG}"
      echo "[Passed] ${base} (rerun)" >> "${LOG}"
    else
      tail -25 "${tmp_out}" >> "${LOG}"
      echo "[Failed] ${base} (rerun)" >> "${LOG}"
    fi
    rm -f "${tmp_out}"
    bash scripts/e2e/prune-maestro-disk.sh || true
  done
fi

python3 scripts/e2e/generate-results-from-logs.py \
  2026-07-18 staging "House-A, iOS 26" house || true
