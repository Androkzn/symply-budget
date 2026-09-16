#!/usr/bin/env bash
# Run the test suite for ONE Symply Health area, on its own.
#
# WHY THIS EXISTS. Health's coverage is spread across three runners (Jest for the
# RN surface, Vitest for the Worker, Maestro for the device) and 100+ files. Asking
# "is Cycle covered?" used to mean grepping for the right paths in three places.
# This maps an AREA to its slice of all three, so an area can be verified — or
# re-verified after a change — in one command.
#
# Usage:
#   scripts/test/health-area.sh list
#   scripts/test/health-area.sh <area>              # Jest + Vitest for the area
#   scripts/test/health-area.sh <area> --coverage   # …with coverage for its sources
#   scripts/test/health-area.sh <area> --fe         # Jest only
#   scripts/test/health-area.sh <area> --be         # Vitest only
#   scripts/test/health-area.sh <area> --maestro    # device slice (serial, needs a sim)
#   scripts/test/health-area.sh all                 # every area, sequentially
#
# The Maestro slice is NEVER run as part of the default invocation: device E2E needs
# one booted simulator, holds a global lock (scripts/e2e/maestro-global-lock.sh) and
# drops its driver under load on iOS 26. Ask for it explicitly with --maestro.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

# area | jest testPathPattern | vitest paths (space-separated, relative to backend/)
#      | coverage globs (comma-separated) | maestro feature tag
#
# Jest patterns intentionally match BOTH the per-area files under
# src/features/health/__tests__/areas/<area>.*.test.* and the pre-existing suites
# that already own part of the area, so the slice is the whole area and not just
# the new work.
read -r -d '' AREA_TABLE <<'TABLE'
body|areas/body\.|health/__tests__/healthBodyStorage|HealthBodyDashboard|src/routes/__tests__/health-measurements.test.ts|src/features/health/healthBodyStorage.ts,src/features/health/screens/HealthBodyScreen.tsx,src/features/health/components/HealthBodyProgress.tsx|body
home|areas/home\.|HealthHomeScreen|healthDashboards|HealthDashboards||src/features/health/screens/HealthHomeScreen.tsx,src/features/health/components/HealthDashboardCards.tsx|home
cycle|areas/cycle\.|healthCycleStorage|HealthCycleVitalityScreens|src/routes/__tests__/health-cycle.test.ts|src/features/health/healthCycleStorage.ts,src/features/health/screens/HealthCycleScreen.tsx|cycle
vitality|areas/vitality\.|healthVitalityStorage|HealthCycleVitalityScreens|src/routes/__tests__/health-mens-health.test.ts|src/features/health/healthVitalityStorage.ts,src/features/health/screens/HealthVitalityScreen.tsx|vitality
habits|areas/habits\.|healthHabitsStorage|src/routes/__tests__/health-habits.test.ts|src/features/health/healthHabitsStorage.ts,src/features/health/screens/HealthHabitsScreen.tsx|habits
water|areas/water\.|src/routes/__tests__/health-water.test.ts|src/features/health/healthLocalStorage.ts|home
more|areas/more\.|HealthMoreScreen|src/routes/__tests__/health-activity-preferences.test.ts|src/features/health/screens/HealthMoreScreen.tsx|more
notifications|areas/notifications\.|src/routes/__tests__/health-notify-flags.test.ts src/routes/__tests__/health-body-extras.test.ts||n/a
files|areas/files\.|src/routes/__tests__/health-files.test.ts src/routes/__tests__/health-assets.test.ts src/services/__tests__/health-assets-service.test.ts||n/a
fridge|areas/fridge\.|healthFridgeStorage|HealthFridgeScreen|src/routes/__tests__/health-assets-fridge.test.ts|src/features/health/healthFridgeStorage.ts,src/features/health/screens/HealthFridgeScreen.tsx|fridge
coach|areas/coach\.|healthCoachStorage|HealthCoachScreen|HealthScanScreen|src/routes/__tests__/health-ai.test.ts src/routes/__tests__/health-body-insights.test.ts src/services/__tests__/health-ai-coach-service.test.ts|src/features/health/healthCoachStorage.ts,src/features/health/screens/HealthCoachScreen.tsx,src/api/healthAi.ts|coach
voice|areas/voice\.|||n/a
social|areas/social\.|src/routes/__tests__/health-social.test.ts src/routes/__tests__/health-social-gate.test.ts src/routes/__tests__/health-social-authz.test.ts src/services/__tests__/health-social-service.test.ts||n/a
widget|areas/widget\.|widget-health-schema|src/routes/__tests__/health-assets-widget.test.ts|src/services/widget-sync.ts|n/a
deskhero|areas/deskhero\.|||n/a
platform|areas/platform\.|healthTabShell||src/navigation/tabRegistry.ts,src/navigation/useEffectiveTabs.ts,src/components/ai/useAIAccessEntry.ts|more
TABLE

AREAS=(body home cycle vitality habits water more notifications files fridge coach voice social widget deskhero platform)

usage() {
  echo "Usage: $0 <area|list|all> [--fe|--be|--maestro|--coverage]"
  echo "Areas: ${AREAS[*]}"
}

# Fields are pipe-separated but the jest column may itself contain several
# alternatives, so parse from BOTH ends: field 1 is the area, the last three are
# vitest / coverage / maestro, and everything between is the Jest pattern.
area_row() {
  local want="$1" line
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    [[ "${line%%|*}" == "${want}" ]] && { echo "${line}"; return 0; }
  done <<< "${AREA_TABLE}"
  return 1
}

run_area() {
  local area="$1" mode="$2" coverage="$3"
  local row fields n jest_pat vitest_paths cov_globs
  row="$(area_row "${area}")" || { echo "Unknown area: ${area}"; usage; return 2; }

  IFS='|' read -r -a fields <<< "${row}"
  n=${#fields[@]}
  cov_globs="${fields[$((n-2))]}"
  vitest_paths="${fields[$((n-3))]}"
  # Jest alternatives = everything between the area name and the vitest column.
  jest_pat=""
  local i
  for ((i = 1; i <= n - 4; i++)); do
    [[ -z "${fields[i]}" ]] && continue
    jest_pat="${jest_pat:+${jest_pat}|}${fields[i]}"
  done

  local rc=0
  echo "══════════════════════════════════════════════════════════════"
  echo "AREA: ${area}"
  echo "══════════════════════════════════════════════════════════════"

  if [[ "${mode}" == "all" || "${mode}" == "fe" ]]; then
    if [[ -n "${jest_pat}" ]]; then
      echo "── Jest ─────────────────────────────────────────────────────"
      local -a jest_args=(--runInBand --testPathPattern "${jest_pat}")
      if [[ "${coverage}" == "1" && -n "${cov_globs}" ]]; then
        jest_args+=(--coverage --coverageReporters=text-summary)
        local g
        IFS=',' read -r -a cov_list <<< "${cov_globs}"
        for g in "${cov_list[@]}"; do jest_args+=(--collectCoverageFrom="${g}"); done
      fi
      npx jest "${jest_args[@]}" || rc=1
    else
      echo "── Jest: no RN surface for this area (see the matrix) ───────"
    fi
  fi

  if [[ "${mode}" == "all" || "${mode}" == "be" ]]; then
    if [[ -n "${vitest_paths}" ]]; then
      echo "── Vitest (Worker) ──────────────────────────────────────────"
      local -a vt=()
      read -r -a vt <<< "${vitest_paths}"
      local -a present=()
      local p
      for p in "${vt[@]}"; do [[ -f "backend/${p}" ]] && present+=("${p}"); done
      if ((${#present[@]})); then
        (cd backend && npx vitest run "${present[@]}") || rc=1
      else
        echo "   (no Worker test files present yet for this area)"
      fi
    fi
  fi

  if [[ "${mode}" == "maestro" ]]; then
    local tag="${fields[$((n-1))]}"
    if [[ "${tag}" == "n/a" ]]; then
      echo "── Maestro: no device surface for this area ─────────────────"
    else
      echo "── Maestro (serial, one simulator) ──────────────────────────"
      bash scripts/e2e/run-feature.sh health "${tag}" || rc=1
    fi
  fi

  return "${rc}"
}

main() {
  local target="${1:-}"; shift || true
  local mode="all" coverage=0 arg
  for arg in "$@"; do
    case "${arg}" in
      --fe) mode="fe" ;;
      --be) mode="be" ;;
      --maestro) mode="maestro" ;;
      --coverage) coverage=1 ;;
      *) echo "Unknown flag: ${arg}"; usage; exit 2 ;;
    esac
  done

  case "${target}" in
    ""|-h|--help|help) usage; exit 0 ;;
    list) printf '%s\n' "${AREAS[@]}"; exit 0 ;;
    # `columns` prints how each row PARSES, not how it was typed. The table is
    # pipe-separated with a variable-width Jest column, so a missing empty field
    # silently shifts a Jest pattern into the Vitest slot and the area quietly
    # under-runs. This makes that visible without executing a single test.
    columns)
      local a row fields n
      for a in "${AREAS[@]}"; do
        row="$(area_row "${a}")" || continue
        IFS='|' read -r -a fields <<< "${row}"
        n=${#fields[@]}
        local jp="" i
        for ((i = 1; i <= n - 4; i++)); do
          [[ -z "${fields[i]}" ]] && continue
          jp="${jp:+${jp}|}${fields[i]}"
        done
        printf '%-14s jest=%-70s vitest=%-40s maestro=%s\n' \
          "${a}" "${jp:--}" "${fields[$((n-3))]:--}" "${fields[$((n-1))]}"
      done
      exit 0
      ;;
    all)
      local failed=() a
      for a in "${AREAS[@]}"; do
        run_area "${a}" "${mode}" "${coverage}" || failed+=("${a}")
      done
      echo
      echo "══════════════════════════════════════════════════════════════"
      if ((${#failed[@]})); then
        echo "FAILED areas (${#failed[@]}/${#AREAS[@]}): ${failed[*]}"
        exit 1
      fi
      echo "All ${#AREAS[@]} areas passed."
      ;;
    *) run_area "${target}" "${mode}" "${coverage}" || exit 1 ;;
  esac
}

main "$@"
