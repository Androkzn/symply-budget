#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export APP_BRAND="symply-budget"
export EXPO_PUBLIC_APP_BRAND="symply-budget"

echo "== verify standalone: Symply Budget =="
node scripts/validate-brand.cjs symply-budget

test -f brands/symply-budget/brand.cjs
test ! -d brands/symply-house
test ! -d brands/symply-kaizen
test ! -d brands/symply-language
test ! -d brands/symply-health
test -f backend/wrangler.toml
test ! -f backend/wrangler.budget.toml

if rg -n --glob '!*.lock' --glob '!*.map' \
  'simple-house-api|symply-house|simple-house|symply-kaizen|symply-language|symply-health' \
  app.json app.config.ts eas.json brands backend/wrangler.toml; then
  echo "Standalone configuration still references another Ecosystem app." >&2
  exit 1
fi

node - <<'NODE'
const { execFileSync } = require('node:child_process');
const config = JSON.parse(execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], { encoding: 'utf8' }));
const expected = {
  name: 'Symply Budget', slug: 'symply-budget', scheme: 'simplebudget',
  ios: 'com.symply.budget', android: 'com.symply.budget',
  updates: 'https://u.expo.dev/7e6f549f-c8ed-4018-8f20-fc578b812c20',
};
if (config.name !== expected.name || config.slug !== expected.slug || config.scheme !== expected.scheme ||
    config.ios?.bundleIdentifier !== expected.ios || config.android?.package !== expected.android ||
    config.updates?.url !== expected.updates) {
  console.error({ expected, actual: { name: config.name, slug: config.slug, scheme: config.scheme,
    ios: config.ios?.bundleIdentifier, android: config.android?.package, updates: config.updates?.url } });
  process.exit(1);
}
console.log('Expo public config: OK');
NODE

ruby - <<'RUBY'
require 'xcodeproj'
p = Xcodeproj::Project.open('ios/SymplyEcosystem.xcodeproj')
abort 'missing app target' unless p.targets.any? { |t| t.name == 'SymplyEcosystem' }
abort 'missing Widget target' unless p.targets.any? { |t| t.name == 'SymplyEcosystemWidgetExtension' }
abort 'missing Watch target' unless p.targets.any? { |t| t.name == 'SymplyEcosystemWatchApp Watch App' }
app = p.targets.find { |t| t.name == 'SymplyEcosystem' }
abort 'Watch target is not an app dependency' unless app.dependencies.any? { |d| d.target&.name == 'SymplyEcosystemWatchApp Watch App' }
bad = p.targets.flat_map(&:build_configurations).map(&:name).uniq.grep(/house|kaizen|language|health/i)
abort "non-budget Xcode configurations remain: #{bad.join(', ')}" unless bad.empty?
puts 'Xcode target topology: OK'
RUBY

echo "Standalone verification: OK"
