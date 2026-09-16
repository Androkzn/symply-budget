#!/usr/bin/env bash
# Seed macOS Keychain from .env.local + current shell env (no chat paste).
# Run once on a developer machine. Never prints secret values.
# Usage: ./scripts/secrets/seed-from-local.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PUT="$ROOT/scripts/secrets/put.sh"
ENV_FILE="${1:-$ROOT/.env.local}"

put_if() {
  local service="$1"
  local value="${2:-}"
  if [[ -n "$value" ]]; then
    "$PUT" "$service" "$value" >/dev/null
    echo "seeded: $service"
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "read: $ENV_FILE"
else
  echo "skip: no $ENV_FILE"
fi

put_if symply.cloudflare.api_token  "${CLOUDFLARE_API_TOKEN:-}"
put_if symply.cloudflare.account_id "${CLOUDFLARE_ACCOUNT_ID:-}"
put_if symply.sentry.auth_token     "${SENTRY_AUTH_TOKEN:-}"
put_if symply.expo.token            "${EXPO_TOKEN:-}"
put_if symply.resend.api_key        "${RESEND_API_KEY:-}"

if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  put_if symply.aws.access_key_id     "$AWS_ACCESS_KEY_ID"
  put_if symply.aws.secret_access_key "$AWS_SECRET_ACCESS_KEY"
elif [[ -f "$HOME/.aws/credentials" ]]; then
  AK="$(awk '
    BEGIN { p=0 }
    /^\[default\]/ { p=1; next }
    /^\[simple-house\]/ { p=1; next }
    /^\[/ { p=0 }
    p && $1 == "aws_access_key_id" { print $3; exit }
  ' "$HOME/.aws/credentials")"
  SK="$(awk '
    BEGIN { p=0 }
    /^\[default\]/ { p=1; next }
    /^\[simple-house\]/ { p=1; next }
    /^\[/ { p=0 }
    p && $1 == "aws_secret_access_key" { print $3; exit }
  ' "$HOME/.aws/credentials")"
  put_if symply.aws.access_key_id     "${AK:-}"
  put_if symply.aws.secret_access_key "${SK:-}"
fi

if [[ -n "${AWS_REGION:-}" ]]; then
  put_if symply.aws.region "$AWS_REGION"
elif [[ -n "${AWS_DEFAULT_REGION:-}" ]]; then
  put_if symply.aws.region "$AWS_DEFAULT_REGION"
fi

echo "done. list with: ./scripts/secrets/list.sh"
