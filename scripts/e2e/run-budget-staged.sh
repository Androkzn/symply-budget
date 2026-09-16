#!/usr/bin/env bash
#
# Budget Maestro suite, split BY AREA and run in stages instead of one 91-flow
# march.
#
# ## Why not one big run
#
# The monolithic suite has a failure mode that costs a whole night: when the app
# ends up in a broken install state part-way through — observed repeatedly around
# flows 11-12, and NOT reproducible when those flows run alone — every remaining
# flow launches an app that is not there and fails. One environmental fault
# produced 81 red flows and buried the two that were genuinely broken.
#
# Splitting contains that. A dead area takes only its own flows down, and the
# device is health-checked between areas so one never inherits the previous
# one's wreckage.
#
# ## Areas are the unit, stages are just groups of areas
#
# AREA  = one screen / one piece of functionality. Small enough to run in a
#         couple of minutes and to name a culprit precisely ("savings is red").
# STAGE = the areas you want in one sitting, ordered by what depends on what.
#
# Usage:
#   ./scripts/e2e/run-budget-staged.sh                    # all three stages
#   ./scripts/e2e/run-budget-staged.sh savings            # one AREA
#   ./scripts/e2e/run-budget-staged.sh spending planning  # several areas
#   ./scripts/e2e/run-budget-staged.sh @core              # a STAGE (@ prefix)
#   ./scripts/e2e/run-budget-staged.sh --list             # show the map
#
# Env:
#   BUDGET_APP_BACKUP  built .app used to restore the device when the install
#                      record disappears (default /tmp/budget-app-built.app)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOW_DIR="${ROOT}/e2e/maestro/budget"
APP_ID="com.symply.budget"
APP_BACKUP="${BUDGET_APP_BACKUP:-/tmp/budget-app-built.app}"

# ── AREAS ───────────────────────────────────────────────────────────────────
# Grouped by the screen or feature a failure would point you at.
area_flows() {
  case "$1" in
    session)    echo "budget-prime-session budget-recover-session budget-onboarding-terms budget-auth" ;;
    navigation) echo "budget-tabs budget-customize-tabs budget-corner-testids budget-deep-links" ;;
    dashboard)  echo "budget-dashboard-controls budget-dashboard-widgets budget-dashboard-offline
                      budget-consistency-golden check-spendings-layout" ;;
    settings)   echo "budget-settings budget-settings-extended budget-settings-more
                      budget-settings-offline budget-region-setting budget-data-sharing
                      budget-date-sheet-check" ;;
    spending)   echo "budget-categories budget-category-detail budget-category-inline-create
                      budget-item-form budget-quick-add budget-spend-mutations
                      budget-spent-form budget-spent-select budget-see-all-spending" ;;
    planning)   echo "budget-planned-select budget-plan-delete budget-see-all-planned
                      budget-timeline-year-setup budget-sub-budgets
                      budget-subbudgets-consistency-golden budget-transfer" ;;
    wishes)     echo "budget-wishes budget-wishes-extended" ;;
    households) echo "budget-households budget-household-switch budget-household-extended" ;;
    localfirst) echo "budget-local-first-settings budget-local-first-offline-crud
                      budget-local-first-sync-pulse budget-local-first-no-financial-d1
                      budget-local-first-ai-detect" ;;
    backup)     echo "budget-local-first-backup budget-local-first-backup-destinations
                      budget-local-first-auto-backup budget-local-first-restore-ui" ;;
    transfer)   echo "budget-local-first-soft-transfer budget-soft-transfer-export
                      budget-soft-transfer-import" ;;
    offline)    echo "budget-offline-sweep" ;;
    savings)    echo "budget-savings-overview budget-savings-goal budget-savings-import
                      budget-savings-income-entry budget-savings-irregular-income
                      budget-savings-month-stepper budget-savings-offline
                      budget-savings-recurring budget-savings-renewal-reminder" ;;
    pension)    echo "budget-pension budget-pension-interactions budget-pension-offline
                      budget-local-first-pension-import" ;;
    mortgage)   echo "mortgage-setup mortgage-tabs mortgage-tabs-customize mortgage-settings
                      mortgage-forecast mortgage-history mortgage-multi-property
                      mortgage-renewal-offers mortgage-statements-manage
                      mortgage-title-switcher budget-local-first-mortgage-statement" ;;
    receipts)   echo "budget-receipt-scan budget-receipt-scan-save budget-receipt-scan-quality
                      budget-receipt-category" ;;
    ai)         echo "budget-ai-screen budget-ai-providers budget-ai-consent" ;;
    chat)       echo "budget-chat-rooms budget-chat-message budget-chat-fab-visible
                      budget-chat-assistant budget-chat-assistant-room budget-chat-extended" ;;
    *) return 1 ;;
  esac
}

# ── STAGES ──────────────────────────────────────────────────────────────────
# Ordered by dependency: if `core` is red, nothing below it can be trusted.
# `chat` sits last on purpose — it holds the known-flaky flows, and putting it
# at the end means its failures cannot poison the areas that matter more.
stage_areas() {
  case "$1" in
    core)     echo "session navigation dashboard settings spending planning wishes" ;;
    data)     echo "households localfirst backup transfer offline" ;;
    features) echo "savings pension mortgage receipts ai chat" ;;
    *) return 1 ;;
  esac
}

ALL_AREAS="session navigation dashboard settings spending planning wishes
           households localfirst backup transfer offline
           savings pension mortgage receipts ai chat"

if [[ "${1:-}" == "--list" ]]; then
  for s in core data features; do
    printf '\n@%s\n' "$s"
    for a in $(stage_areas "$s"); do
      printf '  %-11s %s\n' "$a" "$(area_flows "$a" | tr -s ' \n' ' ' | wc -w | tr -d ' ') flows"
    done
  done
  exit 0
fi

# Expand args: @stage → its areas; bare name → that area. Default: everything.
TARGETS=""
if (($# == 0)); then
  TARGETS="${ALL_AREAS}"
else
  for arg in "$@"; do
    if [[ "${arg}" == @* ]]; then
      more="$(stage_areas "${arg#@}")" || { echo "unknown stage ${arg}" >&2; exit 2; }
      TARGETS="${TARGETS} ${more}"
    elif area_flows "${arg}" >/dev/null 2>&1; then
      TARGETS="${TARGETS} ${arg}"
    else
      echo "unknown area '${arg}' — try --list" >&2; exit 2
    fi
  done
fi

# Device comes from the brand registry (honouring E2E_DEVICE), never a name
# spelled here: the per-flow runner below already resolves it that way, so a
# hardcoded "Budget-A" made this script's health checks probe — and reinstall
# on — a DIFFERENT device than the one the flows were driving whenever a run
# was pointed at Budget-B/-C. That is how a second session's device gets its
# app replaced mid-suite.
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "$0")/maestro-fleet-brand.sh"
UDID="$(maestro_fleet_brand_udid budget)"

# ONE report for the whole staged run, not one per flow.
#
# `run-budget-suite-live-report.sh` mints a fresh timestamped directory per
# invocation, and this runner invokes it once per flow — which produced 46
# separate report directories in a single evening and no page to actually watch.
# Pinning REPORT_OUT makes every flow regenerate the SAME report, so it grows as
# the run proceeds and `latest` keeps pointing at it.
# Size the report's progress bar to THIS run, not the 91-flow workspace — see
# E2E_PROGRESS_TOTAL in run-budget-suite-live-report.sh.
_total=0
for _a in ${TARGETS}; do
  for _f in $(area_flows "${_a}"); do
    [[ -f "${FLOW_DIR}/${_f}.yaml" ]] && _total=$((_total+1))
  done
done
export E2E_PROGRESS_TOTAL="${_total}"

export REPORT_OUT="${REPORT_OUT:-${ROOT}/documents/engineering/testing/reports/budget/staged-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "${REPORT_OUT}"
ln -sfn "$(basename "${REPORT_OUT}")" "${ROOT}/documents/engineering/testing/reports/budget/latest"
echo "[staged] live report: ${REPORT_OUT}/index.html  (${E2E_PROGRESS_TOTAL} flows:${TARGETS})"

# The device must be sound BEFORE an area starts, or the area measures the
# previous one's wreckage rather than its own flows.
ensure_app() {
  if ! xcrun simctl get_app_container "${UDID}" "${APP_ID}" >/dev/null 2>&1; then
    echo "[staged] app missing — restoring from ${APP_BACKUP}"
    [[ -d "${APP_BACKUP}" ]] || { echo "[staged] no backup at ${APP_BACKUP}; build first" >&2; return 1; }
    xcrun simctl boot "${UDID}" 2>/dev/null || true
    xcrun simctl install "${UDID}" "${APP_BACKUP}" || return 1

    # A reinstall restores the BINARY and nothing else: the Keychain session and
    # the local-first ledger are gone with the old container. Every flow after
    # this point would then fail on a signed-out app and read as a product
    # defect — observed on 2026-08-17, where a restore mid-`settings` turned the
    # whole `spending` area red even though `budget-categories` passes in
    # isolation. Re-prime before handing the device back.
    echo "[staged] re-priming session after restore"
    "${ROOT}/scripts/e2e/run-budget-suite-live-report.sh" \
      "${FLOW_DIR}/budget-prime-session.yaml" >/tmp/staged-reprime.log 2>&1 \
      || echo "[staged] WARNING: re-prime failed — results after this are suspect"
  fi
}

OVERALL=0
SUMMARY=""
for area in ${TARGETS}; do
  echo ""
  echo "######## AREA: ${area} ########"
  ensure_app || { echo "[staged] skipping ${area} — no app"; OVERALL=1; SUMMARY="${SUMMARY}\n  ${area}: SKIPPED (no app)"; continue; }

  pass=0; fail=0; failed=""
  for f in $(area_flows "${area}"); do
    [[ -f "${FLOW_DIR}/${f}.yaml" ]] || { echo "[staged] missing ${f}"; continue; }
    echo "=== ${f} ==="
    if "${ROOT}/scripts/e2e/run-budget-suite-live-report.sh" "${FLOW_DIR}/${f}.yaml" \
         >"/tmp/staged-${f}.log" 2>&1; then
      echo "[Passed] ${f}"; pass=$((pass+1))
    else
      echo "[Failed] ${f}"; fail=$((fail+1)); failed="${failed} ${f}"
    fi
    # Catch the broken-install state the moment it happens, so the rest of this
    # area is not reported as failing when it never actually ran.
    if ! xcrun simctl get_app_container "${UDID}" "${APP_ID}" >/dev/null 2>&1; then
      echo "!! app vanished after ${f} (free=$(df -h /System/Volumes/Data | awk 'NR==2{print $4}'))"
      ensure_app || break
    fi
  done

  echo "---- ${area}: ${pass} passed / ${fail} failed ----"
  SUMMARY="${SUMMARY}\n  $(printf '%-11s' "${area}") ${pass} passed / ${fail} failed${failed:+ →${failed}}"
  (( fail > 0 )) && OVERALL=1
done

echo ""
echo "======== STAGED RUN SUMMARY ========"
printf '%b\n' "${SUMMARY}"
echo "exit ${OVERALL}"
exit "${OVERALL}"
