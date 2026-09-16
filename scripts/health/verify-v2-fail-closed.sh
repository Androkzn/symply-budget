#!/usr/bin/env bash
# He0 live proof — `/v2` is fail-CLOSED but still ARMED (Health V2 plan §1.7a).
#
# `isLocalFirstApiEnabled` now requires the literal `'true'`, and
# `LOCAL_FIRST_API_ENABLED` moved out of `[vars]` into per-env secrets. Those two
# changes have the same silent failure mode: if the secret is missing or
# mistyped on any Worker, `requireLocalFirstApi()` returns **404** and `/v2`
# disappears — taking Budget's certified two-device sync and the cron mailbox /
# checkpoint TTL sweeps with it. Nothing goes red; the deploy log is green.
#
# The only proof is a live probe, and the distinction is one status code:
#
#   401  gate ON, auth enforced          ← the required state
#   404  gate OFF (secret missing/typo)  ← /v2 is dark, mailbox TTL unswept
#   200  gate ON, auth NOT enforced      ← worse than either
#
# Read-only. Sends one unauthenticated GET per Worker. Deploys nothing.
#
# Usage:
#   ./scripts/health/verify-v2-fail-closed.sh                # budget staging + production (DoD He0)
#   ./scripts/health/verify-v2-fail-closed.sh budget health  # add the Health proof
#   ./scripts/health/verify-v2-fail-closed.sh health kaizen  # Health 401 vs Kaizen 404 (§2 item 1)
#
# Overrides (skip URL resolution): BUDGET_STAGING_URL, BUDGET_PRODUCTION_URL,
# HEALTH_STAGING_URL, … — i.e. <BRAND>_<ENV>_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENV_SHARED="src/config/env.shared.ts"
PROBE_PATH="/v2/households"  # GET, auth-gated; see backend/src/routes/local-first-v2.ts

BRANDS=("$@")
if [[ ${#BRANDS[@]} -eq 0 ]]; then
  # DoD He0 names Budget specifically: it is the one brand already certified
  # two-device, and the brand that set the flag NOWHERE before §1.7a Commit 1.
  BRANDS=(budget)
fi

fail=0

check() {
  local ok="$1" msg="$2"
  if [[ "$ok" == "1" ]]; then
    echo "  OK   $msg"
  else
    echo "  FAIL $msg"
    fail=1
  fi
}

# Hostnames come from the app's own source of truth, never from this file, so a
# Worker rename can't leave this script quietly probing a dead host.
read_url() {
  local const_name="$1"
  awk -v key="export const ${const_name}" '
    index($0, key) { found = 1 }
    found { if (match($0, /https:\/\/[^'"'"']+/)) { print substr($0, RSTART, RLENGTH); exit } }
  ' "$ENV_SHARED"
}

const_for() {
  case "$1" in
    budget) echo "BUDGET" ;;
    health) echo "HEALTH" ;;
    house)  echo "HOUSE" ;;
    kaizen) echo "KAIZEN" ;;
    *) echo "unknown brand: $1 (budget|health|house|kaizen)" >&2; return 1 ;;
  esac
}

# Kaizen has no `localFirstApi` capability, so its 404 is the CORRECT answer —
# it is the negative control that proves a 404 elsewhere means something.
expected_for() {
  case "$1" in
    kaizen) echo "404" ;;
    *)      echo "401" ;;
  esac
}

HDRS="$(mktemp -t v2-fail-closed-headers)"
BODY="$(mktemp -t v2-fail-closed-body)"
trap 'rm -f "$HDRS" "$BODY"' EXIT

echo "== He0 live proof: /v2 fail-closed =="
echo "   probe:  GET {base}${PROBE_PATH} (no Authorization header)"
echo "   source: ${ENV_SHARED}"
echo

for brand in "${BRANDS[@]}"; do
  prefix="$(const_for "$brand")" || { fail=1; continue; }
  expected="$(expected_for "$brand")"

  echo "-- ${brand} (expect ${expected}) --"
  # macOS ships bash 3.2 — no `${var,,}`, so carry both cases explicitly.
  for pair in "staging:STAGING" "production:PRODUCTION"; do
    env="${pair%%:*}"
    env_uc="${pair##*:}"
    override_var="${prefix}_${env_uc}_URL"
    base="${!override_var:-}"
    if [[ -z "$base" ]]; then
      base="$(read_url "${prefix}_${env_uc}_API_URL")"
    fi
    if [[ -z "$base" ]]; then
      check 0 "${brand} ${env}: no URL — ${prefix}_${env_uc}_API_URL not found in ${ENV_SHARED}"
      continue
    fi

    code="$(curl -sS -m 20 -D "$HDRS" -o "$BODY" -w '%{http_code}' "${base}${PROBE_PATH}" || echo "000")"

    if [[ "$code" == "$expected" ]]; then
      check 1 "${brand} ${env} ${PROBE_PATH} → ${code}   ${base}"
    else
      case "$code" in
        404) check 0 "${brand} ${env} → 404, expected ${expected}: LOCAL_FIRST_API_ENABLED is missing or not the literal 'true' on this Worker — /v2 is DARK and the mailbox/checkpoint TTL sweeps are not running" ;;
        200) check 0 "${brand} ${env} → 200, expected ${expected}: /v2 answered an UNAUTHENTICATED request — stop and investigate before deploying anything" ;;
        000) check 0 "${brand} ${env} → no response (network/DNS): ${base}" ;;
        *)   check 0 "${brand} ${env} → ${code}, expected ${expected}   ${base}" ;;
      esac
    fi

    # Kaizen's 404 body is a literal contract (backend/src/middleware/brand-gate.ts).
    if [[ "$brand" == "kaizen" && "$code" == "404" ]]; then
      if grep -q '"error":"Not found"' "$BODY" || grep -q '"error": "Not found"' "$BODY"; then
        check 1 "${brand} ${env} 404 body is {\"error\":\"Not found\"}"
      else
        check 0 "${brand} ${env} 404 body is not the expected {\"error\":\"Not found\"}"
      fi
    fi

    # Version ID — record it beside the status code. Cloudflare does not emit a
    # version header by default, so this prints one only if the Worker (or the
    # account's observability settings) exposes it; otherwise fall back to the
    # deploy output, which always prints "Current Version ID".
    version_hdr="$(grep -iE '^(cf-worker-version-id|x-worker-version(-id)?|x-version-id|cf-version):' "$HDRS" | tr -d '\r' || true)"
    if [[ -n "$version_hdr" ]]; then
      echo "       version: ${version_hdr}"
    else
      ray="$(grep -i '^cf-ray:' "$HDRS" | tr -d '\r' || true)"
      echo "       version: not in headers — ${ray:-cf-ray: n/a}"
    fi
  done
  echo
done

if [[ "$fail" -ne 0 ]]; then
  echo "V2 FAIL-CLOSED CHECK FAILED"
  echo
  echo "A 404 where 401 was expected almost always means the secret is absent:"
  echo "  bash backend/scripts/verify-local-first-api-secret.sh   # names only, no values"
  echo "  ./scripts/secrets/sync-child-worker-secrets.sh          # provisions all six"
  echo "Secret puts apply live — no redeploy required."
  exit 1
fi

echo "V2 FAIL-CLOSED CHECK PASSED"
echo
echo "Record for DoD He0 — paste back, per env:"
echo "  · brand + env, the status code above (401 for house/budget/health, 404 for kaizen)"
echo "  · the Worker Version ID. If it was not in the headers, take it from the"
echo "    'Current Version ID' line of the deploy that produced this state:"
echo "      npx wrangler deployments status --env <env> [-c wrangler.<brand>.toml]   # run in backend/"
