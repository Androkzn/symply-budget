#!/usr/bin/env bash
#
# Run ONE multi-member flow on ONE device — the fast loop for fixing a single
# failing step.
#
# The full suite re-runs two sign-ins, invite creation and the whole enrolment
# chain (~10 min) before it reaches the step under repair. This runs just the
# step (~60-90s) against the devices as they already are.
#
# Usage:
#   ./scripts/e2e/mm-one.sh B mm-03-member-join.yaml
#   ./scripts/e2e/mm-one.sh A mm-04-owner-approve.yaml MM_SAS=481923
#   ./scripts/e2e/mm-one.sh B mm-20-add-and-await-peer.yaml MM_SECTION=spending MM_TITLE=x ...
#
# For mm-03 with no MM_LINK supplied, a fresh invite is minted through the
# control-plane API as the OWNER account, so device A does not have to be driven
# at all. Everything the device does is still real UI.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOW_DIR="${ROOT}/e2e/maestro/budget-multi-member"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

WHO="${1:?usage: mm-one.sh <A|B> <flow.yaml> [KEY=VAL ...]}"
FLOW="${2:?usage: mm-one.sh <A|B> <flow.yaml> [KEY=VAL ...]}"
shift 2

METRO_PORT="${BUDGET_METRO_PORT:-8092}"
API="${MM_API:-https://simple-budget-api-staging.a-tekhtelev.workers.dev}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

DEVICE_A_NAME="${E2E_DEVICE_A:-Budget-A}"
DEVICE_B_NAME="${E2E_DEVICE_B:-Budget-B}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
sim_guard_pair "${DEVICE_A_NAME}" "${DEVICE_B_NAME}"
find_udid() {
  xcrun simctl list devices available | grep -F "${1} (" | grep -Eo '[A-F0-9-]{36}' | head -1 || true
}

if [[ "${WHO}" == "A" ]]; then
  UDID="$(find_udid "${DEVICE_A_NAME}")"; EMAIL="${E2E_EMAIL}"; PASSWORD="${E2E_PASSWORD}"
else
  UDID="$(find_udid "${DEVICE_B_NAME}")"; EMAIL="${E2E_EMAIL_SECONDARY}"; PASSWORD="${E2E_PASSWORD_SECONDARY}"
fi
[[ -z "${UDID}" ]] && { echo "no simulator for ${WHO}" >&2; exit 1; }

if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  echo "Metro is not up on :${METRO_PORT} — start the suite once, or run start-brand.sh" >&2
  exit 1
fi

# Mint an invite through the API when the flow needs one and none was passed.
EXTRA=()
if [[ "${FLOW}" == mm-03-member-join.yaml && ! " $* " == *" MM_LINK="* ]]; then
  echo "[one] minting an invite as the owner (${E2E_EMAIL})"
  TOKEN="$(curl -s -X POST "${API}/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"${E2E_EMAIL}\",\"password\":\"${E2E_PASSWORD}\"}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('access_token') or d.get('token') or d.get('accessToken') or '')")"
  [[ -z "${TOKEN}" ]] && { echo "[one] could not log in as the owner" >&2; exit 1; }

  # Pick the household the two devices are actually PAIRED in, not households[0].
  #
  # Taking the first one silently minted an invite for an unrelated household of
  # the owner's; device B claimed it, its ledger moved there, and from then on the
  # two devices were in DIFFERENT households — so the suite's mm-03 took its
  # "already enrolled" branch, skipped the real claim, and every later phase
  # failed for reasons that had nothing to do with the code under test.
  # Prefer the household with the most registered devices; pass MM_HH to override.
  HH="${MM_HH:-}"
  if [[ -z "${HH}" ]]; then
    HH="$(curl -s "${API}/v2/households" -H "Authorization: Bearer ${TOKEN}" -H 'X-Budget-Local-First: 1' \
      | python3 -c "
import sys, json
d = json.load(sys.stdin)
hs = d.get('households') or []
if not hs:
    print('')
else:
    best = max(hs, key=lambda h: len(h.get('devices') or []))
    print(best['id'])
")"
  fi
  [[ -z "${HH}" ]] && { echo "[one] owner has no local-first household on the control plane" >&2; exit 1; }

  INV="$(curl -s -X POST "${API}/v2/households/${HH}/invites" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' -H 'X-Budget-Local-First: 1' \
    -d '{"role":"ADULT","ttlHours":24}')"
  CODE="$(python3 -c "import sys,json;print((json.loads(sys.argv[1]).get('invite') or {}).get('shortCode',''))" "${INV}")"
  SECRET="$(python3 -c "import sys,json;print((json.loads(sys.argv[1]).get('invite') or {}).get('secret',''))" "${INV}")"
  [[ -z "${CODE}" || -z "${SECRET}" ]] && { echo "[one] invite creation failed: ${INV}" >&2; exit 1; }
  # No digits here, and there cannot be: the enrolment SAS is derived from the
  # CLAIMING device's keys plus this secret, so it exists only once that device
  # has claimed. Pass MM_SAS explicitly when driving mm-04 on its own.
  echo "[one] invite code=${CODE} household=${HH}"
  EXTRA+=(-e "MM_LINK=symply-budget://lf-invite?secret=${SECRET}&code=${CODE}")
fi

LOGIN_URL="$(node -e "
  const p = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
  process.stdout.write('simplebudget://e2e-login?' + p.toString());
" "${EMAIL}" "${PASSWORD}")"

ARGS=(
  test --device "${UDID}" --format NOOP --no-reinstall-driver
  -e "APP_ID=com.symply.budget"
  -e "E2E_APP_SCHEME=simplebudget"
  -e "E2E_PLATFORM=ios"
  -e "E2E_METRO_DEVCLIENT_URL=simplebudget://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}"
  -e "MM_METRO_PORT=${METRO_PORT}"
  -e "E2E_LOGIN_URL=${LOGIN_URL}"
  -e "E2E_EMAIL=${EMAIL}"
  -e "E2E_PASSWORD=${PASSWORD}"
)
ARGS+=("${EXTRA[@]+${EXTRA[@]}}")   # empty-array safe under set -u
while (( $# > 0 )); do ARGS+=(-e "$1"); shift; done
ARGS+=("${FLOW_DIR}/${FLOW}")

echo "[one] ${WHO} → ${FLOW} on ${UDID}"
maestro "${ARGS[@]}"
RC=$?
echo "[one] exit ${RC}"
exit "${RC}"
