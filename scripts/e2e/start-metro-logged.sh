#!/usr/bin/env bash
# Start Metro for one brand with console output captured to a log file, so
# generate-report.mjs (via e2e-report.sh) can correlate [E2E-NET]/[E2E-VERIFY]
# lines against the Maestro run that follows.
#
# Always starts with a cleared bundler cache (`--clear`). Metro's transform
# cache is keyed on file content, not on the APP_BRAND/EXPO_PUBLIC_APP_BRAND
# env var that resolveBrandIdFromEnv() reads — so a port that PREVIOUSLY
# served a different brand can still hand back a stale, wrong-brand-baked
# transform for shared brand-resolution modules even after `start-brand.sh`
# regenerates tokens/icons fresh. Observed for real 2026-07-31: a Health run
# on :8085 rendered House's login screen (confirmed via the native
# AppDelegate's own jsLocation pinning being correct — bundle id and port
# both targeted Health, only the served CONTENT was wrong), during exactly
# the dev-client reconnect path e2e/maestro/health/subflows/launch-health.yaml
# already documents as fragile. `--clear` trades a slower first bundle for
# ruling this out; worth it for a suite run where correctness matters more
# than iteration speed.
#
# Usage:
#   ./scripts/e2e/start-metro-logged.sh health
#   ./scripts/e2e/start-metro-logged.sh health --port 8085
#
# Leave this running in its own terminal for the duration of the Maestro
# suite, same as a plain `npm run start:<brand>` — this only adds `tee` +
# `--clear`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

BRAND="${1:?Usage: $0 <house|budget|kaizen|language|health> [--port N]}"
shift || true
PORT="8081"
if [[ "${1:-}" == "--port" ]]; then
  PORT="${2:?--port requires a value}"
  shift 2
fi

LOG="${METRO_LOG:-/tmp/metro-${BRAND}.log}"
: > "${LOG}"
echo "[start-metro-logged] brand=${BRAND} port=${PORT}"
echo "[start-metro-logged] logging to ${LOG}"
echo "[start-metro-logged] when the Maestro run is done: ./scripts/e2e/e2e-report.sh --brand ${BRAND}"

# Reuse a Metro that is ALREADY serving this port instead of racing it.
#
# `npx expo start` on a taken port prompts "Use port 8083 instead?", and under a
# runner there is no tty to answer, so it prints "Skipping dev server" and
# exits 0. The suite then launches a dev-client app with no bundler to attach
# to, produces no output, and dies 420s later to the watchdog — a failure that
# looks like a broken flow but is really a port collision. Seen 2026-08-15
# running a second Budget suite (Budget-C) beside one already on :8082.
if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/status" 2>/dev/null | grep -q 'packager-status:running'; then
  echo "[start-metro-logged] Metro already healthy on :${PORT} — reusing it (no second bundler)" | tee -a "${LOG}"
  echo "[start-metro-logged] NOTE: the running bundler owns the cache; it was not restarted with --clear." | tee -a "${LOG}"
  # Park so callers that background this script keep a live child to wait on.
  while curl -sf --max-time 3 "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; do sleep 5; done
  echo "[start-metro-logged] Metro on :${PORT} went away" | tee -a "${LOG}"
  exit 0
fi

npm run "start:${BRAND}" -- --port "${PORT}" --clear 2>&1 | tee -a "${LOG}"
