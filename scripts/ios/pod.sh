#!/usr/bin/env bash
# Resolve a USABLE CocoaPods and run it. Single entry point for every `pod`
# invocation in this repo — never call bare `pod` from a script.
#
# Why this exists
# ---------------
# Building this workspace needs CocoaPods >= 1.17.0. Expo's Swift macro plugin
# (`ExpoModulesMacros`) is only wired into the generated Pods project by 1.17+;
# with 1.16.x the `-load-plugin-executable` flag is never emitted and every
# target using `@OptimizedFunction` fails to compile, e.g.:
#
#   expo-crypto/ios/CryptoModule.swift:22:16: error: external macro
#   implementation type 'ExpoModulesMacros.OptimizedFunctionAttachedMacro'
#   could not be found for macro 'OptimizedFunction()'
#
# That failure is INVISIBLE on a warm DerivedData — the previously-built objects
# are reused, so a stale-but-green machine hides it until someone builds clean.
# It cost several full archive cycles to find, hence the hard guard here.
#
# Resolution order (first one meeting MIN_POD_VERSION wins):
#   1. $POD_BIN                  — explicit override, for CI or a one-off
#   2. bundle exec pod           — the declared contract, when bundler works
#   3. ~/.rbenv/shims/pod        — rbenv Ruby (the working setup on this Mac)
#   4. pod on PATH               — last resort
#
# If nothing qualifies we FAIL LOUDLY rather than silently building with a
# version that produces a broken Pods project. A wrong-version pod install is
# worse than no pod install: it leaves a tree that looks fine and breaks later.
set -euo pipefail

MIN_POD_VERSION="1.17.0"

# `sort -V`-based ">=" that does not depend on GNU coreutils being present.
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

# Echo the version a candidate reports, or nothing if it cannot run at all.
# CocoaPods prints gem warnings to stderr (a broken `ffi` on the system Ruby,
# for one), so take only the last line and keep just the version token.
pod_version_of() {
  "$@" --version 2>/dev/null | tail -1 | tr -d '[:space:]'
}

CANDIDATE_DESC=()
resolve_pod() {
  local -a candidates=()
  [ -n "${POD_BIN:-}" ] && candidates+=("POD_BIN|$POD_BIN")
  candidates+=("bundler|bundle exec pod")
  candidates+=("rbenv|$HOME/.rbenv/shims/pod")
  candidates+=("PATH|pod")

  local entry label cmd ver
  for entry in "${candidates[@]}"; do
    label="${entry%%|*}"
    cmd="${entry#*|}"
    # shellcheck disable=SC2086 -- intentional word-splitting: "bundle exec pod"
    ver="$(pod_version_of $cmd || true)"
    if [ -z "$ver" ]; then
      CANDIDATE_DESC+=("  $label ($cmd): not runnable")
      continue
    fi
    if version_ge "$ver" "$MIN_POD_VERSION"; then
      POD_CMD="$cmd"
      POD_VERSION="$ver"
      POD_SOURCE="$label"
      return 0
    fi
    CANDIDATE_DESC+=("  $label ($cmd): $ver — older than $MIN_POD_VERSION")
  done
  return 1
}

if ! resolve_pod; then
  {
    echo "ERROR: no CocoaPods >= $MIN_POD_VERSION available."
    echo
    echo "Checked:"
    printf '%s\n' "${CANDIDATE_DESC[@]}"
    echo
    echo "CocoaPods 1.16.x does NOT wire up Expo's ExpoModulesMacros Swift macro"
    echo "plugin, so the archive fails compiling expo-crypto and friends. Install"
    echo "a supported version, e.g.:"
    echo
    echo "  gem install cocoapods -v '>= $MIN_POD_VERSION'"
    echo "  # or, with rbenv (the working setup on this Mac):"
    echo "  ~/.rbenv/shims/gem install cocoapods -v '>= $MIN_POD_VERSION' && rbenv rehash"
    echo
    echo "Or point POD_BIN at a good binary:  POD_BIN=/path/to/pod $0 install"
  } >&2
  exit 1
fi

echo "-- CocoaPods $POD_VERSION (via $POD_SOURCE)"
# shellcheck disable=SC2086 -- intentional word-splitting: "bundle exec pod"
exec $POD_CMD "$@"
