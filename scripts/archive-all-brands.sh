#!/usr/bin/env bash
# Archive (+ export IPA) all 5 Symply brands for TestFlight / App Store Connect.
# Usage:
#   ./scripts/archive-all-brands.sh [staging|production]
# Env:
#   SKIP_EXPORT=1  — archives only
#   CONTINUE_ON_ERROR=1 — keep going if one brand fails (default: stop)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Budget-specific alias — NOT the generic `.symply-ecosystem` name, which the
# original monorepo checkout on this Mac already owns for itself. See the
# matching comment in archive-brand.sh for why reusing that name is unsafe.
if [[ "$ROOT" == *" "* ]]; then
  for candidate in "$HOME/.symply-budget-standalone"; do
    if [[ -L "$candidate" && -d "$candidate/ios" ]]; then
      ROOT="$candidate"
      break
    fi
  done
fi
# Missing symlink → make it. Same reasoning as archive-brand.sh: the link is a
# disposable alias for this checkout that keeps getting swept away, and a
# five-brand barrel run should not stop for something one `ln` fixes.
if [[ "$ROOT" == *" "* ]]; then
  LINK="$HOME/.symply-budget-standalone"
  if [[ -e "$LINK" && ! -L "$LINK" ]]; then
    echo "ERROR: $LINK exists and is a real directory, not a symlink. Move it aside."
    exit 1
  fi
  ln -sfn "$ROOT" "$LINK"
  echo "== Created no-space symlink: $LINK -> $ROOT =="
  [[ -d "$LINK/ios" ]] && ROOT="$LINK"
fi
if [[ "$ROOT" == *" "* ]]; then
  echo "ERROR: use symlink \$HOME/.symply-budget-standalone (no spaces)."
  exit 1
fi
cd "$ROOT"

API_ENV="${1:-production}"
BRANDS=(symply-house symply-budget symply-kaizen symply-language symply-health)
STAMP="$(date +%Y%m%d-%H%M%S)"
SUMMARY="$ROOT/ios/build/archives/ALL-$API_ENV-$STAMP-summary.txt"
mkdir -p "$ROOT/ios/build/archives"
: >"$SUMMARY"

ok=0
fail=0
declare -a RESULTS=()

for brand in "${BRANDS[@]}"; do
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  archive-all: $brand ($API_ENV)"
  echo "╚══════════════════════════════════════════════════════════════╝"
  if ./scripts/archive-brand.sh "$brand" "$API_ENV"; then
    RESULTS+=("OK  $brand")
    ok=$((ok + 1))
  else
    RESULTS+=("FAIL $brand")
    fail=$((fail + 1))
    if [[ "${CONTINUE_ON_ERROR:-0}" != "1" ]]; then
      echo "Stopping (set CONTINUE_ON_ERROR=1 to keep going)." | tee -a "$SUMMARY"
      break
    fi
  fi
done

{
  echo "stamp=$STAMP env=$API_ENV"
  echo "ok=$ok fail=$fail"
  printf '%s\n' "${RESULTS[@]}"
  echo ""
  echo "Archives under: $ROOT/ios/build/archives/"
  ls -1dt "$ROOT/ios/build/archives/"*-"$API_ENV"-* 2>/dev/null | head -20 || true
} | tee -a "$SUMMARY"

echo ""
echo "Summary → $SUMMARY"
[[ "$fail" -eq 0 ]]
