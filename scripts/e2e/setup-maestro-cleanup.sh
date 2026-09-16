#!/usr/bin/env bash
# Source from Maestro suite runners: prune stale temp artifacts.
#
# Default ON since 2026-09-02. It was OFF, on the reasoning that parallel fleet
# runs share ~/.maestro/tests and ~/Library/Logs/maestro — but the effect was
# that nothing was EVER pruned on this machine, and the leak the prune exists to
# stop took the disk to 168MB free: three orphaned device-log collectors at
# 21-31GB each, plus 157 stale xctestrunner dirs at 31GB.
#
# The parallel-safety concern is handled inside the prune itself rather than by
# leaving it off: it skips xctestrunner dirs held by a live xcodebuild, and only
# reaps log collectors that have been reparented to launchd (their owning run is
# already dead). Set E2E_MAESTRO_CLEANUP=0 to opt out for a single run.
# shellcheck disable=SC2034
E2E_PRUNE_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prune-maestro-disk.sh"

export E2E_MAESTRO_CLEANUP="${E2E_MAESTRO_CLEANUP:-1}"

_e2e_prune_maestro_disk() {
  bash "${E2E_PRUNE_SCRIPT}" || true
}

if [[ "${E2E_MAESTRO_CLEANUP}" == "1" ]]; then
  trap _e2e_prune_maestro_disk EXIT
  _e2e_prune_maestro_disk
fi
