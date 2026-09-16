#!/usr/bin/env bash
# Fleet TestFlight readiness smoke-check for all 5 Symply brands:
# House, Budget, Kaizen, Language, Health — brand packs, API wiring, EAS, schemes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANDS="symply-house symply-budget symply-kaizen symply-language symply-health"

fail=0
check() {
  local ok="$1" msg="$2"
  if [[ "$ok" == "1" ]]; then
    echo "  OK  $msg"
  else
    echo "  FAIL $msg"
    fail=1
  fi
}

warn() {
  local ok="$1" msg="$2"
  if [[ "$ok" == "1" ]]; then
    echo "  OK  $msg"
  else
    echo "  WARN $msg"
  fi
}

brand_budget_expect() {
  case "$1" in
    symply-house) echo minimal ;;
    symply-budget) echo full ;;
    symply-kaizen) echo off ;;
    symply-language) echo off ;;
    symply-health) echo minimal ;;
    *) echo "" ;;
  esac
}

brand_bundle_expect() {
  case "$1" in
    symply-house) echo com.symply.house ;;
    symply-budget) echo com.symply.budget ;;
    symply-kaizen) echo com.symply.kaizen ;;
    symply-language) echo com.symply.language ;;
    symply-health) echo com.symply.health ;;
    *) echo "" ;;
  esac
}

echo "== Brand packs =="
for brand in $BRANDS; do
  node scripts/validate-brand.cjs "$brand" >/dev/null 2>&1 && check 1 "$brand validate" || check 0 "$brand validate"
done

echo "== Budget modes =="
for brand in $BRANDS; do
  MODE="$(node -e "console.log(require('./brands/${brand}/brand.cjs').features.budget)")"
  EXPECT="$(brand_budget_expect "$brand")"
  [[ "$MODE" == "$EXPECT" ]] && check 1 "${brand} budget=${EXPECT}" || check 0 "${brand} budget=${EXPECT} (got $MODE)"
done

echo "== Bundle IDs =="
for brand in $BRANDS; do
  BUNDLE="$(node -e "console.log(require('./brands/${brand}/brand.cjs').iosBundleId)")"
  EXPECT="$(brand_bundle_expect "$brand")"
  [[ "$BUNDLE" == "$EXPECT" ]] && check 1 "${brand} bundle ${EXPECT}" || check 0 "${brand} bundle ${EXPECT} (got $BUNDLE)"
done

echo "== Xcode schemes (required: House/Budget/Kaizen) =="
SCHEMES="ios/SymplyEcosystem.xcodeproj/xcshareddata/xcschemes"
for s in \
  "SymplyHouse-Staging.xcscheme" \
  "SymplyHouse-Production.xcscheme" \
  "SymplyBudget-Staging.xcscheme" \
  "SymplyBudget-Production.xcscheme" \
  "SymplyKaizen-Staging.xcscheme" \
  "SymplyKaizen-Production.xcscheme"
do
  [[ -f "$SCHEMES/$s" ]] && check 1 "$s" || check 0 "$s"
done

echo "== Xcode schemes (optional: Language/Health) =="
for s in \
  "SymplyLanguage-Staging.xcscheme" \
  "SymplyLanguage-Production.xcscheme" \
  "SymplyHealth-Staging.xcscheme" \
  "SymplyHealth-Production.xcscheme"
do
  [[ -f "$SCHEMES/$s" ]] && warn 1 "$s" || warn 0 "$s (missing — archive via prepare:xcode or EAS)"
done

echo "== Client API files =="
[[ -f src/api/home-budget.ts ]] && check 1 "home-budget.ts" || check 0 "home-budget.ts"
[[ -f src/api/budget.ts ]] && check 1 "budget.ts" || check 0 "budget.ts"
[[ -f backend/src/routes/home-budget.ts ]] && check 1 "BE home-budget route" || check 0 "BE home-budget route"

echo "== Wrangler money flags =="
HOUSE_FLAG="$(grep -c 'BUDGET_API_ENABLED = "false"' backend/wrangler.toml || true)"
BUDGET_FLAG="$(grep -c 'BUDGET_API_ENABLED = "true"' backend/wrangler.budget.toml || true)"
KAIZEN_FLAG="$(grep -c 'BUDGET_API_ENABLED = "false"' backend/wrangler.kaizen.toml || true)"
HEALTH_FLAG="$(grep -c 'BUDGET_API_ENABLED = "false"' backend/wrangler.health.toml || true)"
[[ "$HOUSE_FLAG" -ge 1 ]] && check 1 "House BUDGET_API_ENABLED=false" || check 0 "House BUDGET_API_ENABLED=false"
[[ "$BUDGET_FLAG" -ge 1 ]] && check 1 "Budget BUDGET_API_ENABLED=true" || check 0 "Budget BUDGET_API_ENABLED=true"
[[ "$KAIZEN_FLAG" -ge 1 ]] && check 1 "Kaizen BUDGET_API_ENABLED=false" || check 0 "Kaizen BUDGET_API_ENABLED=false"
[[ "$HEALTH_FLAG" -ge 1 ]] && check 1 "Health BUDGET_API_ENABLED=false" || check 0 "Health BUDGET_API_ENABLED=false"

echo "== Language API (no wrangler.language.toml) =="
[[ ! -f backend/wrangler.language.toml ]] && check 1 "no wrangler.language.toml (donor backend)" || check 0 "unexpected wrangler.language.toml"
grep -q 'simple-language-api-staging.a-tekhtelev.workers.dev' src/config/env.ts && \
  check 1 "env.ts LANGUAGE_STAGING → simple-language-api-staging" || \
  check 0 "env.ts LANGUAGE_STAGING → simple-language-api-staging"
grep -q 'simple-language-api.a-tekhtelev.workers.dev' src/config/env.ts && \
  check 1 "env.ts LANGUAGE_PRODUCTION → simple-language-api" || \
  check 0 "env.ts LANGUAGE_PRODUCTION → simple-language-api"
grep -q "brand.id === 'symply-language'" src/config/env.ts && \
  check 1 "env.ts resolveBrandApiUrls symply-language branch" || \
  check 0 "env.ts resolveBrandApiUrls symply-language branch"

echo "== API URL literals in env.ts =="
for host in \
  simple-house-api-staging.a-tekhtelev.workers.dev \
  simple-house-api.a-tekhtelev.workers.dev \
  simple-budget-api-staging.a-tekhtelev.workers.dev \
  simple-budget-api.a-tekhtelev.workers.dev \
  symply-kaizen-api-staging.a-tekhtelev.workers.dev \
  symply-kaizen-api.a-tekhtelev.workers.dev \
  simple-language-api-staging.a-tekhtelev.workers.dev \
  simple-language-api.a-tekhtelev.workers.dev \
  symply-health-api-staging.a-tekhtelev.workers.dev \
  symply-health-api.a-tekhtelev.workers.dev
do
  grep -q "$host" src/config/env.ts && check 1 "env.ts host $host" || check 0 "env.ts host $host"
done

echo "== npm scripts =="
for s in start:house start:budget start:kaizen start:language start:health \
  prepare:xcode:house prepare:xcode:budget prepare:xcode:kaizen prepare:xcode:health; do
  node -e "const p=require('./package.json'); process.exit(p.scripts['$s']?0:1)" && check 1 "$s" || check 0 "$s"
done

echo "== EAS build profiles (TestFlight) =="
node -e "
const eas = require('./eas.json');
const build = eas.build || {};
const required = [
  'symply-budget-testflight',
  'symply-kaizen-testflight',
  'symply-language-testflight',
  'symply-health-testflight',
];
let ok = true;
if (!build['symply-house-testflight'] && !build['testflight']) {
  console.error('missing symply-house-testflight (or legacy testflight)');
  ok = false;
} else {
  console.log('house testflight profile present');
}
for (const p of required) {
  if (!build[p]) { console.error('missing build profile: ' + p); ok = false; }
  else console.log('build profile: ' + p);
}
process.exit(ok ? 0 : 1);
" >/dev/null 2>&1 && check 1 "all 5 TestFlight build profiles" || check 0 "TestFlight build profiles — add symply-*-testflight in eas.json build section"

echo "== EAS submit profiles =="
node -e "
const eas = require('./eas.json');
const submit = eas.submit || {};
let ok = true;
const houseOk = submit['production'] || submit['testflight'];
if (!houseOk) { console.error('missing house submit: production or testflight'); ok = false; }
else console.log('house submit present');
for (const p of ['symply-budget-testflight','symply-kaizen-testflight','symply-language-testflight','symply-health-testflight']) {
  if (!submit[p]) { console.error('missing submit profile: ' + p); ok = false; }
  else console.log('submit profile: ' + p);
}
process.exit(ok ? 0 : 1);
" >/dev/null 2>&1 && check 1 "all required submit profiles" || check 0 "submit profiles — add symply-budget-testflight, symply-kaizen-testflight (+ language/health) in eas.json submit"

echo "== Sentry DSN (per brand) =="
for brand in $BRANDS; do
  node -e "
    const b = require('./brands/${brand}/brand.cjs');
    const dsn = (b.integrations && b.integrations.sentry && b.integrations.sentry.dsn) || '';
    process.exit(dsn.length > 20 ? 0 : 1);
  " && check 1 "${brand} sentry.dsn" || check 0 "${brand} sentry.dsn (empty or missing)"
done

echo "== PostHog key (per brand) =="
for brand in $BRANDS; do
  node -e "
    const b = require('./brands/${brand}/brand.cjs');
    const ph = b.integrations && b.integrations.posthog;
    const key = (ph && (ph.apiKey || ph.key)) || '';
    process.exit(key.length > 5 ? 0 : 1);
  " && check 1 "${brand} posthog key" || check 0 "${brand} posthog key (empty or missing)"
done

echo "== RevenueCat public keys (per brand) =="
for brand in $BRANDS; do
  node -e "
    const b = require('./brands/${brand}/brand.cjs');
    const rc = b.integrations && b.integrations.revenueCat;
    const ios = (rc && rc.iosApiKey) || '';
    const and = (rc && rc.androidApiKey) || '';
    process.exit(ios.indexOf('appl_') === 0 && and.indexOf('goog_') === 0 ? 0 : 1);
  " && check 1 "${brand} revenueCat ios+android" || check 0 "${brand} revenueCat keys (missing appl_/goog_)"
done

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "READY CHECK FAILED"
  exit 1
fi
echo
echo "READY CHECK PASSED — archive each brand via prepare:xcode:* + Product → Archive (or eas build --profile symply-*-testflight)"
