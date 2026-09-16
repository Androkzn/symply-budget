#!/usr/bin/env bash
# Create the 5 Firebase Android apps in project symply-ecosystem and download each
# google-services.json to brands/<id>/google-services.json. Idempotent: existing
# apps are reused. Uses the active gcloud user auth (needs project owner/editor).
set -uo pipefail

PROJECT=symply-ecosystem
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN=$(gcloud auth print-access-token 2>/dev/null)
H=(-H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJECT" -H "Content-Type: application/json")
BASE="https://firebase.googleapis.com/v1beta1/projects/$PROJECT"

# key : display name : brand id (code id, for the brands/<id> dir)
APPS=(
  "house:Symply House:simple-house"
  "budget:Symply Budget:simple-budget"
  "kaizen:Symply Kaizen:symply-kaizen"
  "language:Symply Language:simple-language"
  "health:Symply Health:simple-health"
)

existing=$(curl -s "${H[@]}" "$BASE/androidApps?pageSize=100")
fail=0

for entry in "${APPS[@]}"; do
  IFS=':' read -r key disp brand <<< "$entry"
  pkg="com.symply.$key"
  appId=$(echo "$existing" | jq -r --arg p "$pkg" '.apps[]? | select(.packageName==$p) | .appId' | head -1)

  if [ -z "$appId" ] || [ "$appId" = "null" ]; then
    op=$(curl -s -X POST "${H[@]}" "$BASE/androidApps" -d "{\"packageName\":\"$pkg\",\"displayName\":\"$disp\"}" | jq -r '.name // .error.message')
    appId=""
    for i in $(seq 1 40); do
      r=$(curl -s "${H[@]}" "https://firebase.googleapis.com/v1beta1/$op")
      if [ "$(echo "$r" | jq -r '.done // false')" = "true" ]; then
        appId=$(echo "$r" | jq -r '.response.appId // empty')
        break
      fi
    done
    if [ -z "$appId" ]; then echo "✗ $pkg: create failed/timed out ($op)"; fail=1; continue; fi
    echo "+ created $pkg -> $appId"
  else
    echo "= exists  $pkg -> $appId"
  fi

  cfg=$(curl -s "${H[@]}" "$BASE/androidApps/$appId/config")
  contents=$(echo "$cfg" | jq -r '.configFileContents // empty')
  if [ -z "$contents" ]; then echo "  ✗ no config for $pkg: $(echo "$cfg" | jq -c '.error.message')"; fail=1; continue; fi
  echo "$cfg" | jq -r '.configFileContents | @base64d' > "$ROOT/brands/$brand/google-services.json"
  echo "  saved brands/$brand/google-services.json"
done

exit $fail
