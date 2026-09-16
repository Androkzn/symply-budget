#!/usr/bin/env bash
# Seed the Photos library for budget-receipt-scan-quality.yaml with EXACTLY the
# three receipt fixtures, in a known order, so the flow can address them by
# PHOTO_INDEX.
#
#   index 0 = Receip 1.png   Real Canadian Superstore
#   index 1 = Receipt 2.jpg  Costco #55
#   index 2 = Receipt 3.jpg  BC Liquor #172
#
# WHY THIS WIPES: PHPicker does not put the most-recently-added asset in the
# first cell. seed-fixtures.sh pushes six images, and libraries accumulate
# across runs (Budget-A reached 21 assets), so cell 0 was a spreadsheet and
# every "tap the first photo" scan silently read the wrong image — the
# savings-statement.jpg failure this suite chased from 2026-08-05. Adding the
# fixture immediately before the pick does NOT fix it; only controlling the
# whole library does.
#
# Usage: ./scripts/e2e/seed-receipt-quality-photos.sh [<udid>|<device-name>]
#        defaults to the brand registry's device_c (Budget-C).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "${BASH_SOURCE[0]}")/maestro-fleet-brand.sh"

TARGET="${1:-$(maestro_fleet_brand_field budget device_c)}"
if [[ "${TARGET}" =~ ^[0-9A-Fa-f-]{36}$ ]]; then
  UDID="${TARGET}"
else
  UDID="$(maestro_fleet_find_udid "${TARGET}")"
fi
if [[ -z "${UDID}" ]]; then
  echo "seed-receipt-quality-photos: no simulator matching '${TARGET}'" >&2
  exit 1
fi

FIXTURES=(
  "resourses/testing/Budget app - Receip 1.png"
  "resourses/testing/Budget app - Receipt 2.jpg"
  "resourses/testing/Budget app - Receipt 3.jpg"
)
for f in "${FIXTURES[@]}"; do
  [[ -f "${f}" ]] || { echo "seed-receipt-quality-photos: missing ${f}" >&2; exit 1; }
done

# Never wipe a device that a suite is mid-run on.
if pgrep -f "maestro" 2>/dev/null | while read -r p; do ps -o command= -p "$p"; done | grep -q "${UDID}"; then
  echo "seed-receipt-quality-photos: a Maestro run is live on ${UDID} — refusing to wipe" >&2
  exit 1
fi

MEDIA="${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Media"
echo "seed-receipt-quality-photos: resetting Photos on ${TARGET} (${UDID})"
# photolibraryd caches the library, so the device has to be down for the wipe
# to be seen — deleting under a booted device leaves stale assets in the picker.
xcrun simctl shutdown "${UDID}" >/dev/null 2>&1 || true
sleep 2
rm -rf "${MEDIA}/DCIM" "${MEDIA}/PhotoData"
xcrun simctl boot "${UDID}" >/dev/null 2>&1 || true
xcrun simctl bootstatus "${UDID}" -b >/dev/null 2>&1 || true

for i in "${!FIXTURES[@]}"; do
  xcrun simctl addmedia "${UDID}" "${FIXTURES[$i]}"
  echo "  index ${i} <- $(basename "${FIXTURES[$i]}")"
done

COUNT="$(find "${MEDIA}/DCIM" -type f \( -iname '*.jpg' -o -iname '*.png' -o -iname '*.heic' \) 2>/dev/null | wc -l | tr -d ' ')"
echo "seed-receipt-quality-photos: library now holds ${COUNT} asset(s)"
if [[ "${COUNT}" != "3" ]]; then
  echo "seed-receipt-quality-photos: expected exactly 3 — PHOTO_INDEX would be wrong" >&2
  exit 1
fi

# The reboot above drops the Expo dev client's connection, and it caches that
# failure on a "There was a problem loading the project" screen that survives a
# plain launchApp — the suite then dies at the first assert with Metro perfectly
# healthy. Warm it back up here so the reboot is invisible to the flow.
if [[ "${E2E_WARM_DEV_CLIENT:-1}" == "1" ]]; then
  PORT="$(maestro_fleet_brand_field budget metro_port)"
  if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/status" 2>/dev/null | grep -q 'packager-status:running'; then
    echo "seed-receipt-quality-photos: warming dev client against :${PORT}"
    xcrun simctl terminate "${UDID}" "$(maestro_fleet_brand_field budget app_id)" >/dev/null 2>&1 || true
    sleep 2
    xcrun simctl launch "${UDID}" "$(maestro_fleet_brand_field budget app_id)" >/dev/null 2>&1 || true
    sleep 5
    xcrun simctl openurl "${UDID}" \
      "$(maestro_fleet_brand_field budget scheme)://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${PORT}" \
      >/dev/null 2>&1 || true
    sleep 15
  else
    echo "seed-receipt-quality-photos: no Metro on :${PORT} — skipping dev-client warm-up" >&2
  fi
fi
