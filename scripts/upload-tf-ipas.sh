#!/usr/bin/env bash
# Upload prepared brand IPAs to App Store Connect (TestFlight processing).
# Usage:
#   ./scripts/upload-tf-ipas.sh [IPA_DIR]
# Defaults to ios/build/archives/TF-upload-YYYYMMDD (latest) or TF-upload-20260716.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GET="$ROOT/scripts/secrets/get.sh"
ASC_ISSUER_ID="$("$GET" symply.asc.issuer_id)"
ASC_KEY_ID="$("$GET" symply.asc.key_id)"
ASC_KEY_PATH="$("$GET" symply.asc.key_path)"

# Fail loudly on an empty key id. Without this the filename below degrades to
# `AuthKey_.p8`, altool reports "could not be found in any of these locations",
# and the real cause (an unset Keychain entry) is invisible.
if [[ -z "$ASC_KEY_ID" || -z "$ASC_ISSUER_ID" ]]; then
  echo "error: empty ASC credentials from Keychain — set symply.asc.key_id and symply.asc.issuer_id" >&2
  echo "       (an empty key id makes altool look for a file literally named AuthKey_.p8)" >&2
  exit 1
fi

if [[ ! -f "$ASC_KEY_PATH" ]]; then
  echo "error: ASC key file missing at path from Keychain (symply.asc.key_path)" >&2
  exit 1
fi

# altool searches ~/.appstoreconnect/private_keys/AuthKey_<id>.p8
KEYS_DIR="${HOME}/.appstoreconnect/private_keys"
mkdir -p "$KEYS_DIR"
TARGET_KEY="$KEYS_DIR/AuthKey_${ASC_KEY_ID}.p8"
if [[ ! -f "$TARGET_KEY" ]]; then
  cp "$ASC_KEY_PATH" "$TARGET_KEY"
  chmod 600 "$TARGET_KEY"
fi
export API_PRIVATE_KEYS_DIR="$KEYS_DIR"

IPA_DIR="${1:-}"
if [[ -z "$IPA_DIR" ]]; then
  IPA_DIR="$(ls -1dt "$ROOT"/ios/build/archives/TF-upload-* 2>/dev/null | head -1 || true)"
fi
if [[ -z "$IPA_DIR" || ! -d "$IPA_DIR" ]]; then
  echo "error: IPA dir not found. Pass path to folder of *.ipa files." >&2
  exit 1
fi

ok=0
fail=0
shopt -s nullglob
for ipa in "$IPA_DIR"/*.ipa; do
  name="$(basename "$ipa")"
  echo ""
  echo "▶ Uploading $name"
  set +e
  xcrun altool --upload-app -f "$ipa" -t ios \
    --apiKey "$ASC_KEY_ID" \
    --apiIssuer "$ASC_ISSUER_ID" \
    2>&1 | tee /tmp/altool-"$name".log
  code=${PIPESTATUS[0]}
  set -e
  if [[ "$code" -eq 0 ]]; then
    echo "✅ $name"
    ok=$((ok + 1))
  else
    echo "❌ $name (exit $code) — see /tmp/altool-$name.log"
    fail=$((fail + 1))
  fi
done

echo ""
echo "Uploaded ok=$ok fail=$fail from $IPA_DIR"
[[ "$fail" -eq 0 && "$ok" -gt 0 ]]
