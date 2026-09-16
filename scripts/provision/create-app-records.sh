#!/usr/bin/env bash
# Create the 5 App Store Connect app records via fastlane produce, using the
# persisted spaceship web session (from `fastlane spaceauth`). Idempotent:
# produce reports and skips apps that already exist.
#
# Team: individual "Andrei Tekhtelev" (itc_team_id 121679759 / dev team B2ZY5M2YW2)
# — the team the bundle IDs were created under.

set -uo pipefail
export FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_HIDE_CHANGELOG=1

USER_ID="a.tekhtelev@gmail.com"
DEV_TEAM="B2ZY5M2YW2"
ITC_TEAM="121679759"
LANG="en-US"

# name|bundle|sku
APPS=(
  "Symply House|com.symply.house|symply-house"
  "Symply Budget|com.symply.budget|symply-budget"
  "Symply Kaizen|com.symply.kaizen|symply-kaizen"
  "Symply Language|com.symply.language|symply-language"
  "Symply Health|com.symply.health|symply-health"
)

fail=0
for entry in "${APPS[@]}"; do
  IFS='|' read -r NAME BUNDLE SKU <<< "$entry"
  echo "══ $NAME ($BUNDLE) ══"
  out=$(fastlane produce \
    --username "$USER_ID" \
    --app_identifier "$BUNDLE" \
    --app_name "$NAME" \
    --sku "$SKU" \
    --language "$LANG" \
    --team_id "$DEV_TEAM" \
    --itc_team_id "$ITC_TEAM" \
    --skip_devcenter true < /dev/null 2>&1)
  if echo "$out" | grep -qiE "Successfully created|already exists|already taken|Creating new app"; then
    echo "$out" | grep -iE "Successfully created|already exists|already taken" | head -1 || echo "  (created)"
  else
    echo "  ✗ FAILED:"
    echo "$out" | grep -vE "^\s+from |rubygems|cli_tools|commander|fastlane_runner|bundle exec|Gemfile|Get started" | tail -8
    fail=1
  fi
  echo ""
done

exit $fail
