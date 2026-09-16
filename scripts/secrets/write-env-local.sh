#!/usr/bin/env bash
# Write .env.local from Keychain — the other half of seed-from-local.sh.
# Usage: ./scripts/secrets/write-env-local.sh [path]
#
# `.env.local` is gitignored, so a fresh clone has none, so every
# EXPO_PUBLIC_* key the app reads is the empty string. Nothing errors when that
# happens: Places autocomplete just never suggests, RevenueCat just reports no
# offerings. Each one looks like a broken feature rather than a missing file,
# which is exactly the detour this script exists to remove.
#
# Only publishable keys are written here — values that ship inside the app
# binary anyway. Operator tokens (Cloudflare, Sentry auth, AWS) stay in Keychain
# and reach a shell through export-env.sh; they have no business in a file Metro
# reads. Values are never printed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"
ENV_FILE="${1:-$ROOT/.env.local}"

# env var name : Keychain service. Publishable (EXPO_PUBLIC_*) only.
PUBLIC_KEYS=(
  "EXPO_PUBLIC_GOOGLE_PLACES_API_KEY:symply.google.places_key"
  "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:symply.revenuecat.ios_public"
  "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY:symply.revenuecat.android_public"
)

# Keep anything already in the file that this script does not own — a hand-added
# EXPO_PUBLIC_POSTHOG_API_KEY must survive a re-run.
declare -a KEPT=()
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line; do
    owned=0
    for pair in "${PUBLIC_KEYS[@]}"; do
      if [[ "$line" == "${pair%%:*}="* ]]; then
        owned=1
        break
      fi
    done
    [[ $owned -eq 0 ]] && KEPT+=("$line")
  done < "$ENV_FILE"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

printf '# Written by scripts/secrets/write-env-local.sh from Keychain. Gitignored.\n' > "$TMP"
printf '# Re-run after rotating a key. Operator tokens live in export-env.sh, not here.\n\n' >> "$TMP"

wrote=0
missing=0
for pair in "${PUBLIC_KEYS[@]}"; do
  name="${pair%%:*}"
  service="${pair##*:}"
  if value="$("$GET" "$service" 2>/dev/null)" && [[ -n "$value" ]]; then
    printf '%s=%s\n' "$name" "$value" >> "$TMP"
    echo "wrote: $name (from $service)"
    wrote=$((wrote + 1))
  else
    printf '# %s= (no %s in Keychain)\n' "$name" "$service" >> "$TMP"
    echo "skip:  $name — $service not in Keychain"
    missing=$((missing + 1))
  fi
done

if [[ ${#KEPT[@]} -gt 0 ]]; then
  printf '\n# Preserved from the previous %s\n' "$(basename "$ENV_FILE")" >> "$TMP"
  printf '%s\n' "${KEPT[@]}" >> "$TMP"
fi

install -m 600 "$TMP" "$ENV_FILE"
echo "$ENV_FILE — $wrote written, $missing missing"
echo "Restart Metro with a cleared cache so the new values are inlined: npx expo start -c"
