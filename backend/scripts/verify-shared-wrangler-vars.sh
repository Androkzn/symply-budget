#!/usr/bin/env bash
# BUILD-6: fail if AIHOUSEKEEPER model vars drift across fleet wrangler configs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEYS=(
  AIHOUSEKEEPER_BRIEFING_MODEL
  AIHOUSEKEEPER_NUDGE_MODEL
  AIHOUSEKEEPER_FALLBACK_MODEL
  AIHOUSEKEEPER_MIN_APP_VERSION
  AIHOUSEKEEPER_REALTIME_MODEL
  AIHOUSEKEEPER_REALTIME_VOICE
)

FILES=(
  wrangler.toml
  wrangler.budget.toml
  wrangler.kaizen.toml
  wrangler.health.toml
)

fail=0
for key in "${KEYS[@]}"; do
  fleet_val=""
  for f in "${FILES[@]}"; do
    # Unique values for this key in the file (all envs).
    found=$(grep -E "^${key}[[:space:]]*=" "$f" | sed -E 's/.*=[[:space:]]*"?([^"]+)"?.*/\1/' | sort -u || true)
    if [[ -z "$found" ]]; then
      echo "✗ $f missing $key"
      fail=1
      continue
    fi
    count=$(printf '%s\n' "$found" | grep -c . || true)
    if [[ "$count" -gt 1 ]]; then
      echo "✗ $f has conflicting $key values:"
      printf '  %s\n' "$found"
      fail=1
      continue
    fi
    val=$(printf '%s\n' "$found" | head -1)
    if [[ -z "$fleet_val" ]]; then
      fleet_val="$val"
    elif [[ "$val" != "$fleet_val" ]]; then
      echo "✗ $key differs: $f has '$val' (expected '$fleet_val')"
      fail=1
    fi
  done
  if [[ -n "$fleet_val" && "$fail" -eq 0 ]]; then
    echo "✓ $key = $fleet_val"
  elif [[ -n "$fleet_val" ]]; then
    echo "· $key checked (see errors above)"
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "Shared wrangler vars check failed (BUILD-6)."
  exit 1
fi
echo "Shared wrangler vars OK."
