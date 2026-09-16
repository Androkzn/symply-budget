#!/usr/bin/env bash
# Reclaim simulator / build disk. Run between barrel test runs.
#
#   bash scripts/e2e/disk-gc.sh            # report only, changes nothing
#   bash scripts/e2e/disk-gc.sh --sims     # erase every simulator
#   bash scripts/e2e/disk-gc.sh --derived  # drop DerivedData + ModuleCache
#   bash scripts/e2e/disk-gc.sh --archives # prune old release .xcarchive dirs
#   bash scripts/e2e/disk-gc.sh --runtimes # drop orphaned simulator runtime bundles
#   bash scripts/e2e/disk-gc.sh --all      # everything below
#
# What grows, and why:
#   Devices      app bundles + app data + logs + screenshots, per run, forever
#   DerivedData  build products + ModuleCache; the single biggest consumer
#   Logs         ~/Library/Logs/CoreSimulator, one dir per device
#   Temp         maestro_xctestrunner_* under $TMPDIR (see prune-maestro-disk.sh)
#   Archives     every release build (deploy-*, EAS-triggered xcodebuild archive)
#                leaves a ~700MB .xcarchive under ~/.symply-ecosystem/ios/build/
#                archives/ forever — nothing pruned this before 2026-09-10, when
#                28 of them (19GB) had piled up across 8 days.
#   Runtime      each downloaded simulator runtime keeps its installer "Bundle"
#   bundles      cryptex image alongside the mounted runtime it unpacked into —
#                simctl doesn't count or clean these, so they're pure leak.
#
# Safe by default: refuses to touch anything while xcodebuild/maestro is running.
set -uo pipefail

DEVICES="${HOME}/Library/Developer/CoreSimulator/Devices"
DERIVED="${HOME}/Library/Developer/Xcode/DerivedData"
SIMLOGS="${HOME}/Library/Logs/CoreSimulator"
ARCHIVES="${HOME}/.symply-ecosystem/ios/build/archives"
RUNTIME_BUNDLES="/Library/Developer/CoreSimulator/Cryptex/Images/bundle"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sz() { [[ -e "$1" ]] && du -sh "$1" 2>/dev/null | cut -f1 || echo "0B"; }

report() {
  printf "\n%-10s %s\n" "SIZE" "PATH"
  printf "%-10s %s\n" "$(sz "${DEVICES}")" "CoreSimulator/Devices"
  printf "%-10s %s\n" "$(sz "${DERIVED}")" "Xcode/DerivedData"
  printf "%-10s %s\n" "$(sz "${SIMLOGS}")" "Logs/CoreSimulator"
  printf "%-10s %s\n" "$(sz "${ARCHIVES}")" "build/archives"
  printf "%-10s %s\n" "$(sz "${RUNTIME_BUNDLES}")" "CoreSimulator runtime bundles"
  echo
}

busy() {
  if pgrep -f 'xcodebuild|maestro' >/dev/null 2>&1; then
    echo "REFUSING: xcodebuild/maestro is running — a suite is in flight." >&2
    echo "Stop it first, or re-run when idle." >&2
    return 0
  fi
  return 1
}

# A path a live xcodebuild has open (its own -archivePath, or a runtime bundle
# an install/verify step is mid-mount on) must never be touched by GC.
is_path_used_by_xcodebuild() {
  local path="$1" line
  while IFS= read -r line; do
    [[ "${line}" == *"${path}"* ]] && return 0
  done < <(pgrep -lf xcodebuild 2>/dev/null || true)
  return 1
}

gc_sims() {
  busy && return 1
  echo "==> erasing all simulators"
  xcrun simctl shutdown all >/dev/null 2>&1 || true
  # erase all is far faster than per-device and cannot miss one
  xcrun simctl erase all >/dev/null 2>&1 || true
  echo "==> deleting simulators from uninstalled runtimes"
  xcrun simctl delete unavailable >/dev/null 2>&1 || true
  echo "==> pruning simulator logs"
  rm -rf "${SIMLOGS:?}"/* 2>/dev/null || true
}

gc_derived() {
  busy && return 1
  echo "==> removing DerivedData (next build will be a cold build)"
  rm -rf "${DERIVED:?}"/* 2>/dev/null || true
}

gc_temp() {
  echo "==> pruning maestro/xcodebuild temp"
  E2E_MAESTRO_CLEANUP=1 bash "${HERE}/prune-maestro-disk.sh" 2>/dev/null || true
}

# Keep the newest N archives per brand+env (dir name minus its trailing
# -YYYYMMDD-HHMMSS), delete the rest. Never touches one a live xcodebuild is
# archiving into, regardless of age.
gc_archives() {
  local keep="${E2E_ARCHIVE_KEEP:-3}"
  [[ -d "${ARCHIVES}" ]] || return 0
  echo "==> pruning old release archives (keep ${keep} per brand+env)"
  local prefixes removed=0 prefix i d
  prefixes="$(find "${ARCHIVES}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; \
    | sed -E 's/-[0-9]{8}-[0-9]{6}$//' | sort -u)"
  while IFS= read -r prefix; do
    [[ -z "${prefix}" ]] && continue
    i=0
    while IFS= read -r d; do
      i=$((i + 1))
      (( i <= keep )) && continue
      if is_path_used_by_xcodebuild "${d}"; then
        echo "skip (in use): ${d}"
        continue
      fi
      rm -rf "${d}" 2>/dev/null && removed=$((removed + 1))
    done < <(find "${ARCHIVES}" -mindepth 1 -maxdepth 1 -type d -name "${prefix}-*" | sort -r)
  done <<< "${prefixes}"
  (( removed > 0 )) && echo "removed ${removed} old archive(s)"
}

# Runtime install leaves the compressed cryptex "Bundle" image mounted
# alongside the decompressed runtime Volume it produced. Once the runtime
# shows (Ready) in `simctl runtime list`, the Volume is what's live — the
# Bundle is disposable (Xcode re-downloads it if a runtime is ever reinstalled).
gc_runtimes() {
  busy && return 1
  [[ -d "${RUNTIME_BUNDLES}" ]] || return 0
  echo "==> pruning orphaned simulator runtime bundle images"
  local d removed=0
  for d in "${RUNTIME_BUNDLES}"/SimRuntimeBundle-*; do
    [[ -e "${d}" ]] || continue
    if is_path_used_by_xcodebuild "${d}"; then
      echo "skip (in use): ${d}"
      continue
    fi
    if mount | grep -qF "${d}"; then
      diskutil eject "${d}" >/dev/null 2>&1 || true
    fi
    rm -rf "${d}" 2>/dev/null && removed=$((removed + 1))
  done
  (( removed > 0 )) && echo "removed ${removed} orphaned runtime bundle(s)"

  local dupes
  dupes="$(xcrun simctl runtime list 2>/dev/null | awk '
    /^-- /   { fam = $0; next }
    /^==/    { next }
    /^Total/ { next }
    NF       { print fam }
  ' | sort | uniq -c | awk '$1 > 1')"
  if [[ -n "${dupes}" ]]; then
    echo "NOTE: more than one runtime installed for the same OS family — see 'xcrun simctl runtime list'." >&2
    echo "      Prefer one version; 'xcrun simctl runtime delete <id>' drops an unused one." >&2
  fi
}

main() {
  echo "BEFORE:"; report
  case "${1:-}" in
    --sims)     gc_sims; gc_temp ;;
    --derived)  gc_derived ;;
    --archives) gc_archives ;;
    --runtimes) gc_runtimes ;;
    --all)      gc_sims; gc_derived; gc_temp; gc_archives; gc_runtimes ;;
    "" | --report) echo "(report only — pass --sims, --derived, --archives, --runtimes or --all to reclaim)"; return 0 ;;
    *) echo "unknown option: $1" >&2; return 2 ;;
  esac
  echo "AFTER:"; report
}

main "$@"
