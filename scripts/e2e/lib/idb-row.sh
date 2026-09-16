#!/usr/bin/env bash
#
# Row gestures driven through idb, for the two-member Budget sync suite.
#
# Sourced by run-budget-multi-member-sync.sh; kept separate so the gestures can
# be exercised on their own against a booted simulator:
#
#   source scripts/e2e/lib/idb-row.sh
#   device_delete_row <udid> "<row title>" A
#
# Requires a `note` function for output; falls back to echo when standalone.

command -v note >/dev/null 2>&1 || note() { echo "$*"; }

# Swipe a row's tray open, tap Delete, confirm the native alert — all through
# idb, because Maestro cannot do either half reliably:
#
#   * its element-swipe is too short to uncover the tray, and a fixed-percentage
#     swipe only lands on the row when `centerElement` actually centred it,
#     which it cannot when the list is barely taller than the screen;
#   * the confirm is a UIAlertController, which iOS renders in its own window —
#     invisible to XCUITest snapshots of the app window, so Maestro's
#     `tapOn: '^Delete$'` hits the tray's Delete behind the alert instead.
#
# idb reads the row's real frame and sees the alert. While an alert is up,
# describe-all returns ONLY the alert's elements, which is what makes "the
# Delete inside the confirm" unambiguous against "the Delete in the tray".
device_frame_center() {
  # Prints "<centerX> <centerY> <left> <width>" for the first element whose
  # label matches, or nothing at all.
  local udid="$1" needle="$2" want_type="${3:-}"
  idb ui describe-all --udid "${udid}" 2>/dev/null | python3 -c "
import sys, json
needle, want = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '')
try:
    els = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for e in els:
    label = e.get('AXLabel') or ''
    if needle not in label:
        continue
    if want and e.get('type') != want:
        continue
    f = e.get('frame') or {}
    if not f.get('width') or not f.get('height'):
        continue
    print(int(f['x'] + f['width'] / 2), int(f['y'] + f['height'] / 2),
          int(f['x']), int(f['width']))
    break
" "${needle}" "${want_type}"
}

device_alert_is_up() {
  # True only when the alert owns the window (describe-all shows just the alert).
  idb ui describe-all --udid "$1" 2>/dev/null | python3 -c "
import sys, json
try:
    els = json.load(sys.stdin)
except Exception:
    sys.exit(1)
labels = [(e.get('AXLabel') or '') for e in els]
sys.exit(0 if len(els) <= 8 and any(l.startswith('Delete') for l in labels) else 1)
"
}

device_delete_row() {
  local udid="$1" title="$2" who="${3:-?}"
  local center x y left width

  center="$(device_frame_center "${udid}" "${title}")"
  if [[ -z "${center}" ]]; then
    note "    [${who}] delete: row '${title}' is not on screen"
    return 1
  fi
  read -r x y left width <<<"${center}"

  # Full-width drag across the row's own y — the short element-swipe never
  # uncovers Edit / Copy / Delete.
  idb ui swipe --udid "${udid}" --duration 0.5 \
    "$(( left + width - 10 ))" "${y}" "$(( left + 10 ))" "${y}" >/dev/null 2>&1
  sleep 2

  center="$(device_frame_center "${udid}" "Delete")"
  if [[ -z "${center}" ]]; then
    note "    [${who}] delete: swipe did not uncover the tray for '${title}'"
    return 1
  fi
  read -r x y left width <<<"${center}"
  idb ui tap --udid "${udid}" "${x}" "${y}" >/dev/null 2>&1
  sleep 2

  if ! device_alert_is_up "${udid}"; then
    note "    [${who}] delete: no confirm appeared after tapping Delete"
    return 1
  fi
  center="$(device_frame_center "${udid}" "Delete" Button)"
  if [[ -z "${center}" ]]; then
    note "    [${who}] delete: confirm is up but has no Delete button"
    return 1
  fi
  read -r x y left width <<<"${center}"
  idb ui tap --udid "${udid}" "${x}" "${y}" >/dev/null 2>&1
  sleep 3

  if [[ -n "$(device_frame_center "${udid}" "${title}")" ]]; then
    note "    [${who}] delete: '${title}' is still on screen after confirming"
    return 1
  fi
  note "    [${who}] deleted '${title}'"
  return 0
}
