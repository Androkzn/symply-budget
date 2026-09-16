#!/usr/bin/env bash
# Umbrella runner: runs every app's Maestro UI suite serially on one simulator.
# For parallel fleet (5 sims + 5 Metros), use scripts/e2e/run-fleet-parallel.sh instead.
#
# Usage:
#   eval "$(./scripts/secrets/export-env.sh)"   # or ensure e2e/credentials.local exists
#   E2E_DEVICE=Kaizen-A ./scripts/e2e/run-all-suites.sh            # all 5 apps
#   APPS="kaizen budget" ./scripts/e2e/run-all-suites.sh               # subset
#
# Notes / known gates (see documents/engineering/ui-test-audit-2026-07-17.md §Runnability):
#  - Every app OTA-downloads its JS bundle on cold launch; the per-suite launch
#    subflows extendedWaitUntil past the "Downloading…" screen.
#  - Health authenticated flows require a SEEDED Health account + login-button
#    testIDs (its login buttons are not matchable by text today) — until then only
#    Health's login-surface/pre-auth flows pass.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPS="${APPS:-platform kaizen budget house language health}"

pass=0; fail=0; failed_apps=()
for app in ${APPS}; do
  runner="${ROOT}/scripts/e2e/run-${app}-suite.sh"
  if [[ ! -x "${runner}" && ! -f "${runner}" ]]; then
    echo "!! no runner for '${app}' (${runner})"; fail=$((fail+1)); failed_apps+=("${app}:no-runner"); continue
  fi
  echo "=================================================================="
  echo ">> ${app} suite"
  echo "=================================================================="
  if bash "${runner}"; then pass=$((pass+1)); else fail=$((fail+1)); failed_apps+=("${app}"); fi
done

echo "=================================================================="
echo "All-suites summary — passed apps: ${pass}, failed apps: ${fail}"
for a in "${failed_apps[@]:-}"; do [[ -n "${a}" ]] && echo "   - ${a}"; done
exit 0
