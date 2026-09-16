#!/usr/bin/env bash
# One-command visual + backend Maestro report (wraps generate-report.mjs).
#
# generate-report.mjs itself only needs three flags, but nobody had scripted
# "find the run I just did, find the Metro log for it, generate the HTML" as
# one command for any brand — this closes that gap. Pair with
# start-metro-logged.sh, which is the other half (captures the Metro console
# output this depends on).
#
# Usage:
#   ./scripts/e2e/e2e-report.sh --brand health                  # latest run
#   ./scripts/e2e/e2e-report.sh --brand health --run 2026-07-31_113428
#   ./scripts/e2e/e2e-report.sh --brand health --metro-log /path --out /tmp/x
#   ./scripts/e2e/e2e-report.sh --brand health --no-open
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

BRAND=""
RUN=""
METRO_LOG=""
OUT=""
DO_OPEN=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --brand) BRAND="${2:?}"; shift 2 ;;
    --run) RUN="${2:?}"; shift 2 ;;
    --metro-log) METRO_LOG="${2:?}"; shift 2 ;;
    --out) OUT="${2:?}"; shift 2 ;;
    --no-open) DO_OPEN=0; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$BRAND" ]]; then
  echo "Usage: $0 --brand <house|budget|kaizen|language|health> [--run <timestamp>] [--metro-log <file>] [--out <dir>] [--no-open]" >&2
  exit 1
fi

if [[ -z "$METRO_LOG" ]]; then
  METRO_LOG="/tmp/metro-${BRAND}.log"
fi
if [[ ! -f "$METRO_LOG" ]]; then
  echo "[e2e-report] warning: no Metro log at ${METRO_LOG} — the report will have screenshots/steps but no backend-call detail." >&2
  echo "[e2e-report] next time, start Metro with: ./scripts/e2e/start-metro-logged.sh ${BRAND}" >&2
fi

MAESTRO_TESTS_DIR="${HOME}/.maestro/tests"
if [[ -z "$RUN" ]]; then
  RUN="$(ls -t "${MAESTRO_TESTS_DIR}" 2>/dev/null | head -1)"
fi
if [[ -z "$RUN" ]]; then
  echo "No Maestro runs found under ${MAESTRO_TESTS_DIR}" >&2
  exit 1
fi
MAESTRO_DIR="${MAESTRO_TESTS_DIR}/${RUN}"
if [[ ! -d "$MAESTRO_DIR" ]]; then
  echo "Maestro run not found: ${MAESTRO_DIR}" >&2
  exit 1
fi

if [[ -z "$OUT" ]]; then
  OUT="/tmp/e2e-report/${BRAND}-${RUN}"
fi

# Report header metadata — the coloured chips (Platform / Env / Build / Device)
# in the report header. `renderRunInfo` in generate-report.mjs renders NOTHING
# when these are absent, so a report generated without them silently loses the
# whole header strip. This wrapper omitted all four until 2026-08-13, which is
# why reports made through it never showed the chips while the four
# `run-*-live-report.sh` runners' did — the same defect class as the
# `flowsOrder` drift: one code path quietly producing less than its twin.
#
# Build number comes from the BRAND PACK, not root app.json/app.config.ts —
# those reflect whichever brand was last resolved into native config, not the
# app this run exercised.
REPORT_PLATFORM="${E2E_REPORT_PLATFORM:-iOS}"
REPORT_ENVIRONMENT="${EXPO_PUBLIC_API_ENV:-staging}"
REPORT_BUILD_NUMBER="$(node -e "console.log(require('${ROOT}/brands/symply-${BRAND}/brand.cjs').iosBuildNumber)" 2>/dev/null || true)"
# Fall back to the fleet registry's device for this brand rather than a
# hardcoded name (see maestro-fleet-brand.sh — a hardcoded name is how
# registries go stale).
REPORT_DEVICE="${E2E_DEVICE:-${E2E_DEVICE_A:-}}"
REPORT_META_ARGS=(--platform "$REPORT_PLATFORM" --environment "$REPORT_ENVIRONMENT")
[[ -n "$REPORT_BUILD_NUMBER" ]] && REPORT_META_ARGS+=(--build-number "$REPORT_BUILD_NUMBER")
[[ -n "$REPORT_DEVICE" ]] && REPORT_META_ARGS+=(--device "$REPORT_DEVICE")

echo "[e2e-report] brand=${BRAND} run=${RUN}"
echo "[e2e-report] maestro-dir=${MAESTRO_DIR}"
echo "[e2e-report] metro-log=${METRO_LOG}"
echo "[e2e-report] out=${OUT}"
echo "[e2e-report] header: platform=${REPORT_PLATFORM} env=${REPORT_ENVIRONMENT} build=${REPORT_BUILD_NUMBER:-—} device=${REPORT_DEVICE:-—}"

node "${ROOT}/scripts/e2e/generate-report.mjs" \
  --maestro-dir "${MAESTRO_DIR}" \
  --metro-log "${METRO_LOG}" \
  --out "${OUT}" \
  "${REPORT_META_ARGS[@]}"

INDEX="${OUT}/index.html"
if [[ ! -f "$INDEX" ]]; then
  # A single-flow run only ever writes one <flow>.html, no index.
  INDEX="$(ls "${OUT}"/*.html 2>/dev/null | head -1)"
fi

echo "[e2e-report] report ready: ${INDEX}"
if [[ "$DO_OPEN" -eq 1 && -n "$INDEX" ]] && command -v open >/dev/null 2>&1; then
  open "${INDEX}"
fi
