#!/usr/bin/env bash
# Seed the Photos library for budget-receipt-foreign-currency.yaml with EXACTLY
# the three US receipt fixtures, in a known order, so the flow can address them
# by PHOTO_INDEX.
#
#   index 0 = US-recept.HEIC    Trader Joe's, Bellingham WA (46 items, $165.60)
#   index 1 = US-recept-1.HEIC  Kendall Market fuel, Maple Falls WA ($61.40)
#   index 2 = US-recept-3.HEIC  Kendall Market propane, Maple Falls WA ($6.52)
#
# PHPicker is NEWEST-FIRST, so the index is the REVERSE of the add order below —
# the same relationship seed-receipt-quality-photos.sh documents and measures.
#
# WHY THIS WIPES: PHPicker does not put the most-recently-added asset in cell 0.
# On a library that has accumulated fixtures across runs (Budget-A reached 21
# assets) cell 0 was a spreadsheet, and every "tap the first photo" scan
# silently read the wrong image. Adding a fixture immediately before the pick
# does NOT fix it; only controlling the whole library does.
#
# WHY HEIC AND NOT JPEG: Maestro's `addMedia` REJECTS .HEIC
# (budget-receipt-scan-quality.yaml records this), so these cannot be pushed
# from inside a flow at all — the host has to seed them via simctl. That is not
# a workaround being tolerated, it is the point: iOS hands the app HEIC by
# default, and `toVisionSafeAttachment` transcodes it to JPEG before the BYOK
# call. Seeding JPEGs would skip the transcode this feature ships on.
#
# RUN THIS *AFTER* ANY seed-fixtures.sh, AND LAUNCH WITH E2E_SEED_FIXTURES=0.
# run-budget-suite.sh seeds every budget fixture into Photos at startup (8 images
# on this account), which re-pollutes the library this script just cleaned and
# makes PHOTO_INDEX meaningless again — measured 2026-09-07, the run had to be
# aborted. The working order is:
#
#   ./scripts/e2e/seed-us-receipt-photos.sh
#   E2E_SEED_FIXTURES=0 E2E_PROGRESS_TOTAL=1 \
#     ./scripts/e2e/run-budget-suite-live-report.sh \
#     e2e/maestro/budget/budget-receipt-foreign-currency.yaml
#
# Skipping the runner's seeding is safe here: the app is already installed, the
# photos/camera grant persists on the device, and this flow reads nothing from
# Files/SymplyE2E.
#
# Usage: ./scripts/e2e/seed-us-receipt-photos.sh [<udid>|<device-name>]
#        defaults to the brand registry's device (Budget-A).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "${BASH_SOURCE[0]}")/maestro-fleet-brand.sh"

TARGET="${1:-${E2E_DEVICE:-$(maestro_fleet_brand_field budget device)}}"
if [[ "${TARGET}" =~ ^[0-9A-Fa-f-]{36}$ ]]; then
  UDID="${TARGET}"
else
  UDID="$(maestro_fleet_find_udid "${TARGET}")"
fi
if [[ -z "${UDID}" ]]; then
  echo "seed-us-receipt-photos: no simulator matching '${TARGET}'" >&2
  exit 1
fi

# ONE asset, deliberately.
#
# Seeding three made PHOTO_INDEX ambiguous — these HEICs carry their original
# EXIF capture dates, so PHPicker sorts them by when the photo was TAKEN, not by
# when simctl added them, and index 2 returned Trader Joe's rather than the
# propane receipt the add order predicted (measured 2026-09-07).
#
# It also made the flow slow enough to be killed: the Trader Joe's fixture is 46
# printed lines, gemini-3.5-flash took >90s on it, and the long silent wait that
# needed tripped maestro-flow-run's 420s driver watchdog
# (IOSDriverTimeoutException) — an infra kill with no failing assertion to read.
#
# The propane receipt is the right subject anyway: ONE item, $5.98 + $0.54
# printed tax = $6.52, so the arithmetic is checkable by eye in the report
# screenshots, and it still prints a bare "$" with a Washington address, which
# is exactly the detection path under test. With one asset in the library there
# is no index to get wrong.
FIXTURES=(
  "resourses/testing/US-recept-3.HEIC"
)
for f in "${FIXTURES[@]}"; do
  [[ -f "${f}" ]] || { echo "seed-us-receipt-photos: missing ${f}" >&2; exit 1; }
done

# Never wipe a device that a suite is mid-run on.
if pgrep -f "maestro" 2>/dev/null | while read -r p; do ps -o command= -p "$p"; done | grep -q "${UDID}"; then
  echo "seed-us-receipt-photos: a Maestro run is live on ${UDID} — refusing to wipe" >&2
  exit 1
fi

MEDIA="${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Media"
echo "seed-us-receipt-photos: resetting Photos on ${TARGET} (${UDID})"
# photolibraryd caches the library, so the device has to be down for the wipe to
# be seen — deleting under a booted device leaves stale assets in the picker.
xcrun simctl shutdown "${UDID}" >/dev/null 2>&1 || true
sleep 2
rm -rf "${MEDIA}/DCIM" "${MEDIA}/PhotoData"
xcrun simctl boot "${UDID}" >/dev/null 2>&1 || true
xcrun simctl bootstatus "${UDID}" -b >/dev/null 2>&1 || true

for f in "${FIXTURES[@]}"; do
  xcrun simctl addmedia "${UDID}" "${f}"
  echo "  added $(basename "${f}")"
done
# The add order above does NOT determine the PHPicker index for these files.
# Unlike the quality suite's JPEGs, these HEICs carry their ORIGINAL capture
# dates in EXIF, so Photos sorts by when the photo was TAKEN, not by when simctl
# added it. Measured 2026-09-07: PHOTO_INDEX 2 returned US-recept.HEIC (Trader
# Joe's), not the propane receipt the add order would predict. The flow
# therefore asserts the attachment chip's filename rather than trusting an
# index — do not "fix" the order here and assume that settles it.
echo "  => 1 asset seeded (propane receipt); the flow also pins it by FILENAME"

COUNT="$(find "${MEDIA}/DCIM" -type f \( -iname '*.jpg' -o -iname '*.png' -o -iname '*.heic' \) 2>/dev/null | wc -l | tr -d ' ')"
echo "seed-us-receipt-photos: library now holds ${COUNT} asset(s)"
if [[ "${COUNT}" != "1" ]]; then
  echo "seed-us-receipt-photos: expected exactly 1 asset — a second one reintroduces the index ambiguity" >&2
  exit 1
fi
