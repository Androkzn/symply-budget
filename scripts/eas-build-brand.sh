#!/usr/bin/env bash
# Build a brand for EAS: patch native IDs → eas build → restore only files this script changed.
# Usage:
#   ./scripts/eas-build-brand.sh symply-budget [profile] [ios|android|all] [--non-interactive ...]
# Examples:
#   ./scripts/eas-build-brand.sh symply-budget
#   ./scripts/eas-build-brand.sh symply-budget symply-budget-testflight ios
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRAND="${1:?brand id required}"
shift

PROFILE=""
PLATFORM="ios"
EXTRA=()

for arg in "$@"; do
  case "$arg" in
    ios|android|all)
      PLATFORM="$arg"
      ;;
    --*)
      EXTRA+=("$arg")
      ;;
    *)
      if [[ -z "$PROFILE" ]]; then
        PROFILE="$arg"
      else
        EXTRA+=("$arg")
      fi
      ;;
  esac
done

case "$BRAND" in
  symply-budget) PROFILE="${PROFILE:-symply-budget-testflight}" ;;
  *) echo "unknown brand $BRAND"; exit 1 ;;
esac

case "$PLATFORM" in
  ios|android|all) ;;
  *) echo "platform must be ios|android|all (got: $PLATFORM)"; exit 1 ;;
esac

if ! git diff --quiet -- ios android 2>/dev/null; then
  echo "error: ios/ and/or android/ have uncommitted changes; commit or stash before brand build" >&2
  exit 1
fi

export APP_BRAND="$BRAND"
export EXPO_PUBLIC_APP_BRAND="$BRAND"

CHANGED_LIST="$(mktemp)"
cleanup() {
  local code=$?
  if [[ -s "$CHANGED_LIST" ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && git checkout -- "$f" 2>/dev/null || true
    done < "$CHANGED_LIST"
  fi
  rm -f "$CHANGED_LIST"
  exit "$code"
}
trap cleanup EXIT

node scripts/ios/apply-brand-ios.cjs
node scripts/android/apply-brand-android.cjs
git diff --name-only -- ios android > "$CHANGED_LIST" || true

EAS_ARGS=(build --profile "$PROFILE" --platform "$PLATFORM")
if ((${#EXTRA[@]})); then
  EAS_ARGS+=("${EXTRA[@]}")
fi
eas "${EAS_ARGS[@]}"
