#!/usr/bin/env bash
#
# Shared report header metadata for every Maestro live-report runner.
#
# One place decides what the E2E report header shows, so every app and every
# clone produce the same report. Do not rebuild this block inside a runner —
# a per-runner copy is how House, Budget, Health and Android drifted into
# different headers (Health had none at all, so its reports carried no chips).
#
# Usage — source it, then call with the brand id:
#
#   source "$(dirname "$0")/report-meta.sh"
#   report_meta_args symply-budget
#   ... node generate-report.mjs --out "$OUT" "${REPORT_META_ARGS[@]}"
#
# Sets the array REPORT_META_ARGS. Every field is overridable: export any of
# REPORT_PLATFORM / REPORT_ENVIRONMENT / REPORT_BUILD_NUMBER / REPORT_DEVICE /
# REPORT_APP_NAME / REPORT_APP_LOGO BEFORE calling and that value wins. Android
# needs this — its build number and device come from adb, not the brand pack.
#
# Source of truth for identity is brands/<id>/brand.cjs (displayName,
# assets.appIcon, iosBuildNumber) — never app.json/app.config.ts, which reflect
# whichever brand was last resolved into native config.

# shellcheck disable=SC2034  # REPORT_META_ARGS is consumed by the caller
report_meta_args() {
  local brand_id="${1:?report_meta_args: brand id required (e.g. symply-budget)}"
  local root brand_file
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  brand_file="${root}/brands/${brand_id}/brand.cjs"

  if [[ ! -f "${brand_file}" ]]; then
    echo "[report-meta] no brand pack at ${brand_file} — header will be sparse" >&2
  fi

  local _brand_field
  _brand_field() {
    node -e "try{const b=require('${brand_file}');const v=$1;if(v!==undefined&&v!==null)console.log(v)}catch{}" 2>/dev/null || true
  }

  : "${REPORT_PLATFORM:=iOS}"
  : "${REPORT_ENVIRONMENT:=${EXPO_PUBLIC_API_ENV:-staging}}"
  [[ -z "${REPORT_APP_NAME:-}" ]] && REPORT_APP_NAME="$(_brand_field 'b.displayName')"
  [[ -z "${REPORT_BUILD_NUMBER:-}" ]] && REPORT_BUILD_NUMBER="$(_brand_field 'b.iosBuildNumber')"
  if [[ -z "${REPORT_APP_LOGO:-}" ]]; then
    # Prefer the vector mark: it is ~4 KB against a ~300-500 KB app icon, and
    # the report HTML is committed with the logo inlined as a data URI. Not
    # every brand ships one yet (House, Kaizen), so fall back to the app icon —
    # generate-report.mjs downscales an oversized raster before inlining.
    local mark="${root}/brands/${brand_id}/src/assets/images/logo-mark.svg"
    if [[ -f "${mark}" ]]; then
      REPORT_APP_LOGO="${mark}"
    else
      REPORT_APP_LOGO="$(_brand_field 'b.assets && b.assets.appIcon')"
      # brand.cjs stores repo-relative paths; make it absolute for the generator.
      [[ -n "${REPORT_APP_LOGO}" ]] && REPORT_APP_LOGO="${root}/${REPORT_APP_LOGO#/}"
    fi
  fi

  REPORT_META_ARGS=(--platform "${REPORT_PLATFORM}" --environment "${REPORT_ENVIRONMENT}")
  [[ -n "${REPORT_BUILD_NUMBER:-}" ]] && REPORT_META_ARGS+=(--build-number "${REPORT_BUILD_NUMBER}")
  [[ -n "${REPORT_DEVICE:-}" ]] && REPORT_META_ARGS+=(--device "${REPORT_DEVICE}")
  [[ -n "${REPORT_APP_NAME:-}" ]] && REPORT_META_ARGS+=(--app-name "${REPORT_APP_NAME}")
  [[ -n "${REPORT_APP_LOGO:-}" && -f "${REPORT_APP_LOGO}" ]] && REPORT_META_ARGS+=(--app-logo "${REPORT_APP_LOGO}")

  return 0
}
