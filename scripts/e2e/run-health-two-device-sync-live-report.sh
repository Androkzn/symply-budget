#!/usr/bin/env bash
#
# Symply Health V2 local-first — TWO-DEVICE, ONE-USER sync E2E (stage He12(partial)).
#
# THE ONE THING THAT MAKES THIS DIFFERENT FROM THE BUDGET SUITE IT WAS PORTED
# FROM: both simulators sign in as the SAME Symply account. A Health household is
# one user with N devices (plan §1.2 / §6) — there is no owner and no invitee,
# the second device enrols over `simplehealth://lf-invite`, and the Worker
# refuses a second `user_id` outright. `run-budget-multi-member-sync.sh` requires
# two DIFFERENT accounts and fails if they match; this runner requires the
# opposite and fails if a secondary account is configured.
#
# WHAT IT GATES BEFORE IT RUNS ANYTHING (each of these is a DoD line, not a
# convenience check — see documents/engineering/testing/HEALTH_TWO_DEVICE_SYNC_E2E.md):
#
#   1. WORKER VERSION ID vs the client's `backend/src` commit (plan §14 step 13).
#      The deployed Health Worker must be built from the SAME `backend/src`
#      commit as the binary under test AND its version must POSTDATE that commit.
#      Both halves are compared, not printed.
#   2. BRAND DEFAULT OFF. `flag.ts` brand-defaults local-first ON for
#      `symply-health` when `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` is unset, so every
#      `symply-health*` profile in `eas.json` must pin it to "0" until He12
#      (full). `extends` chains are resolved.
#   3. LAB FLAG ON, EXPLICITLY. This suite's Metro is started with
#      `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1` — internal/lab only. The bundle it
#      serves is checked for a residual un-inlined `process.env.` reference,
#      which is what an env that never reached the Babel inline plugin looks like.
#
# DEVICES — resolved from the fleet registry, never hardcoded:
#   A  scripts/e2e/maestro-fleet-brand.sh  health.device    (default Health-A)
#   B  scripts/e2e/maestro-fleet-brand.sh  health.device_b  (default Health-B)
# Override per run with E2E_DEVICE_A / E2E_DEVICE_B. Missing devices are created.
# Per global policy this is the app's ONE pair: no other Health suite may run at
# the same time as this one.
#
# Usage:
#   ./scripts/e2e/run-health-two-device-sync-live-report.sh
#   TD_PARALLEL=0 ./scripts/e2e/run-health-two-device-sync-live-report.sh
#   HEALTH_VERSION_GATE=warn ./scripts/e2e/run-health-two-device-sync-live-report.sh
#
# Report: documents/engineering/testing/reports/health-two-device/<ts>/index.html
#
# `set -uo pipefail`, NOT `set -euo pipefail`: this runner owns failure handling
# (every Maestro invocation's exit code becomes a PASS/FAIL verdict line in the
# report), and `-e` would abort the run — and the report with it — on the first
# red flow. Same choice, for the same reason, as run-budget-multi-member-sync.sh
# and run-house-multi-member-sync.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOW_DIR="${ROOT}/e2e/maestro/health-two-device"
HEALTH_FLOW_DIR="${ROOT}/e2e/maestro/health"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
export E2E_MAESTRO_CLEANUP="${E2E_MAESTRO_CLEANUP:-0}"

APP_ID="com.symply.health"
APP_SCHEME="simplehealth"
TD_PARALLEL="${TD_PARALLEL:-1}"
# Dedicated Metro: this suite must not attach to :8085, which the single-device
# Health suite serves, and must not be attached to BY it.
METRO_PORT="${TD_METRO_PORT:-8095}"
METRO_LOG="${METRO_LOG:-/tmp/metro-health-two-device.log}"
RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/health-two-device"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"

# ---------------------------------------------------------------------------
# Markers. Every one carries the run timestamp so a re-run never collides with
# rows an earlier run left behind, and no pair is a substring of the other —
# the modify legs assert the OLD marker is GONE, which `X` / `X-v2` would make
# unsatisfiable.
# ---------------------------------------------------------------------------
TD_STAMP="${RUN_TS}"
W_MARK="TDw1 ${TD_STAMP}";        W_MARK2="TDw2 ${TD_STAMP}"
W_VALUE="77.3";                   W_VALUE2="82.9"
WATER_VALUE="537";                WATER_VALUE2="823"
N_MARK="TDn1 ${TD_STAMP}";        N_MARK2="TDn2 ${TD_STAMP}"
N_KCAL="412";                     N_KCAL2="537"
ACT_MARK="TDa ${TD_STAMP}";       ACT_MIN="73";           ACT_MIN2="89"
SLEEP_VALUE="6.3";                SLEEP_VALUE2="7.9"
BODY_VALUE="93.7";                BODY_VALUE2="88.4"
H_MARK="TDh1 ${TD_STAMP}";        H_MARK2="TDh2 ${TD_STAMP}"
HLOG_HABIT="TDlog ${TD_STAMP}"
GOAL_VALUE="74.6";                GOAL_VALUE2="71.2"
TOMB_MARK="TDtomb ${TD_STAMP}";   TOMB_VALUE="69.8"
OFFLINE_HABIT="TDoff ${TD_STAMP}"
WAKE_HABIT="TDwake ${TD_STAMP}"

log() { echo "[td] $*"; }
die() { echo "[td] $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Credentials — ONE account, used on both devices.
# ---------------------------------------------------------------------------
if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

command -v maestro >/dev/null 2>&1 \
  || die "Maestro not found. Install: curl -fsSL https://get.maestro.mobile.dev | bash"

for var in E2E_EMAIL E2E_PASSWORD; do
  [[ -n "${!var:-}" ]] || die "Missing ${var} — set it in e2e/credentials.local."
done
if [[ -n "${E2E_EMAIL_SECONDARY:-}" && "${E2E_EMAIL_SECONDARY}" != "${E2E_EMAIL}" ]]; then
  die "E2E_EMAIL_SECONDARY is set to a DIFFERENT account.
[td] A Health household is one user with N devices (plan §1.2) — a second user_id
[td] is what He5 makes the Worker reject. Both devices must sign in as
[td] ${E2E_EMAIL}. Unset E2E_EMAIL_SECONDARY for this suite."
fi

# ---------------------------------------------------------------------------
# Devices — FROM THE REGISTRY. A name hardcoded in a runner is how registries go
# stale, so the only literals here are the env overrides.
# ---------------------------------------------------------------------------
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "${ROOT}/scripts/e2e/maestro-fleet-brand.sh"
DEVICE_A_NAME="${E2E_DEVICE_A:-${E2E_DEVICE:-$(maestro_fleet_brand_field health device)}}"
DEVICE_B_NAME="${E2E_DEVICE_B:-$(maestro_fleet_brand_field health device_b)}"
[[ -n "${DEVICE_A_NAME}" && -n "${DEVICE_B_NAME}" ]] \
  || die "could not resolve the Health device pair from maestro-fleet-brand.sh"
if [[ "${DEVICE_A_NAME}" == "${DEVICE_B_NAME}" ]]; then
  die "A and B resolved to the same simulator (${DEVICE_A_NAME}) — a two-device
[td] suite on one device proves nothing."
fi

# Size-guard BEFORE boot. A device dir never shrinks on its own, and a full disk
# does not announce itself: taps stop registering and forms refuse to close,
# which reads exactly like an app bug. `sim_guard` refuses to erase while a suite
# is in flight (it greps for maestro/xcodebuild), so this is safe to call.
# shellcheck source=scripts/e2e/sim-disk-guard.sh
source "${ROOT}/scripts/e2e/sim-disk-guard.sh"
sim_guard_pair "${DEVICE_A_NAME}" "${DEVICE_B_NAME}"

# Auto-create either device rather than failing: otherwise the registry and the
# machine drift and the suite breaks with a confusing "device not found".
UDID_A="$(maestro_fleet_ensure_iphone_sim "${DEVICE_A_NAME}" || true)"
UDID_B="$(maestro_fleet_ensure_iphone_sim "${DEVICE_B_NAME}" || true)"
[[ -n "${UDID_A}" ]] || die "could not find or create simulator '${DEVICE_A_NAME}'"
[[ -n "${UDID_B}" ]] || die "could not find or create simulator '${DEVICE_B_NAME}'"

# ---------------------------------------------------------------------------
# Disk headroom, checked BEFORE anything runs. Maestro keeps a screenshot + view
# hierarchy per step and ~/.maestro/tests grows without bound.
# ---------------------------------------------------------------------------
TD_FREE_MB="$(df -m / | awk 'NR==2 {print $4}')"
if (( TD_FREE_MB < 5000 )); then
  log "only ${TD_FREE_MB}MB free — pruning Maestro artifacts older than the 10 most recent runs"
  ls -1t "${HOME}/.maestro/tests" 2>/dev/null | tail -n +11 | while IFS= read -r _d; do
    [[ -n "${_d}" ]] && rm -rf "${HOME}/.maestro/tests/${_d}"
  done
  TD_FREE_MB="$(df -m / | awk 'NR==2 {print $4}')"
fi
(( TD_FREE_MB >= 2000 )) || die "ABORTING: only ${TD_FREE_MB}MB free. A full disk wedges the
[td] simulator and the failures it causes look like app bugs. Free space and re-run."
log "disk headroom: ${TD_FREE_MB}MB free"

# ---------------------------------------------------------------------------
# Refuse to run against another brand's generated files rather than rebuilding
# them: tokens/icons are shared checkout state and regenerating mid-run would
# clobber whatever brand a concurrent session is building.
# ---------------------------------------------------------------------------
BRAND_LINE="$(head -1 "${ROOT}/src/brand/tokens.generated.ts" 2>/dev/null || true)"
if [[ "${BRAND_LINE}" != *"APP_BRAND=symply-health"* ]]; then
  die "Generated brand files are not symply-health:
[td]   ${BRAND_LINE}
[td] Another session is mid-build. Wait for it, or run:
[td]   APP_BRAND=symply-health npm run tokens:build && npm run icons:build"
fi

# ===========================================================================
# GATE 1 — Worker Version ID vs the client's backend/src commit (§14 step 13)
# ===========================================================================
#
# "Ported Budget MM suite green … against a Worker whose Version ID is built from
#  the SAME `backend/src` commit as the client binary under test, AND POSTDATES
#  IT" — He12(partial) DoD. Two separate claims, so two separate comparisons.
#
# Where each number comes from:
#   client commit  the newest commit reachable from HEAD that touches
#                  `backend/src`. The binary under test is built from THIS
#                  checkout, so that is the backend the client was compiled
#                  against. Overridable with HEALTH_CLIENT_BACKEND_COMMIT when
#                  testing a binary built elsewhere.
#   worker version `wrangler versions list --json` for the Health Worker, newest
#                  first. Overridable with HEALTH_WORKER_VERSION_ID /
#                  HEALTH_WORKER_VERSION_CREATED_ON / HEALTH_WORKER_SRC_COMMIT —
#                  which is also how a version recorded at deploy time (§14
#                  step 5) is fed in without needing network access here.
#                  `e2e/health-worker-version.local` is sourced if present.
#
# The SAME-COMMIT half cannot be inferred from a timestamp, so it needs the
# commit to be recorded ON the version: either an annotation
# (`workers/tag` / `workers/message` containing the sha, i.e. deploy with
# `wrangler deploy --message "$(git rev-parse HEAD)"`), or HEALTH_WORKER_SRC_COMMIT.
# If NEITHER is available the gate FAILS. It does not pass on a timestamp alone:
# "the Worker is newer" and "the Worker is the same code" are different claims,
# and only the second one keeps a two-device run meaningful.
HEALTH_VERSION_GATE="${HEALTH_VERSION_GATE:-enforce}"
HEALTH_WORKER_ENV="${HEALTH_WORKER_ENV:-staging}"

if [[ -f "${ROOT}/e2e/health-worker-version.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/health-worker-version.local"
  set +a
fi

version_gate_fail() {
  if [[ "${HEALTH_VERSION_GATE}" == "warn" ]]; then
    echo "[td] ############################################################" >&2
    echo "[td] VERSION GATE DOWNGRADED TO A WARNING (HEALTH_VERSION_GATE=warn)" >&2
    echo "[td] THIS RUN CANNOT CERTIFY He12(partial). Reason:" >&2
    echo "[td]   $*" >&2
    echo "[td] ############################################################" >&2
    VERSION_GATE_VERDICT="SKIP version gate — ${1}"
    return 0
  fi
  die "VERSION GATE FAILED (§14 step 13): $*
[td]
[td] Fix it, do not bypass it. Either:
[td]   • redeploy from the main checkout recording the commit on the version:
[td]       cd backend && npx wrangler deploy -c wrangler.health.toml \\
[td]         --env ${HEALTH_WORKER_ENV} --message \"\$(git rev-parse HEAD)\"
[td]   • or record the deployed version in e2e/health-worker-version.local:
[td]       HEALTH_WORKER_VERSION_ID=…
[td]       HEALTH_WORKER_VERSION_CREATED_ON=…   # ISO 8601
[td]       HEALTH_WORKER_SRC_COMMIT=…           # the backend/src commit it was built from
[td] HEALTH_VERSION_GATE=warn downgrades this to a non-certifying run."
}

VERSION_GATE_VERDICT=""
CLIENT_COMMIT="${HEALTH_CLIENT_BACKEND_COMMIT:-$(git -C "${ROOT}" log -1 --format=%H -- backend/src 2>/dev/null || true)}"
if [[ -z "${CLIENT_COMMIT}" ]]; then
  version_gate_fail "no commit touching backend/src is reachable from HEAD"
else
  CLIENT_COMMIT_EPOCH="$(git -C "${ROOT}" log -1 --format=%ct "${CLIENT_COMMIT}" 2>/dev/null || echo 0)"
  CLIENT_COMMIT_ISO="$(git -C "${ROOT}" log -1 --format=%cI "${CLIENT_COMMIT}" 2>/dev/null || echo '?')"

  # A dirty backend/src means the deployed Worker CANNOT be the same code as the
  # client under test, whatever the ids say.
  if [[ -n "$(git -C "${ROOT}" status --porcelain -- backend/src 2>/dev/null)" ]]; then
    version_gate_fail "backend/src has uncommitted changes — the deployed Worker cannot be built from the commit under test"
  fi

  WORKER_VERSION_ID="${HEALTH_WORKER_VERSION_ID:-}"
  WORKER_CREATED_ON="${HEALTH_WORKER_VERSION_CREATED_ON:-}"
  WORKER_SRC_COMMIT="${HEALTH_WORKER_SRC_COMMIT:-}"

  if [[ -z "${WORKER_VERSION_ID}" ]]; then
    log "querying the Health Worker (${HEALTH_WORKER_ENV}) for its active version…"
    WORKER_JSON="$( (cd "${ROOT}/backend" && npx --no-install wrangler versions list \
        -c wrangler.health.toml --env "${HEALTH_WORKER_ENV}" --json 2>/dev/null) || true )"
    if [[ -n "${WORKER_JSON}" ]]; then
      # Newest version wins; annotations are where a deploy records its commit.
      eval "$(node -e '
        let raw = "";
        process.stdin.on("data", (d) => (raw += d));
        process.stdin.on("end", () => {
          let list;
          try { list = JSON.parse(raw); } catch { process.exit(0); }
          if (!Array.isArray(list) || list.length === 0) process.exit(0);
          const created = (v) => Date.parse((v.metadata && v.metadata.created_on) || 0) || 0;
          const v = list.slice().sort((a, b) => created(b) - created(a))[0];
          const ann = v.annotations || {};
          const blob = [ann["workers/tag"], ann["workers/message"], v.message, v.tag]
            .filter(Boolean).join(" ");
          const sha = (blob.match(/\b[0-9a-f]{7,40}\b/) || [""])[0];
          const q = (s) => "\x27" + String(s || "").replace(/\x27/g, "") + "\x27";
          process.stdout.write(
            `WORKER_VERSION_ID=${q(v.id)}\n` +
            `WORKER_CREATED_ON=${q((v.metadata || {}).created_on)}\n` +
            `WORKER_SRC_COMMIT=${q(sha)}\n`
          );
        });
      ' <<<"${WORKER_JSON}")"
    fi
  fi

  if [[ -z "${WORKER_VERSION_ID}" ]]; then
    version_gate_fail "could not determine the deployed Health Worker Version ID (wrangler returned nothing and nothing was recorded)"
  else
    WORKER_EPOCH=0
    if [[ -n "${WORKER_CREATED_ON}" ]]; then
      WORKER_EPOCH="$(node -e 'const t=Date.parse(process.argv[1]); process.stdout.write(String(Number.isFinite(t)?Math.floor(t/1000):0))' "${WORKER_CREATED_ON}")"
    fi

    log "client backend/src commit : ${CLIENT_COMMIT} (${CLIENT_COMMIT_ISO})"
    log "worker version id         : ${WORKER_VERSION_ID}"
    log "worker created on         : ${WORKER_CREATED_ON:-<unknown>}"
    log "worker src commit         : ${WORKER_SRC_COMMIT:-<not recorded>}"

    # -- same commit -------------------------------------------------------
    if [[ -z "${WORKER_SRC_COMMIT}" ]]; then
      version_gate_fail "the deployed version records no source commit, so 'same backend/src commit as the client' is unverifiable"
    elif [[ "${CLIENT_COMMIT}" != "${WORKER_SRC_COMMIT}"* && "${WORKER_SRC_COMMIT}" != "${CLIENT_COMMIT}"* ]]; then
      version_gate_fail "Worker was built from ${WORKER_SRC_COMMIT}, client from ${CLIENT_COMMIT} — different backend/src commits"
    fi

    # -- postdates ---------------------------------------------------------
    if (( WORKER_EPOCH == 0 )); then
      version_gate_fail "the deployed version has no usable creation timestamp, so 'postdates the commit' is unverifiable"
    elif (( WORKER_EPOCH <= CLIENT_COMMIT_EPOCH )); then
      version_gate_fail "Worker version ${WORKER_VERSION_ID} (${WORKER_CREATED_ON}) does NOT postdate backend/src commit ${CLIENT_COMMIT} (${CLIENT_COMMIT_ISO})"
    fi

    [[ -z "${VERSION_GATE_VERDICT}" ]] && VERSION_GATE_VERDICT="PASS version gate — ${WORKER_VERSION_ID} built from ${CLIENT_COMMIT}, postdates it"
  fi
fi

# ===========================================================================
# GATE 2 — brand default asserted OFF in the binary under test
# ===========================================================================
#
# `isHealthLocalFirst()` returns TRUE for brand `symply-health` when
# `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` is unset (flag.ts). Until He12 (full) that
# default must never reach a real build: a Health binary without an explicit `=0`
# opens a ledger nothing writes to while the screens still hit D1. So every
# `symply-health*` profile in eas.json must pin "0" — `extends` chains resolved,
# because `symply-health-testflight` carries no env of its own.
HEALTH_BRAND_DEFAULT_GATE="${HEALTH_BRAND_DEFAULT_GATE:-enforce}"
BRAND_DEFAULT_OFFENDERS="$(node -e '
  const fs = require("fs");
  const eas = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const profiles = eas.build || {};
  const envOf = (name, seen = new Set()) => {
    if (!profiles[name] || seen.has(name)) return {};
    seen.add(name);
    const p = profiles[name];
    return { ...(p.extends ? envOf(p.extends, seen) : {}), ...(p.env || {}) };
  };
  const bad = [];
  for (const name of Object.keys(profiles)) {
    const env = envOf(name);
    const brand = env.APP_BRAND || env.EXPO_PUBLIC_APP_BRAND || "";
    if (brand !== "symply-health") continue;
    if (env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST !== "0") {
      bad.push(`${name} (EXPO_PUBLIC_HEALTH_LOCAL_FIRST=${env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST ?? "<unset>"})`);
    }
  }
  process.stdout.write(bad.join("; "));
' "${ROOT}/eas.json" 2>/dev/null)"

if [[ -n "${BRAND_DEFAULT_OFFENDERS}" ]]; then
  if [[ "${HEALTH_BRAND_DEFAULT_GATE}" == "warn" ]]; then
    echo "[td] WARNING: brand default is NOT pinned off for: ${BRAND_DEFAULT_OFFENDERS}" >&2
  else
    die "BRAND-DEFAULT GATE FAILED: these symply-health profiles do not pin
[td] EXPO_PUBLIC_HEALTH_LOCAL_FIRST=\"0\":
[td]   ${BRAND_DEFAULT_OFFENDERS}
[td]
[td] flag.ts brand-defaults local-first ON for symply-health when the var is
[td] unset, and He12(partial) requires the brand default asserted OFF in the
[td] binary under test. eas.json is owned by another agent — report this rather
[td] than editing it. HEALTH_BRAND_DEFAULT_GATE=warn downgrades the check."
  fi
else
  log "brand default OFF — every symply-health eas.json profile pins EXPO_PUBLIC_HEALTH_LOCAL_FIRST=0"
fi

log "owner   A=${DEVICE_A_NAME} ${UDID_A}  <${E2E_EMAIL}>"
log "device  B=${DEVICE_B_NAME} ${UDID_B}  <${E2E_EMAIL}>  (SAME account — personal household)"
log "parallel driving: ${TD_PARALLEL}"

# The device window is part of launching a suite, not an extra step.
open -a Simulator >/dev/null 2>&1 || true

xcrun simctl boot "${UDID_A}" 2>/dev/null || true
xcrun simctl boot "${UDID_B}" 2>/dev/null || true
xcrun simctl bootstatus "${UDID_A}" -b 2>/dev/null || sleep 5
xcrun simctl bootstatus "${UDID_B}" -b 2>/dev/null || sleep 5

# Password AutoFill hijacks inputText on secure fields — off on both devices.
for udid in "${UDID_A}" "${UDID_B}"; do
  for _plist in \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/UserConfigurationProfiles/EffectiveUserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist"
  do
    [[ -f "${_plist}" ]] && plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO "${_plist}" 2>/dev/null || true
  done
  xcrun simctl spawn "${udid}" defaults write com.apple.WebUI AutoFillPasswords -bool false 2>/dev/null || true
done

# Device B needs the same build as A. Install A's bundle if B has none — the two
# devices MUST run the same binary or the version gate above means nothing.
if ! xcrun simctl listapps "${UDID_B}" 2>/dev/null | grep -q "${APP_ID}"; then
  APP_PATH="$(xcrun simctl listapps "${UDID_A}" 2>/dev/null \
    | grep -A4 "\"${APP_ID}\"" | grep -Eo '/[^"]*\.app' | head -1 || true)"
  if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
    die "${APP_ID} is not installed on ${DEVICE_B_NAME} and no bundle was found on ${DEVICE_A_NAME}.
[td] Build Health once and re-run:
[td]   npm run prepare:xcode:health
[td]   cd ios && xcodebuild -workspace SymplyEcosystem.xcworkspace \\
[td]     -scheme SymplyHealth-Staging -configuration Debug-health \\
[td]     -destination 'platform=iOS Simulator,name=${DEVICE_A_NAME}' build"
  fi
  log "installing ${APP_PATH} on ${DEVICE_B_NAME}"
  xcrun simctl install "${UDID_B}" "${APP_PATH}"
fi

# ---------------------------------------------------------------------------
# Report scaffolding
# ---------------------------------------------------------------------------
mkdir -p "${REPORT_OUT}" "${HOME}/.maestro/tests"
LATEST_TARGET="${REPORT_OUT}"
[[ "$(dirname "${REPORT_OUT}")" == "${REPORTS_BASE}" ]] && LATEST_TARGET="$(basename "${REPORT_OUT}")"
ln -sfn "${LATEST_TARGET}" "${REPORTS_BASE}/latest"
AGG_DIR="${REPORT_OUT}/.run-dirs"
mkdir -p "${AGG_DIR}"
BEFORE_RUNS="$(ls -1 "${HOME}/.maestro/tests" 2>/dev/null || true)"

# The report header is owned by report-meta.sh so the four apps' runners cannot
# drift into different headers again. Device is the PAIR.
REPORT_PLATFORM="${E2E_REPORT_PLATFORM:-iOS}"
REPORT_DEVICE="${DEVICE_A_NAME}+${DEVICE_B_NAME}"
# shellcheck source=scripts/e2e/report-meta.sh
source "${ROOT}/scripts/e2e/report-meta.sh"
report_meta_args symply-health

# ---------------------------------------------------------------------------
# Metro — ONE dedicated instance serving BOTH of this suite's simulators, with
# the LAB FLAG ON. `EXPO_PUBLIC_*` is inlined at bundle time, so this is the only
# moment the flag can be set for the JS these devices run.
#
# Started directly rather than through start-brand.sh / start-metro-logged.sh:
# those regenerate tokens+icons and pass --clear, which would rewrite shared
# checkout state and wipe a transform cache another session's Metro is using.
# ---------------------------------------------------------------------------
if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  log "starting dedicated Metro on :${METRO_PORT} with EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1 (log ${METRO_LOG})"
  : > "${METRO_LOG}"
  (
    cd "${ROOT}" && APP_BRAND=symply-health EXPO_PUBLIC_APP_BRAND=symply-health \
      EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1 \
      EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
      npx @expo/cli start --port "${METRO_PORT}" --dev-client 2>&1 | tee -a "${METRO_LOG}"
  ) &
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 && break
    sleep 2
  done
fi
curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 \
  || die "Metro did not come up on :${METRO_PORT}"
log "Metro ready on :${METRO_PORT}"

log "other Metro instances (left alone):"
for _p in 8081 8082 8083 8084 8085 8092 8093; do
  [[ "${_p}" == "${METRO_PORT}" ]] && continue
  curl -sf "http://localhost:${_p}/status" >/dev/null 2>&1 && log "  :${_p} in use by another session"
done

# Build the bundle ONCE before any device asks for it. A cold Metro only starts
# bundling when the first client connects, and the dev client sits on a black
# screen for the whole download — which reads exactly like a hung app.
log "pre-building the iOS bundle (cold Metro builds ~5k modules)"
BUNDLE_START="$(date +%s)"
BUNDLE_FILE="${REPORT_OUT}/.bundle-head.js"
curl -s --max-time 900 \
  "http://localhost:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=ios&dev=true" \
  -o "${BUNDLE_FILE}" || true
log "bundle ready in $(( $(date +%s) - BUNDLE_START ))s"

# ===========================================================================
# GATE 3 — the lab flag actually reached the bundle
# ===========================================================================
# Expo's Babel plugin INLINES `process.env.EXPO_PUBLIC_*` at bundle time. A
# surviving `process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST` in the served bundle
# therefore means the inline never happened — the app would fall through to the
# BRAND DEFAULT at runtime, which is exactly the state this suite must not test
# in. Cheap, and it catches the one failure mode that would otherwise be silent.
if [[ -s "${BUNDLE_FILE}" ]]; then
  if grep -q 'process\.env\.EXPO_PUBLIC_HEALTH_LOCAL_FIRST' "${BUNDLE_FILE}"; then
    die "LAB-FLAG GATE FAILED: the served bundle still contains an un-inlined
[td] process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST, so the flag never reached the
[td] Babel inline plugin and the app would fall back to the brand default.
[td] Kill the Metro on :${METRO_PORT} and re-run so it starts with the flag set."
  fi
  log "lab flag inlined into the served bundle (EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1)"
  rm -f "${BUNDLE_FILE}"
else
  log "WARNING: could not fetch the bundle to verify the lab flag inline"
fi

# ---------------------------------------------------------------------------
# Deep links. ONE login URL — the same account on both devices.
# ---------------------------------------------------------------------------
LOGIN_URL="$(node -e "
  const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
  process.stdout.write('${APP_SCHEME}://e2e-login?' + params.toString());
" "${E2E_EMAIL}" "${E2E_PASSWORD}")"
DEVCLIENT_URL="${APP_SCHEME}://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}"

# ---------------------------------------------------------------------------
# Verdicts + live report
# ---------------------------------------------------------------------------
FAILED=0
# 6 enrolment + 52 Wave A phases + 4 tombstone + 3 airplane + 3 push wake
# + 1 copy audit + 1 privacy + 2 cleanup.
TD_TOTAL_FLOWS=72
SUMMARY="${REPORT_OUT}/summary.log"
: > "${SUMMARY}"

note() { echo "$*" | tee -a "${SUMMARY}"; }

[[ -n "${VERSION_GATE_VERDICT}" ]] && note "    ${VERSION_GATE_VERDICT}"

start_live_report() {
  (
    local opened=0
    while :; do
      find "${HOME}/.maestro/tests" -maxdepth 3 -name commands.json -newer "${SUMMARY}" 2>/dev/null \
        | while IFS= read -r _c; do
            _flow="$(dirname "${_c}")"; _ts="$(basename "$(dirname "${_flow}")")"
            ln -sfn "${_flow}" "${AGG_DIR}/${_ts}__$(basename "${_flow}")"
          done
      if [[ -n "$(ls -A "${AGG_DIR}" 2>/dev/null)" ]]; then
        node "${ROOT}/scripts/e2e/generate-report.mjs" \
          --maestro-dir "${AGG_DIR}" --metro-log "${METRO_LOG}" --out "${REPORT_OUT}" \
          "${REPORT_META_ARGS[@]}" \
          --progress-total "${TD_TOTAL_FLOWS}" --verdicts "${SUMMARY}" >/dev/null 2>&1
        if (( opened == 0 )) && [[ -f "${REPORT_OUT}/index.html" ]]; then
          open "${REPORT_OUT}/index.html" 2>/dev/null || true
          opened=1
        fi
      fi
      sleep "${TD_REPORT_POLL:-30}"
    done
  ) &
  LIVE_REPORT_PID=$!
}

# run <A|B> <flow.yaml> [KEY=VALUE ...] — one Maestro invocation, own log file.
run() {
  local who="$1"; shift
  local flow="$1"; shift
  local udid log dir
  if [[ "${who}" == "A" ]]; then udid="${UDID_A}"; else udid="${UDID_B}"; fi
  log="${REPORT_OUT}/steps-${who}.log"
  dir="${FLOW_DIR}"
  [[ "${flow}" == health/* ]] && { dir="${HEALTH_FLOW_DIR}"; flow="${flow#health/}"; }

  {
    echo ""
    echo "=== [${who}] ${flow} $* ==="
  } >>"${log}"

  local args=(
    test
    --device "${udid}"
    --format NOOP
    -e "APP_ID=${APP_ID}"
    -e "E2E_APP_SCHEME=${APP_SCHEME}"
    -e "E2E_PLATFORM=ios"
    -e "E2E_METRO_DEVCLIENT_URL=${DEVCLIENT_URL}"
    -e "TD_METRO_PORT=${METRO_PORT}"
    -e "E2E_LOGIN_URL=${LOGIN_URL}"
    -e "E2E_EMAIL=${E2E_EMAIL}"
    -e "E2E_PASSWORD=${E2E_PASSWORD}"
  )
  if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
    args+=(--no-reinstall-driver)
  fi
  while (( $# > 0 )); do
    args+=(-e "$1")
    shift
  done
  args+=("${dir}/${flow}")

  # Retry ONLY when the XCUITest driver died, never on a real assertion.
  # Every step spawns its own `xcodebuild test-without-building` driver; on a
  # busy machine those contend for the device and one dies mid-flow. That is
  # infrastructure, not a defect — whereas retrying a failed assertion would
  # launder a real regression into a pass.
  local attempt max_attempts=3 tail_out
  for attempt in $(seq 1 "${max_attempts}"); do
    if maestro "${args[@]}" >>"${log}" 2>&1; then
      (( attempt > 1 )) && echo "    (passed on attempt ${attempt})" >>"${log}"
      return 0
    fi
    tail_out="$(tail -80 "${log}")"
    if ! grep -qE "DeviceUnreachableException|became unreachable|IOSDriverTimeoutException|iOS driver not ready|Failed to connect|Connection refused|Killed: 9|kAXError|Detected app crash during snapshot" <<<"${tail_out}"; then
      return 1
    fi
    if (( attempt < max_attempts )); then
      echo "    driver dropped on attempt ${attempt}/${max_attempts} — restarting it" >>"${log}"
      pkill -f "maestro-driver-ios-config.xctestrun.*${udid}" 2>/dev/null || true
      pkill -f "destination id=${udid}" 2>/dev/null || true
      sleep 12
    fi
  done
  return 1
}

# single <who> <label> <flow> [env...]
single() {
  local who="$1" label="$2"; shift 2
  if run "${who}" "$@"; then
    note "    PASS [${who}] ${label}"
    return 0
  fi
  note "    FAIL [${who}] ${label}"
  FAILED=1
  [[ "${TD_FAIL_FAST:-1}" == "1" ]] && note "[td] FAIL FAST — stopping the run at '${label}'"
  return 1
}

# converge <label> <flow> <phase> <write-env...> -- <observe-env...>
# The handoff this suite is built around: A writes, then B observes. It is
# SEQUENTIAL by nature, unlike Budget's symmetric parallel phases — one user's
# two devices cannot each own half of the data, so there is nothing to overlap.
converge() {
  local label="$1" flow="$2"; shift 2
  local w_env=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do w_env+=("$1"); shift; done
  [[ "${1:-}" == "--" ]] && shift
  local o_env=("$@")

  (( FAILED != 0 )) && return 1
  single A "${label} (write)" "${flow}" "TD_ROLE=write" "${w_env[@]}" || return 1
  (( FAILED != 0 )) && return 1
  single B "${label} (observe)" "${flow}" "TD_ROLE=observe" "${o_env[@]}" || return 1
  return 0
}

# Scrape the enrolment payload device A just minted off the Metro log — the
# harness standing in for a person holding two phones. Bounded to lines written
# after this run started so an earlier run's (claimed/expired) code cannot be
# picked up.
read_invite() {
  local line
  line="$(tail -n "+$((INVITE_MARK + 1))" "${METRO_LOG}" 2>/dev/null \
    | grep -a '\[E2E-INVITE\]' | tail -1 || true)"
  if [[ -z "${line}" ]]; then
    echo "[td] no [E2E-INVITE] line in ${METRO_LOG} — did 'Add your other device' succeed?" >&2
    return 1
  fi
  TD_CODE="$(sed -n 's/.*code=\([^ ]*\).*/\1/p' <<<"${line}")"
  TD_SECRET="$(sed -n 's/.*secret=\([^ ]*\).*/\1/p' <<<"${line}")"
  TD_HOUSEHOLD="$(sed -n 's/.*household=\([^ ]*\).*/\1/p' <<<"${line}")"
  [[ -n "${TD_CODE}" && -n "${TD_SECRET}" ]]
}

# The verification digits, carried device B → device A. Not scrapeable from the
# invite line: they are derived from B's enrolment keys and so exist only once B
# has claimed — which is exactly what makes them a check on B's device.
read_join_sas() {
  local line
  line="$(tail -n "+$((INVITE_MARK + 1))" "${METRO_LOG}" 2>/dev/null \
    | grep -a '\[E2E-JOIN-SAS\]' | tail -1 || true)"
  if [[ -z "${line}" ]]; then
    echo "[td] no [E2E-JOIN-SAS] line in ${METRO_LOG} — did device B claim?" >&2
    return 1
  fi
  local digits
  digits="$(sed -n 's/.*sas=\([0-9]*\).*/\1/p' <<<"${line}")"
  [[ "${digits}" =~ ^[0-9]{6}$ ]] || return 1
  TD_SAS="${digits:0:3} ${digits:3:3}"
}

INVITE_MARK="$(wc -l < "${METRO_LOG}" 2>/dev/null | tr -d ' ' || echo 0)"
INVITE_MARK="${INVITE_MARK:-0}"

start_live_report
note "[td] live report: ${REPORT_OUT}/index.html (opens shortly, self-refreshes)"

# ===========================================================================
# phase 1 — enrolment (ordered: nothing can approve a claim that does not exist)
# ===========================================================================
note "[td] === phase 1: enrolment — SAME account, two devices (ordered) ==="
# Sign-in is serial ON PURPOSE even though the two are logically independent:
# this is each device's first Maestro invocation, so it is where the XCUITest
# driver cold-starts, and doing both at once makes the drivers race and die.
single A "td-01-signin" td-01-signin.yaml || true
(( FAILED == 0 )) && single B "td-01-signin" td-01-signin.yaml || true

if (( FAILED == 0 )); then
  single A "td-02-device-a-add-other-device" td-02-device-a-add-other-device.yaml || true
fi
if (( FAILED == 0 )); then
  sleep 2
  if read_invite; then
    note "[td] enrolment code=${TD_CODE} household=${TD_HOUSEHOLD:-<unknown>}"
    TD_LINK="${APP_SCHEME}://lf-invite?secret=${TD_SECRET}&code=${TD_CODE}"
    single B "td-03-device-b-join" td-03-device-b-join.yaml "TD_LINK=${TD_LINK}" || true
    (( FAILED == 0 )) && read_join_sas || true
    (( FAILED == 0 )) && single A "td-04-device-a-approve" td-04-device-a-approve.yaml "TD_SAS=${TD_SAS}" || true
    (( FAILED == 0 )) && single B "td-05-device-b-enrol-sync" td-05-device-b-enrol-sync.yaml || true
  else
    FAILED=1
  fi
fi

# ===========================================================================
# phase 2 — the 8 Wave A tables, create / modify / delete / converge
# ===========================================================================
if (( FAILED == 0 )); then
  note "[td] === phase 2: Wave A tables (8) — create / modify / delete / converge ==="
fi

# 1/8 weightEntries -------------------------------------------------------
converge "td-10-weight create"  td-10-weight-sync.yaml "TD_PHASE=create" "TD_MARK=${W_MARK}" "TD_VALUE=${W_VALUE}" \
  -- "TD_PHASE=create" "TD_EXPECT=${W_MARK}"
converge "td-10-weight modify"  td-10-weight-sync.yaml "TD_PHASE=modify" "TD_MARK=${W_MARK}" "TD_MARK2=${W_MARK2}" "TD_VALUE2=${W_VALUE2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${W_MARK2}"
converge "td-10-weight delete"  td-10-weight-sync.yaml "TD_PHASE=delete" "TD_MARK2=${W_MARK2}" \
  -- "TD_PHASE=delete" "TD_EXPECT=${W_MARK2}"

# 2/8 waterEntries --------------------------------------------------------
converge "td-11-water create"   td-11-water-sync.yaml "TD_PHASE=create" "TD_VALUE=${WATER_VALUE}" \
  -- "TD_PHASE=create" "TD_EXPECT=${WATER_VALUE} ml"
converge "td-11-water modify"   td-11-water-sync.yaml "TD_PHASE=modify" "TD_VALUE2=${WATER_VALUE2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${WATER_VALUE2} ml"
converge "td-11-water delete"   td-11-water-sync.yaml "TD_PHASE=delete" "TD_VALUE2=${WATER_VALUE2}" \
  -- "TD_PHASE=delete" "TD_EXPECT=${WATER_VALUE2} ml"

# 3/8 nutritionEntries ----------------------------------------------------
converge "td-12-nutrition create" td-12-nutrition-sync.yaml "TD_PHASE=create" "TD_MARK=${N_MARK}" "TD_VALUE=${N_KCAL}" \
  -- "TD_PHASE=create" "TD_EXPECT=${N_MARK}"
converge "td-12-nutrition modify" td-12-nutrition-sync.yaml "TD_PHASE=modify" "TD_MARK=${N_MARK}" "TD_MARK2=${N_MARK2}" "TD_VALUE2=${N_KCAL2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${N_MARK2}"
converge "td-12-nutrition delete" td-12-nutrition-sync.yaml "TD_PHASE=delete" "TD_MARK2=${N_MARK2}" \
  -- "TD_PHASE=delete" "TD_EXPECT=${N_MARK2}"

# 4/8 healthEntries — activity half ---------------------------------------
converge "td-13-activity create" td-13-activity-sync.yaml "TD_PHASE=create" "TD_MARK=${ACT_MARK}" "TD_VALUE=${ACT_MIN}" \
  -- "TD_PHASE=create" "TD_EXPECT=${ACT_MIN}m"
converge "td-13-activity modify" td-13-activity-sync.yaml "TD_PHASE=modify" "TD_VALUE=${ACT_MIN}" "TD_VALUE2=${ACT_MIN2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${ACT_MIN2}m"
converge "td-13-activity delete" td-13-activity-sync.yaml "TD_PHASE=delete" "TD_VALUE2=${ACT_MIN2}" \
  -- "TD_PHASE=delete" "TD_EXPECT=${ACT_MIN2}m"

# 4/8 healthEntries — sleep half (no edit / no delete affordance exists) ---
converge "td-14-sleep create"   td-14-sleep-sync.yaml "TD_PHASE=create" "TD_VALUE=${SLEEP_VALUE}" "TD_EXPECT=${SLEEP_VALUE}" \
  -- "TD_PHASE=create" "TD_EXPECT=${SLEEP_VALUE}"
converge "td-14-sleep modify"   td-14-sleep-sync.yaml "TD_PHASE=modify" "TD_VALUE2=${SLEEP_VALUE2}" "TD_EXPECT=${SLEEP_VALUE2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${SLEEP_VALUE2}"

# 5/8 bodyMeasurements ----------------------------------------------------
converge "td-15-body create"    td-15-body-sync.yaml "TD_PHASE=create" "TD_VALUE=${BODY_VALUE}" "TD_EXPECT=${BODY_VALUE}" \
  -- "TD_PHASE=create" "TD_EXPECT=${BODY_VALUE}"
converge "td-15-body modify"    td-15-body-sync.yaml "TD_PHASE=modify" "TD_VALUE2=${BODY_VALUE2}" "TD_EXPECT=${BODY_VALUE2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${BODY_VALUE2}"
converge "td-15-body delete"    td-15-body-sync.yaml "TD_PHASE=delete" \
  -- "TD_PHASE=delete"

# 6/8 userHabits ----------------------------------------------------------
converge "td-16-habits create"  td-16-habits-sync.yaml "TD_PHASE=create" "TD_MARK=${H_MARK}" \
  -- "TD_PHASE=create" "TD_EXPECT=${H_MARK}"
converge "td-16-habits modify"  td-16-habits-sync.yaml "TD_PHASE=modify" "TD_MARK=${H_MARK}" "TD_MARK2=${H_MARK2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${H_MARK2}"
converge "td-16-habits delete"  td-16-habits-sync.yaml "TD_PHASE=delete" "TD_MARK2=${H_MARK2}" \
  -- "TD_PHASE=delete" "TD_EXPECT=${H_MARK2}"

# 7/8 habitLogs — create, delete, THEN the resurrect-under-the-same-id case.
# The order is deliberate; see td-17's header.
converge "td-17-habit-logs tick"    td-17-habit-logs-sync.yaml "TD_PHASE=create" "TD_HABIT=${HLOG_HABIT}" "TD_EXPECT=1" \
  -- "TD_PHASE=create" "TD_HABIT=${HLOG_HABIT}" "TD_EXPECT=1"
converge "td-17-habit-logs untick"  td-17-habit-logs-sync.yaml "TD_PHASE=delete" "TD_HABIT=${HLOG_HABIT}" "TD_EXPECT=0" \
  -- "TD_PHASE=delete" "TD_HABIT=${HLOG_HABIT}" "TD_EXPECT=0"
converge "td-17-habit-logs re-tick" td-17-habit-logs-sync.yaml "TD_PHASE=modify" "TD_HABIT=${HLOG_HABIT}" "TD_EXPECT=1" \
  -- "TD_PHASE=modify" "TD_HABIT=${HLOG_HABIT}" "TD_EXPECT=1"

# 8/8 healthGoals ---------------------------------------------------------
converge "td-18-goals create"   td-18-goals-sync.yaml "TD_PHASE=create" "TD_VALUE=${GOAL_VALUE}" "TD_EXPECT=${GOAL_VALUE}" \
  -- "TD_PHASE=create" "TD_EXPECT=${GOAL_VALUE}"
converge "td-18-goals modify"   td-18-goals-sync.yaml "TD_PHASE=modify" "TD_VALUE2=${GOAL_VALUE2}" "TD_EXPECT=${GOAL_VALUE2}" \
  -- "TD_PHASE=modify" "TD_EXPECT=${GOAL_VALUE2}"
converge "td-18-goals delete"   td-18-goals-sync.yaml "TD_PHASE=delete" \
  -- "TD_PHASE=delete"

# ===========================================================================
# phase 3 — tombstone propagation, ordered so `verify` cannot pass vacuously
# ===========================================================================
if (( FAILED == 0 )); then
  note "[td] === phase 3: tombstone propagation (seed → witness → kill → verify) ==="
  single A "td-30 seed"    td-30-tombstone-propagation.yaml "TD_STEP=seed"    "TD_MARK=${TOMB_MARK}" "TD_VALUE=${TOMB_VALUE}" || true
  # A witness failure is FATAL and `kill` is never reached: a suite that cannot
  # deliver a create must not be allowed to claim a delete.
  (( FAILED == 0 )) && single B "td-30 witness" td-30-tombstone-propagation.yaml "TD_STEP=witness" "TD_MARK=${TOMB_MARK}" || true
  (( FAILED == 0 )) && single A "td-30 kill"    td-30-tombstone-propagation.yaml "TD_STEP=kill"    "TD_MARK=${TOMB_MARK}" || true
  (( FAILED == 0 )) && single B "td-30 verify"  td-30-tombstone-propagation.yaml "TD_STEP=verify"  "TD_MARK=${TOMB_MARK}" || true
fi

# ===========================================================================
# phase 4 — airplane mode on B → mutate on A → reconnect → catch-up
# ===========================================================================
if (( FAILED == 0 )); then
  note "[td] === phase 4: airplane-mode → reconnect catch-up ==="
  single B "td-31 b-offline"   td-31-airplane-catchup.yaml "TD_STEP=b-offline"   "TD_MARK=${OFFLINE_HABIT}" || true
  (( FAILED == 0 )) && single A "td-31 a-write" td-31-airplane-catchup.yaml "TD_STEP=a-write" "TD_MARK=${OFFLINE_HABIT}" || true
  (( FAILED == 0 )) && single B "td-31 b-reconnect" td-31-airplane-catchup.yaml "TD_STEP=b-reconnect" "TD_MARK=${OFFLINE_HABIT}" || true
fi

# ===========================================================================
# phase 5 — push wake delivered A→B in the ONE-USER household (§2 item 4c)
# ===========================================================================
#
# Three legs, because no single one of them is a proof on its own:
#   (a) td-32 arms B and parks it in the background;
#   (b) A mutates, and the RUNNER checks the Metro log for B's
#       `/v2/push/register` and for a `health_sync_wake` issued afterwards —
#       this is the leg that fails if `excludeUserId` is still excluding the
#       only user, because then no wake is ever issued at all;
#   (c) the runner delivers the REAL payload with `xcrun simctl push` (a
#       simulator has no APNs connection, so the Worker's push cannot arrive
#       here by itself) and td-33 asserts the wake was CONSUMED rather than
#       surfaced as an empty notification, and that B converged.
if (( FAILED == 0 )); then
  note "[td] === phase 5: push wake A→B (one-user household) ==="
  WAKE_MARK="$(wc -l < "${METRO_LOG}" 2>/dev/null | tr -d ' ' || echo 0)"
  single B "td-32-push-wake-arm" td-32-push-wake-arm.yaml || true
  (( FAILED == 0 )) && single A "td-31 a-write (wake)" td-31-airplane-catchup.yaml "TD_STEP=a-write" "TD_MARK=${WAKE_HABIT}" || true

  if (( FAILED == 0 )); then
    WAKE_TAIL="$(tail -n "+$((WAKE_MARK + 1))" "${METRO_LOG}" 2>/dev/null || true)"
    if grep -qa '/v2/push/register' <<<"${WAKE_TAIL}"; then
      note "    PASS push token registered by B (/v2/push/register)"
    else
      note "    FAIL no /v2/push/register in the Metro log — B never armed a wake target"
      FAILED=1
    fi
    if grep -qa 'health_sync_wake' <<<"${WAKE_TAIL}"; then
      note "    PASS health_sync_wake issued after A's deposit (§2 item 4c — the one-user household is not self-excluded)"
    else
      note "    FAIL no health_sync_wake after A's deposit — the Worker excluded every device in the personal household"
      FAILED=1
    fi
  fi

  if (( FAILED == 0 )); then
    # Deliver the real payload. `Simulator Target Bundle` is how simctl routes a
    # push without an APNs connection; the body is exactly what the Worker sends
    # — `{ type, householdId }` and nothing else. The relay never learns what
    # changed, only that something did.
    WAKE_PAYLOAD="${REPORT_OUT}/.health-sync-wake.apns"
    cat >"${WAKE_PAYLOAD}" <<EOF
{
  "Simulator Target Bundle": "${APP_ID}",
  "aps": { "content-available": 1 },
  "type": "health_sync_wake",
  "householdId": "${TD_HOUSEHOLD:-}",
  "body": { "type": "health_sync_wake", "householdId": "${TD_HOUSEHOLD:-}" }
}
EOF
    if [[ -z "${TD_HOUSEHOLD:-}" ]]; then
      note "    FAIL no household id was scraped from the enrolment — a wake naming no household is correctly ignored by the client, so this leg cannot be proven"
      FAILED=1
    elif xcrun simctl push "${UDID_B}" "${APP_ID}" "${WAKE_PAYLOAD}" >/dev/null 2>&1; then
      note "    PASS delivered health_sync_wake to ${DEVICE_B_NAME} (simctl push)"
      sleep 8
    else
      note "    FAIL simctl push of health_sync_wake to ${DEVICE_B_NAME} failed"
      FAILED=1
    fi
    rm -f "${WAKE_PAYLOAD}"
  fi

  (( FAILED == 0 )) && single B "td-33-push-wake-verify" td-33-push-wake-verify.yaml "TD_MARK=${WAKE_HABIT}" || true
fi

# ===========================================================================
# phase 6 — no invite-partner copy on any Health screen
# ===========================================================================
if (( FAILED == 0 )); then
  note "[td] === phase 6: no invite-partner copy on any Health screen ==="
  single A "td-40-no-invite-partner-copy" td-40-no-invite-partner-copy.yaml || true
fi

# ===========================================================================
# cleanup — GREEN RUNS ONLY, so a red run's rows stay on the devices
# ===========================================================================
if (( FAILED == 0 )); then
  note "[td] === cleanup ==="
  single A "td-99-cleanup" td-99-cleanup.yaml \
    "TD_HABIT=${HLOG_HABIT}" "TD_OFFLINE_HABIT=${OFFLINE_HABIT}" "TD_WATER_VALUE=${WATER_VALUE}" || true
  single B "td-99-cleanup" td-99-cleanup.yaml \
    "TD_HABIT=${WAKE_HABIT}" "TD_OFFLINE_HABIT=${OFFLINE_HABIT}" "TD_WATER_VALUE=${WATER_VALUE}" || true
else
  note "[td] stopping after first failure — skipping cleanup (fail fast)"
fi

# ===========================================================================
# phase 7 — privacy-cross-user-leak, LAST
# ===========================================================================
# It is the existing Health flow, unmodified and unported — it is already
# Health-specific (`health.weightLog.v1` / `water.v1` / `notes.v1` / `prefs.v1`
# are the Health MMKV keys) and already runs last in the single-device suite's
# `config.yaml` flowsOrder. It MUST stay last here too: it signs out and
# relaunches with `clearState: true` + `clearKeychain: true`, which destroys the
# device's local-first session and DEK. Anything after it would be running
# against a wiped ledger.
if (( FAILED == 0 )); then
  note "[td] === phase 7: privacy-cross-user-leak (destroys the session — always last) ==="
  single A "privacy-cross-user-leak" health/privacy-cross-user-leak.yaml || true
fi

[[ -n "${LIVE_REPORT_PID:-}" ]] && kill "${LIVE_REPORT_PID}" 2>/dev/null

# Aggregate every flow run dir this session produced for the HTML report.
comm -13 <(printf '%s\n' "${BEFORE_RUNS}" | sort) <(ls -1 "${HOME}/.maestro/tests" 2>/dev/null | sort) \
  | while IFS= read -r tname; do
      [[ -n "${tname}" ]] || continue
      for flow in "${HOME}/.maestro/tests/${tname}"/*/; do
        flow="${flow%/}"
        [[ -f "${flow}/commands.json" ]] || continue
        ln -sfn "${flow}" "${AGG_DIR}/${tname}__$(basename "${flow}")"
      done
    done

if [[ -n "$(ls -A "${AGG_DIR}" 2>/dev/null)" ]]; then
  node "${ROOT}/scripts/e2e/generate-report.mjs" \
    --maestro-dir "${AGG_DIR}" --metro-log "${METRO_LOG}" --out "${REPORT_OUT}" \
    "${REPORT_META_ARGS[@]}" \
    --progress-total "${TD_TOTAL_FLOWS}" \
    --verdicts "${SUMMARY}" --final || true
  open "${REPORT_OUT}/index.html" 2>/dev/null || true
fi

echo ""
log "report:  ${REPORT_OUT}/index.html"
log "summary: ${SUMMARY}"
log "steps:   ${REPORT_OUT}/steps-A.log , steps-B.log"
log "devices: ${DEVICE_A_NAME} (${UDID_A}) + ${DEVICE_B_NAME} (${UDID_B})"
if (( FAILED != 0 )); then
  log "RESULT: FAILED"
  exit 1
fi
log "RESULT: PASSED"
