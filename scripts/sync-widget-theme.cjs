#!/usr/bin/env node
/**
 * Verifies widget brand wiring after `tokens:build`.
 * Mint accents come from DesignTokens.generated.swift (BrandTokens), not inline hex.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const widgetFile = path.join(root, 'ios/SymplyEcosystemWidget/WidgetTheme.swift');
const tokensFile = path.join(
  root,
  'ios/SymplyEcosystemWidget/DesignTokens.generated.swift',
);

function main() {
  if (!fs.existsSync(tokensFile)) {
    console.error(
      'Missing DesignTokens.generated.swift — run `npm run tokens:build` first',
    );
    process.exit(1);
  }
  if (!fs.existsSync(widgetFile)) {
    console.error(`WidgetTheme not found: ${widgetFile}`);
    process.exit(1);
  }

  const swift = fs.readFileSync(widgetFile, 'utf8');
  if (!swift.includes('BrandTokens.primary')) {
    console.error(
      'WidgetTheme.swift must use BrandTokens.primary (run design:build / check WidgetTheme)',
    );
    process.exit(1);
  }

  console.log(
    'Widget theme OK — mint → BrandTokens.primary (DesignTokens.generated.swift)',
  );
}

main();
