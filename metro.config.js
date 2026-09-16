// Learn more https://docs.expo.io/guides/customizing-metro
const fs = require('fs');
const path = require('path');

const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Polyfill for Node.js < 20
if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function() {
    return this.slice().reverse();
  };
}

/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

// E2E Kaizen fixtures (technical-questions.txt) are required from e2e-document-pick.ts.
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), 'txt'];

// Ensure Hermes parser is used for Flow syntax support
config.transformer.hermesParser = true;

// ── Single react-navigation instance ────────────────────────────────────────
// expo-router (SDK 57) VENDORS its own copy of react-navigation under
// `expo-router/build/react-navigation/*` and mounts the app's root navigation
// container from it (`ExpoRoot`). The app also declares the standalone
// `@react-navigation/*` packages and builds ~13 nested native-stack navigators
// from them (BudgetNavigator, SettingsNavigator, TasksNavigator, …).
//
// Those are two separate module instances, each defining its own
// `SingleNavigatorContext`. A standalone navigator mounted under expo-router's
// vendored root therefore can't find a matching context and throws a fatal
// "Couldn't register the navigator. … multiple copies of '@react-navigation'
// packages installed." (useRegisterNavigator). It surfaces on every tab that
// mounts a raw navigator (Budget, Utilities, Tasks, …).
//
// Redirect every `@react-navigation/*` import to expo-router's vendored copy so
// the entire app shares ONE react-navigation instance — the canonical dedupe
// React Navigation itself recommends for this error. expo-router's own vendored
// tree imports its siblings via RELATIVE paths (no bare `@react-navigation/*`
// requires), so this alias only affects app + third-party imports and leaves
// expo-router internals untouched.
const vendoredReactNavigation = path.join(
  path.dirname(require.resolve('expo-router/package.json')),
  'build',
  'react-navigation',
);

function resolveVendoredReactNavigation(moduleName) {
  const match = /^@react-navigation\/(.+)$/.exec(moduleName);
  if (!match) return null;
  const base = path.join(vendoredReactNavigation, match[1]);
  const candidates = [`${base}.js`, path.join(base, 'index.js'), base];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  // Sub-path not present in the vendored build → fall back to default resolution.
  return null;
}

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@react-navigation/')) {
    const filePath = resolveVendoredReactNavigation(moduleName);
    if (filePath) {
      return { type: 'sourceFile', filePath };
    }
  }
  const resolver = upstreamResolveRequest || context.resolveRequest;
  return resolver(context, moduleName, platform);
};

module.exports = config;
