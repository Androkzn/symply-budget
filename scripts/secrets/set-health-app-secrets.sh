#!/usr/bin/env bash
# Optional: set leftover Health Worker secrets from backend/.env.health-secrets.
# End-user AI is BYOK — ANTHROPIC/OPENAI here are optional platform fallbacks only.
# TWILIO are unused — ignored if blank.
#
#   cp backend/.env.health-secrets.example backend/.env.health-secrets
#   bash scripts/secrets/set-health-app-secrets.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
eval "$(./scripts/secrets/export-env.sh)" 2>/dev/null

ENVFILE="${1:-backend/.env.health-secrets}"
if [[ ! -f "$ENVFILE" ]]; then
  echo "Missing $ENVFILE — copy from backend/.env.health-secrets.example if you need optional fallbacks."
  exit 1
fi
set -a; source "$ENVFILE"; set +a
cd backend

# Only optional managed-AI fallbacks. Unused integrations are not listed.
SECRETS=(ANTHROPIC_API_KEY OPENAI_API_KEY)

for name in "${SECRETS[@]}"; do
  val="${!name:-}"
  if [[ -z "$val" ]]; then echo "  SKIP  $name (blank)"; continue; fi
  ok=0
  for e in staging production; do
    if printf '%s' "$val" | npx wrangler secret put "$name" -c wrangler.health.toml --env "$e" >/dev/null 2>&1; then ok=$((ok+1)); fi
  done
  echo "  SET   $name ($ok/2 envs)"
done
echo "Done. Redeploy not required (secrets apply live)."
