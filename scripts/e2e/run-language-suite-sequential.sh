#!/usr/bin/env bash
# Run Language Maestro flows one-at-a-time with logging (config.yaml order).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${LOG:-/tmp/maestro-language-2026-07-19.log}"
: >"${LOG}"

echo ">>> Prime session" | tee -a "${LOG}"
bash "${ROOT}/scripts/e2e/run-language-suite.sh" "${ROOT}/e2e/maestro/language/language-prime-session.yaml" 2>&1 | tee -a "${LOG}" | tail -5

FLOWS=(
  shell-customize-tabs
  shell-tutor-draft
  learn-home
  assessment
  dialogue
  plan
  review
  tutor
  more-settings
  more-reset-learning
  language-auth-validation
  more-sign-out
  onboarding
)

for flow in "${FLOWS[@]}"; do
  yaml="${ROOT}/e2e/maestro/language/${flow}.yaml"
  [[ -f "${yaml}" ]] || continue
  echo "" >>"${LOG}"
  echo ">>> ${yaml}" | tee -a "${LOG}"
  MAESTRO_DEBUG=0 bash "${ROOT}/scripts/e2e/run-language-suite.sh" "${yaml}" 2>&1 | tee -a "${LOG}" | tail -8
  rc=${PIPESTATUS[0]}
  if [[ "${rc}" -eq 0 ]]; then
    echo "[Passed] ${flow}" | tee -a "${LOG}"
  else
    echo "[Failed] ${flow} (exit ${rc})" | tee -a "${LOG}"
  fi
  sleep 8
  bash "${ROOT}/scripts/e2e/prune-maestro-disk.sh" || true
done

echo "Log: ${LOG}"
