#!/usr/bin/env bash
#
# Seed real test documents onto a booted iOS Simulator so E2E flows can perform
# genuine uploads instead of asserting-and-cancelling the native pickers.
#
#   scripts/e2e/seed-fixtures.sh <UDID> [app]
#     app = house | budget | kaizen | all   (default: all)
#
# Two channels, matching how the app's pickers read files:
#   * kind=image    -> Photos library, via `xcrun simctl addmedia`
#                      (expo-image-picker / ImageCropPicker "Gallery"/camera).
#   * kind=document -> Files app "On My iPhone" > SymplyE2E/, via the File
#                      Provider LocalStorage backing store
#                      (expo-document-picker UIDocumentPickerViewController).
#
# Files are normalized to their sanitized manifest `name` (spaces / double
# extensions / the .png-that-is-JPEG are fixed) so picker type filters, Photos
# and Maestro all match. Idempotent: safe to re-run.
set -euo pipefail

UDID="${1:-}"
APP="${2:-all}"

# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(cd "$(dirname "$0")" && pwd)/maestro-fleet-brand.sh"
if [[ -z "$UDID" ]]; then
  echo "usage: $0 <UDID> [house|budget|kaizen|all]" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES_JS="$REPO_ROOT/e2e/fixtures/index.js"
DEVICE_DATA="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data"
DOCS_ROOT="$DEVICE_DATA/Library/Application Support/FileProvider/com.apple.FileProvider.LocalStorage/NSFileProviderDomainDefaultIdentifier"
DOCS_DIR="$DOCS_ROOT/SymplyE2E"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/symply-e2e-fixtures.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

if [[ ! -d "$DEVICE_DATA" ]]; then
  echo "!! Device data dir not found for $UDID ($DEVICE_DATA). Is the sim created/booted?" >&2
  exit 1
fi

# Emit TSV: app<TAB>kind<TAB>name<TAB>absPath  (filtered by requested app).
# (bash 3.2 on macOS has no `mapfile`, so read the rows with a while loop.)
ROWS_TSV="$(node -e '
  const fx = require(process.argv[1]);
  const app = process.argv[2];
  const items = app === "all" ? fx.listFixtures() : fx.listFixtures(app);
  for (const f of items) {
    fx.assertExists(f.key);
    process.stdout.write([f.app, f.kind, f.name, f.absPath].join("\t") + "\n");
  }
' "$FIXTURES_JS" "$APP")"

if [[ -z "$ROWS_TSV" ]]; then
  echo "No fixtures for app='$APP'." >&2
  exit 1
fi

IMAGES=()
DOCS=()
ROW_COUNT=0
while IFS=$'\t' read -r r_app r_kind r_name r_path; do
  [[ -z "$r_name" ]] && continue
  ROW_COUNT=$((ROW_COUNT + 1))
  staged="$STAGE/$r_name"
  cp "$r_path" "$staged"
  if [[ "$r_kind" == "image" ]]; then
    IMAGES+=("$staged")
  else
    DOCS+=("$staged")
  fi
done <<<"$ROWS_TSV"

# The bundles this run is seeding for, resolved ONCE from the fleet registry.
#
# Built here at top level rather than inside the documents branch below, because
# the permission grant at the end of this file needs them whether or not any
# document fixtures were seeded — a photo-only run still opens a picker.
GRANT_BUNDLES=()
if [[ "$APP" == "all" ]]; then
  for _b in house budget kaizen language health; do
    GRANT_BUNDLES+=("$(maestro_fleet_brand_field "$_b" app_id 2>/dev/null || true)")
  done
else
  GRANT_BUNDLES+=("$(maestro_fleet_brand_field "$APP" app_id 2>/dev/null || true)")
fi

echo "Seeding ${ROW_COUNT} fixtures (app=$APP) onto $UDID"

# --- Photos (images) -------------------------------------------------------
if [[ "${#IMAGES[@]}" -gt 0 ]]; then
  echo "  Photos  : ${#IMAGES[@]} image(s) -> library"
  # addmedia accepts many paths at once; keep per-file for clearer failures.
  for img in "${IMAGES[@]}"; do
    xcrun simctl addmedia "$UDID" "$img"
    echo "    + $(basename "$img")"
  done
fi

# --- Files (documents) -----------------------------------------------------
if [[ "${#DOCS[@]}" -gt 0 ]]; then
  echo "  Files   : ${#DOCS[@]} document(s) -> On My iPhone/SymplyE2E"
  if [[ ! -d "$DOCS_ROOT" ]]; then
    echo "    !! File Provider LocalStorage not present yet. Open the Files app on the" >&2
    echo "       sim once (or launch any app that shows a document picker) to create it," >&2
    echo "       then re-run. Skipping document seeding." >&2
  else
    mkdir -p "$DOCS_DIR"
    for doc in "${DOCS[@]}"; do
      name="$(basename "$doc")"
      cp -f "$doc" "$DOCS_DIR/$name"
      # Also mirror into the LocalStorage root — some iOS 26 pickers list files here
      # before the SymplyE2E folder is indexed.
      cp -f "$doc" "$DOCS_ROOT/$name"
      # 8MB+ book PDFs are slow to surface in UIDocumentPickerViewController; use the
      # lightweight resume fixture for Maestro picker reliability (upload still validates PDF).
      if [[ "$name" == "book.pdf" && "$APP" == "kaizen" ]]; then
        resume_src="$(node -e "
          const fx = require(process.argv[1]);
          process.stdout.write(fx.fixture('kaizen-resume').absPath);
        " "$FIXTURES_JS")"
        if [[ -f "$resume_src" ]]; then
          cp -f "$resume_src" "$DOCS_DIR/$name"
          cp -f "$resume_src" "$DOCS_ROOT/$name"
        fi
      fi
      echo "    + $name"
    done
    # Nudge fileproviderd to re-index so the new files surface in the picker.
    touch "$DOCS_ROOT/../needs-index" 2>/dev/null || true
    for doc in "${DOCS[@]}"; do
      touch "$DOCS_ROOT/$(basename "$doc")" 2>/dev/null || true
      touch "$DOCS_DIR/$(basename "$doc")" 2>/dev/null || true
    done
    xcrun simctl spawn "$UDID" launchctl kickstart -k system/com.apple.fileproviderd >/dev/null 2>&1 || true
    sleep 2

    # ALSO seed the APP'S OWN Documents folder, which is the location the
    # document picker can actually reach.
    #
    # The FileProvider LocalStorage domain above is not enough: on iOS 26.5 a
    # UIDocumentPickerViewController opened from the app lists nothing from it —
    # verified on House-A and House-C, browsing AND searching "On My iPhone",
    # with the files present on disk and `fileproviderd` kickstarted and the
    # device rebooted. "No Results" every time.
    #
    # But the app already publishes its own Documents folder to Files as
    # "On My iPhone -> <App>": `UIFileSharingEnabled` +
    # `LSSupportsOpeningDocumentsInPlace`, set deliberately in app.config.ts so
    # on-device backups can be found there. Seeding into that folder puts the
    # fixtures somewhere the picker genuinely browses.
    #
    # This gap stayed invisible because no flow ever reached the picker: every
    # caller of `pick-document-from-files.yaml` sits behind a gate that skips
    # (a dead 'From Device' literal, an onboarding button that is gone once
    # onboarding is done), so the suite reported passes for an upload path it
    # never ran.
    # Bundle ids come from the fleet registry, never hardcoded here — a name
    # pinned in a second place is how the registry silently goes stale.
    seed_bundles=()
    if [[ "$APP" == "all" ]]; then
      for b in house budget kaizen language health; do
        seed_bundles+=("$(maestro_fleet_brand_field "$b" app_id 2>/dev/null)")
      done
    else
      seed_bundles+=("$(maestro_fleet_brand_field "$APP" app_id 2>/dev/null)")
    fi
    for bundle in "${seed_bundles[@]}"; do
      [[ -n "$bundle" ]] || continue
      app_docs="$(xcrun simctl get_app_container "$UDID" "$bundle" data 2>/dev/null)/Documents"
      [[ -d "$app_docs" ]] || continue
      mkdir -p "$app_docs/SymplyE2E"
      for doc in "${DOCS[@]}"; do
        cp -f "$doc" "$app_docs/$(basename "$doc")"
        cp -f "$doc" "$app_docs/SymplyE2E/$(basename "$doc")"
      done
      echo "    + app Documents ($bundle)"
    done
  fi
fi

# GRANT THE PICKER PERMISSIONS THE SEEDED FILES EXIST FOR.
#
# Seeding photos into the library and then leaving the app un-permissioned is
# half a setup: the first flow that opens a picker gets the iOS
# "would like full access to your Photo Library" sheet, which is a SYSTEM
# dialog. No Maestro flow can dismiss it (it belongs to another process), so it
# sits there and every remaining flow in the suite fails on whatever it was
# looking for — measured on House-B, where it stalled a run three flows from the
# end with the app itself perfectly healthy underneath.
#
# This has to live here rather than in a runner because `sim-disk-guard` ERASES a
# device that outgrows its cap, and an erase takes the TCC grants with it. The
# seeder runs on every suite start, so re-granting here is the only place that
# survives that.
#
# `|| true` throughout: a device without the app installed yet, or an older
# simctl, must not abort seeding.
for bundle in "${GRANT_BUNDLES[@]:-}"; do
  [[ -n "$bundle" ]] || continue
  xcrun simctl privacy "$UDID" grant photos "$bundle" >/dev/null 2>&1 || true
  xcrun simctl privacy "$UDID" grant camera "$bundle" >/dev/null 2>&1 || true
  echo "  Access  : photos + camera granted to $bundle"
done

echo "Done."
