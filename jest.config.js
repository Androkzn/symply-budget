const expoPreset = require('jest-expo/jest-preset');

// Start from jest-expo's comprehensive transformIgnorePatterns (covers the
// whole react-native / expo / react-navigation ecosystem) and additionally
// let `immer` / `zustand` through Babel — they ship ESM (`export {}`) Jest
// can't parse raw. `react-native-qrcode-svg` ships untranspiled ESM + JSX
// (`export { default } from './src/index.js'`) for the same reason: Metro
// transforms it, Jest will not unless it is listed here. Building from the
// preset array (rather than replacing it) keeps the preset's coverage intact
// across jest-expo upgrades.
const transformIgnorePatterns = expoPreset.transformIgnorePatterns.map((p) =>
  p.includes('react-native|@react-native')
    ? p.replace(
        /\)\)$/,
        '|immer|zustand|uuid|react-native-gifted-charts|gifted-charts-core|react-native-qrcode-svg))'
      )
    : p
);

module.exports = {
  // Expo SDK 54 app — jest-expo sets up babel-preset-expo, EXPO_OS inlining,
  // and the expo-modules-core / native-module mocks the plain react-native
  // preset lacks (which broke any suite importing expo-router/expo-linking).
  preset: 'jest-expo',
  // Jest's 5s default is a per-test SAFETY NET, not an assertion, and on a
  // 12-core box the full run fans out to ~11 workers — enough contention that
  // heavy screen renders (HealthVitalityScreen's seven issue rows,
  // WishDetailScreen's load-error path) blow through 5s and fail the whole
  // suite while passing in isolation. Raise it so a red run means a real
  // defect; a genuinely hung test still trips this well before CI gives up.
  testTimeout: 20_000,
  // Backend Workers use their own runners; exclude them from the RN Jest run.
  // `backend/` runs on Vitest; `backend-language/` (consolidated Language Worker)
  // runs on Node's `tsx --test` (node:test) with ESM `.js` imports — both are
  // incompatible with the RN Jest environment and must not be swept up here.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/backend/',
    '<rootDir>/backend-language/',
    '<rootDir>/packages/',
    // Isolated agent checkouts (`Agent({ isolation: 'worktree' })`) live under
    // here as full repo copies, each with its own node_modules/lockfile. Left
    // unexcluded, Jest treats every one of them as a parallel copy of this
    // whole suite — thousands of duplicate (and often stale, pre-fix) test
    // runs racing the real ones on shared native mocks.
    '<rootDir>/.claude/worktrees/',
  ],
  // Only treat *.test.* / *.spec.* as suites. jest-expo's default also runs
  // every file under __tests__/, which wrongly picks up shared helper modules
  // (e.g. kaizenScreenTestKit.tsx) that contain no `it()` and fail with
  // "Your test suite must contain at least one test."
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns,
  // Resolve TS before CJS so extension-less brand imports (e.g. brands/index.ts →
  // `from './symply-house/brand'`) hit brand.ts (which re-exports the typed pack)
  // rather than brand.cjs (raw config, no `brand` named export). Jest's default
  // order puts `cjs` ahead of `ts`, which silently made `brand` undefined and
  // broke every suite importing the theme/brand/api layer. Explicit `.cjs`
  // requires still resolve correctly.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'cjs', 'node'],
  // react-native-worklets (pulled in by reanimated v4) resolves a native-only
  // TurboModule (`NativeWorklets.native.ts`) that throws on import under Jest.
  // The library ships a resolver that strips `.native` extensions so its
  // import-safe `NativeWorklets.ts` fallback is used instead.
  resolver: '<rootDir>/node_modules/react-native-worklets/jest/resolver.js',
  moduleNameMapper: {
    // Preserve jest-expo's alias map (@api, @components, @brand, @screens, …);
    // a bare `moduleNameMapper` here would REPLACE the preset's, not merge.
    ...expoPreset.moduleNameMapper,
    '^@symply/contracts$': '<rootDir>/packages/contracts/src/index.ts',
    '^@symply/contracts/(.*)$': '<rootDir>/packages/contracts/src/$1',
    // Screens import the navigation hooks from `expo-router/react-navigation`
    // (expo-router's re-export of @react-navigation/native). The whole codebase
    // only pulls useNavigation/useRoute/useFocusEffect + type-only RouteProp /
    // CompositeNavigationProp from that path — all present on the native pkg —
    // so redirect it so per-test `jest.mock('@react-navigation/native', …)`
    // stubs actually intercept the components' navigation calls.
    '^expo-router/react-navigation$': '@react-navigation/native',
    '.*/assets/e2e/kaizen/.*': '<rootDir>/src/test-utils/e2eAssetMock.js',
  },
};
