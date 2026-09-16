#!/usr/bin/env bash
# Verify a single House Maestro flow with retries (parallel-safe with other fleet brands).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOW="${1:?flow name e.g. chat-rooms-screen}"
ATTEMPTS="${2:-5}"
PROGRESS="${3:-/tmp/house-fix-progress.log}"
TOTAL="${4:-47}"
FIXED_LIST="${5:-/tmp/house-fix-fixed.txt}"

find_flow() {
  find "${ROOT}/e2e/maestro" -name "$1.yaml" -print -quit 2>/dev/null || true
}

path="$(find_flow "${FLOW}")"
if [[ -z "${path}" ]]; then
  echo "[Skip] ${FLOW} — yaml not found" | tee -a "${PROGRESS}"
  exit 2
fi

touch "${FIXED_LIST}"

xcrun simctl boot 8E457DDC-4E0A-4202-9195-9C69D78AD1F4 2>/dev/null || true
curl -sf http://localhost:8083/status >/dev/null || {
  echo "Metro :8083 down — start APP_BRAND=symply-house npx expo start --port 8083" | tee -a "${PROGRESS}"
  exit 3
}

PRIME="${ROOT}/e2e/maestro/smoke/house-prime-session.yaml"
if [[ -f "${PRIME}" ]]; then
  echo "=== PRIME house session ===" | tee -a "${PROGRESS}"
  E2E_SEED_FIXTURES=0 MAESTRO_DEBUG=0 E2E_MAESTRO_CLEANUP=0 bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${PRIME}" \
    >>/tmp/house-prime-session.log 2>&1 || true
fi

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  echo "=== VERIFY ${FLOW} attempt ${attempt}/${ATTEMPTS} ===" | tee -a "${PROGRESS}"
  xcrun simctl boot 8E457DDC-4E0A-4202-9195-9C69D78AD1F4 2>/dev/null || true
  mkdir -p "${HOME}/.maestro/tests" "${HOME}/Library/Logs/maestro"
  log="/tmp/house-verify-${FLOW}.log"
  if E2E_SEED_FIXTURES=0 MAESTRO_DEBUG=0 E2E_MAESTRO_CLEANUP=0 bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${path}" >"${log}" 2>&1; then
    if ! grep -qx "${FLOW}" "${FIXED_LIST}" 2>/dev/null; then
      echo "${FLOW}" >>"${FIXED_LIST}"
    fi
    fixed="$(wc -l <"${FIXED_LIST}" | tr -d ' ')"
    left=$((TOTAL - fixed))
    echo "[GREEN] ${FLOW} — ${fixed}/${TOTAL} fixed, ${left} remaining" | tee -a "${PROGRESS}"
    exit 0
  fi
  if grep -qE "Killed: 9|Unable to lookup in current state: Shutdown|FileNotFoundException.*maestro/tests" "${log}" 2>/dev/null; then
    echo "[Retry] ${FLOW} — infra flake (scoped kill/sim shutdown); retrying..." | tee -a "${PROGRESS}"
    sleep 10
    continue
  fi
  echo "[RED] ${FLOW} — failed (see ${log})" | tee -a "${PROGRESS}"
  exit 1
done

echo "[RED] ${FLOW} — exhausted ${ATTEMPTS} attempts" | tee -a "${PROGRESS}"
exit 1
