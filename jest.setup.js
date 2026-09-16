process.env.APP_BRAND = process.env.APP_BRAND || 'symply-budget';

// @config/env pulls in the brand graph at module-init, and a deep import edge
// (useLayoutPadding → SidebarTabBar → aihousekeeper → tasks → api/client → env)
// makes ENV resolve `undefined` under jest's require ordering (Metro handles it
// fine at runtime). Provide a complete, static ENV so every suite loads cleanly.
jest.mock('@config/env', () => {
  const STAGE = 'https://staging.api.test';
  const PROD = 'https://api.test';
  const noClients = { IOS_CLIENT_ID: '', ANDROID_CLIENT_ID: '', WEB_CLIENT_ID: '' };
  return {
    __esModule: true,
    ENV: {
      API_BASE_URL: STAGE,
      IS_PRODUCTION: false,
      API_STAGING_URL: STAGE,
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      GOOGLE_PLACES_API_KEY: '',
      GOOGLE_DRIVE_OAUTH: { ...noClients },
      GOOGLE_AUTH: { ...noClients },
      APP_URL: 'http://localhost:3000',
      APP_NAME: 'Symply House',
      APP_BRAND: process.env.APP_BRAND || 'symply-budget',
      APP_VERSION: '1.0.0',
      BUILD_NUMBER: '1',
      FEATURES: {
        ENABLE_ANALYTICS: false,
        ENABLE_CRASH_REPORTING: false,
        ENABLE_PUSH_NOTIFICATIONS: true,
        ENABLE_BIOMETRIC_AUTH: true,
        ENABLE_DARK_MODE: true,
      },
      TIMEOUTS: { API_REQUEST: 30000, AI_ANALYSIS: 180000, SOCKET_CONNECT: 10000, BACKGROUND_SYNC: 300000 },
      CACHE: { DEFAULT_TTL: 3600000, MAX_AGE: 86400000 },
      REVENUECAT_IOS_API_KEY: '',
      REVENUECAT_ANDROID_API_KEY: '',
      POSTHOG_API_KEY: '',
      POSTHOG_HOST: 'https://us.i.posthog.com',
      POSTHOG_DEV: false,
      SENTRY_DSN: '',
      SENTRY_DEV: false,
    },
    resolveBrandApiUrls: () => ({ staging: STAGE, production: PROD }),
    resolveBuildEnvOverride: () => null,
    HOUSE_STAGING_API_URL: STAGE,
    HOUSE_PRODUCTION_API_URL: PROD,
    BUDGET_STAGING_API_URL: STAGE,
    BUDGET_PRODUCTION_API_URL: PROD,
    KAIZEN_STAGING_API_URL: STAGE,
    KAIZEN_PRODUCTION_API_URL: PROD,
    LANGUAGE_STAGING_API_URL: STAGE,
    LANGUAGE_PRODUCTION_API_URL: PROD,
    HEALTH_STAGING_API_URL: STAGE,
    HEALTH_PRODUCTION_API_URL: PROD,
  };
});
process.env.EXPO_PUBLIC_APP_BRAND =
  process.env.EXPO_PUBLIC_APP_BRAND || process.env.APP_BRAND;

 
// Native-module mocks for Jest. These modules rely on JSI / TurboModules that
// don't exist in the node test environment, so each needs a JS stand-in.

// Gesture handler ships its own jest setup (mocks the native module + handlers).
require('react-native-gesture-handler/jestSetup');

// RNGH's own jestSetup mocks the native module + buttons, but NOT its
// `ScrollView` / `FlatList`. Those mount a real gesture handler whose deferred
// `scheduleFlushOperations` runs on a `setImmediate` that can fire AFTER the
// Jest environment is torn down — at which point RN's lazy `Platform` getter
// throws ("trying to import a file after the Jest environment was torn down").
// Screens use these components only for plain scrolling, so swap them for RN's
// core equivalents in tests. A Proxy preserves every other RNGH export
// (GestureHandlerRootView, Gesture, buttons, …) untouched.
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const RN = require('react-native');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'ScrollView') return RN.ScrollView;
      if (prop === 'FlatList') return RN.FlatList;
      return target[prop];
    },
  });
});

// react-native-gifted-charts — its BarChart/PieChart schedule real setTimeout
// animation ticks that can fire AFTER a test file finishes and crash a LATER
// file ("Cannot read properties of undefined (reading 'timing')"). Charts are
// purely visual, so stub them globally to plain views. Suites that need to
// exercise a chart callback (e.g. PieChart centerLabelComponent) still override
// this with their own jest.mock, which takes precedence.
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stub = (name) => (props) =>
    React.createElement(
      View,
      { testID: name },
      typeof props?.centerLabelComponent === 'function' ? props.centerLabelComponent() : null
    );
  return {
    __esModule: true,
    BarChart: Stub('bar-chart'),
    PieChart: Stub('pie-chart'),
    LineChart: Stub('line-chart'),
    PopulationPyramid: Stub('population-pyramid'),
  };
});

// ActionSheetIOS — the native ActionSheetManager is absent in the test env, so
// the real showActionSheetWithOptions throws "ActionSheetManager doesn't exist"
// the moment a screen opens an action sheet (WishDetail entry menu, SavingsImport,
// ChatRoom, contractors, BudgetPlannedFitCard). Stub it to jest.fn()s so those
// suites are deterministic — previously they only passed when another file's
// ActionSheetIOS mock happened to leak across the shared worker module registry,
// which made whole suites flaky depending on execution order.
jest.mock('react-native/Libraries/ActionSheetIOS/ActionSheetIOS', () => ({
  __esModule: true,
  default: {
    showActionSheetWithOptions: jest.fn(),
    showShareActionSheetWithOptions: jest.fn(),
    dismissActionSheet: jest.fn(),
  },
}));

// AsyncStorage — official in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// react-native-nitro-modules — react-native-mmkv v4's module graph imports this
// eagerly, and its index reaches for the native `NitroModules` TurboModule at
// import time, which does not exist under Jest. Stub it so the import resolves.
// The auto-mocked MMKV instance never actually calls into Nitro (createMMKV
// short-circuits to an in-memory mock in test mode), so a no-op stub is enough.
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => ({})),
    box: jest.fn((value) => value),
    hasNativeState: jest.fn(() => false),
  },
}));

// react-native-mmkv v4 (Nitro) auto-mocks itself in a Jest environment:
// `createMMKV()` detects JEST_WORKER_ID and returns an in-memory instance
// (react-native-mmkv/lib/createMMKV/createMockMMKV), so no manual MMKV mock is
// needed here. Individual tests that must exercise the AsyncStorage fallback
// path mock `createMMKV` to throw locally.

// posthog-react-native — analytics SDK touches native modules on import; the
// app's src/services/analytics.ts wraps it and is a no-op without a key, but any
// suite that transitively imports it needs a stand-in client.
jest.mock('posthog-react-native', () =>
  jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    identify: jest.fn(),
    capture: jest.fn(),
    screen: jest.fn(),
    reset: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }))
);

// @sentry/react-native — crash-reporting SDK touches native modules on import;
// src/services/monitoring.ts wraps it and is a no-op without a DSN, but any suite
// that transitively imports it (e.g. via app/_layout.tsx) needs a stand-in.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: jest.fn((component) => component),
  setUser: jest.fn(),
  setTags: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// expo-audio (SDK 57 replacement for expo-av, not mocked by jest-expo) — its
// native audio recorder/player modules throw on import in the test env. Mirror
// the surface src/services/voice-recording.ts consumes.
jest.mock('expo-audio', () => {
  const makeRecorder = () => ({
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    currentTime: 0,
    isRecording: false,
    uri: 'file:///tmp/recording.m4a',
  });
  const makePlayer = () => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  });
  return {
    __esModule: true,
    AudioModule: { AudioRecorder: jest.fn().mockImplementation(() => makeRecorder()) },
    RecordingPresets: { HIGH_QUALITY: {}, LOW_QUALITY: {} },
    createAudioPlayer: jest.fn(() => makePlayer()),
    requestRecordingPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    useAudioRecorder: jest.fn(() => makeRecorder()),
    useAudioPlayer: jest.fn(() => makePlayer()),
  };
});

// expo-video (SDK 57 replacement for expo-av) — native video view/player absent
// in the test env. Mirror the surface src/screens/.../PersonaWelcomeVideo.tsx uses.
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  const makePlayer = () => ({
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    muted: false,
    loop: false,
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  });
  return {
    __esModule: true,
    VideoView: ({ testID }) => React.createElement(View, { testID: testID || 'video-view' }),
    useVideoPlayer: jest.fn((_source, setup) => {
      const player = makePlayer();
      if (typeof setup === 'function') setup(player);
      return player;
    }),
    createVideoPlayer: jest.fn(() => makePlayer()),
  };
});

// react-native-purchases (RevenueCat) — its dist ships ESM (`export`) that Jest
// can't parse and calls native StoreKit/BillingClient modules absent in the test
// env. Mirror the surface src/services/purchases.ts consumes so app/_layout and
// every suite transitively importing the subscription layer mounts.
jest.mock('react-native-purchases', () => {
  const customerInfo = {
    entitlements: { active: {}, all: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    latestExpirationDate: null,
  };
  const Purchases = {
    setLogLevel: jest.fn(),
    configure: jest.fn(),
    logIn: jest.fn().mockResolvedValue({ customerInfo, created: false }),
    logOut: jest.fn().mockResolvedValue(customerInfo),
    getCustomerInfo: jest.fn().mockResolvedValue(customerInfo),
    getOfferings: jest.fn().mockResolvedValue({ current: null, all: {} }),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo, productIdentifier: 'test.product' }),
    restorePurchases: jest.fn().mockResolvedValue(customerInfo),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  };
  return {
    __esModule: true,
    default: Purchases,
    LOG_LEVEL: { VERBOSE: 'VERBOSE', DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
    PURCHASES_ERROR_CODE: {},
  };
});

// react-native-reanimated (v4) — its worklets runtime calls into a native
// module that throws on import in the test env. The `.native`-stripping resolver
// in jest.config.js lets react-native-worklets load its import-safe fallback;
// this mock then swaps reanimated for its shipped JS mock so any component
// pulling in Animated / useSharedValue / useAnimatedStyle mounts.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// react-native-sortables — builds its gestures on the reanimated WORKLET
// runtime, and the mock above is the plain JS one, which has no
// `isWorkletFunction`. So `Sortable.Grid` throws on render and takes down any
// suite that mounts a draggable list (the project hub's Timeline and Blockers
// tabs, SubtaskList, the widget grid) before it can assert anything.
//
// The stand-in renders the rows in the order it was given and nothing else. It
// deliberately does NOT simulate a drag: a drop driven through this mock would
// prove the mock can reorder an array, which is not a fact about the list. What
// it does buy is every OTHER assertion about those screens — the row content,
// the tap targets, the view-only path — which were untestable while mounting
// threw.
jest.mock('react-native-sortables', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children }) => children ?? null;
  const Grid = ({ data = [], renderItem, keyExtractor }) =>
    React.createElement(
      View,
      null,
      data.map((item, index) =>
        React.createElement(
          View,
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem ? renderItem({ item, index }) : null
        )
      )
    );
  const Sortable = { Grid, Flex: Grid, Handle: Passthrough, Layer: Passthrough };
  return { __esModule: true, default: Sortable, ...Sortable };
});

// @react-navigation/native-stack + drawer — the app's 13 stack navigators call
// `createNativeStackNavigator()` at module top-level, which reaches into
// @react-navigation/native's `createNavigatorFactory`. Any suite that mocks
// @react-navigation/native incompletely (most of them, deliberately) then
// crashes the instant a barrel drags one of those navigators in. Stub the
// factory so a top-level `const Stack = createNativeStackNavigator()` is inert;
// no suite renders a real navigator (screens are tested in isolation).
jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  const Passthrough = ({ children }) => children ?? null;
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: Passthrough,
      Screen: () => null,
      Group: Passthrough,
    }),
  };
});
jest.mock('@react-navigation/drawer', () => {
  const Passthrough = ({ children }) => children ?? null;
  return {
    __esModule: true,
    createDrawerNavigator: () => ({
      Navigator: Passthrough,
      Screen: () => null,
      Group: Passthrough,
    }),
    useDrawerStatus: () => 'closed',
  };
});

// expo-router — needs its own navigation runtime that doesn't exist when a
// component tree is rendered in isolation. Stub the surface so screens/layouts
// mount (exercising the provider tree) without the real router.
jest.mock('expo-router', () => {
  const React = require('react');
  const Passthrough = ({ children }) => children ?? null;
  return {
    Slot: () => null,
    Stack: Object.assign(() => null, { Screen: () => null }),
    Tabs: Object.assign(() => null, { Screen: () => null }),
    SplashScreen: { preventAutoHideAsync: jest.fn(), hideAsync: jest.fn(), setOptions: jest.fn() },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn() }),
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
    useFocusEffect: () => {},
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
    Link: Passthrough,
    Redirect: () => null,
  };
});

// @services/navigation — its module top-level calls `createNavigationContainerRef`
// (from expo-router/react-navigation) at import time, which throws whenever a
// suite mocks @react-navigation/native incompletely. Components only ever pull
// the imperative `navigate*` helpers from it, and no suite asserts on real
// cross-stack navigation (the one that does — TaskFormBody — mocks it locally,
// which overrides this). Stub the whole surface so the heavy navigation graph
// never executes native container wiring.
jest.mock('@services/navigation', () => {
  const noop = () => jest.fn();
  return {
    __esModule: true,
    navigationRef: {
      isReady: () => false,
      navigate: jest.fn(),
      goBack: jest.fn(),
      current: null,
      getCurrentRoute: () => undefined,
      resetRoot: jest.fn(),
    },
    navigate: jest.fn(),
    navigateToReport: jest.fn(),
    navigateToTask: jest.fn(),
    navigateToGardening: jest.fn(),
    navigateToGarbageCollection: jest.fn(),
    navigateToBudget: jest.fn(),
    navigateToBudgetInvite: jest.fn(),
    // House's own enrolment hub, and its Join screen with a tapped invite in
    // hand — the two the invite notifications and the invite deep link use.
    navigateToHouseInvite: jest.fn(),
    navigateToHouseJoin: jest.fn(),
    // House's own enrolment hub, and its Join screen with a tapped invite in
    // hand — the two the invite notifications and the invite deep link use.
    navigateToHouseInvite: jest.fn(),
    navigateToHouseJoin: jest.fn(),
    navigateToTaskDrafts: jest.fn(),
    navigateToTaskDraftDetail: jest.fn(),
    navigateToMaintenanceSetup: jest.fn(),
    navigateToHouseholdMembers: jest.fn(),
    navigateToSpacesManagement: jest.fn(),
    navigateToFloorPlanPicker: jest.fn(),
    navigateToHouseholds: jest.fn(),
    navigateToAcceptInvite: jest.fn(),
    navigateToScheduleTask: jest.fn(),
    navigateToCopyFromExistingTasks: jest.fn(),
    navigateToTaskTemplates: jest.fn(),
    // Forward-compat: any not-yet-listed helper resolves to a no-op factory.
    __noop: noop,
  };
});

// Voice / realtime stack (WebRTC) — native modules absent in test env.
jest.mock('react-native-incall-manager', () => ({
  __esModule: true,
  default: { start: jest.fn(), stop: jest.fn(), setForceSpeakerphoneOn: jest.fn(), setSpeakerphoneOn: jest.fn() },
}));
jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: jest.fn().mockImplementation(() => ({
    createOffer: jest.fn().mockResolvedValue({}),
    setLocalDescription: jest.fn().mockResolvedValue(undefined),
    setRemoteDescription: jest.fn().mockResolvedValue(undefined),
    addTrack: jest.fn(),
    close: jest.fn(),
    createDataChannel: jest.fn(() => ({ send: jest.fn(), close: jest.fn() })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
  RTCSessionDescription: jest.fn(),
  RTCIceCandidate: jest.fn(),
  MediaStream: jest.fn(),
  mediaDevices: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [] }) },
}));

// expo-notifications — native event emitter is null in tests.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({ data: 'devtoken' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  getPresentedNotificationsAsync: jest.fn().mockResolvedValue([]),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
}));

// expo-glass-effect — SDK 54 native view module, not mocked by jest-expo.
jest.mock('expo-glass-effect', () => ({
  GlassView: 'GlassView',
  isLiquidGlassAvailable: () => false,
}));

// react-native-blob-util (transitive via react-native-pdf) — NativeEventEmitter throws.
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: { DocumentDir: '/tmp', CacheDir: '/tmp', MainBundleDir: '/tmp' },
      exists: jest.fn().mockResolvedValue(false),
      unlink: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(''),
    },
    config: jest.fn(() => ({ fetch: jest.fn().mockResolvedValue({ path: () => '/tmp/f', info: () => ({ status: 200 }) }) })),
  },
}));

// react-native-fs — native file system; stub the surface the app uses.
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  CachesDirectoryPath: '/tmp',
  TemporaryDirectoryPath: '/tmp',
  mkdir: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn().mockResolvedValue(false),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  unlink: jest.fn().mockResolvedValue(undefined),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve({ statusCode: 200 }) })),
}));

// NetInfo — the real module reaches for native reachability state that does
// not exist under Jest (`internetReachability.ts` throws on an undefined
// native emitter). Suites that assert connectivity transitions override this
// with their own jest.mock, which takes precedence (see useNetworkStatus.test.tsx).
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

// safe-area-context — use its bundled mock when present, else a minimal stub.
jest.mock('react-native-safe-area-context', () => {
  try {
    return require('react-native-safe-area-context/jest/mock').default;
  } catch (e) {
    const React = require('react');
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };
    const frame = { width: 390, height: 844, x: 0, y: 0 };
    return {
      SafeAreaProvider: ({ children }) => children,
      SafeAreaConsumer: ({ children }) => children(inset),
      SafeAreaView: ({ children }) => children,
      useSafeAreaInsets: () => inset,
      useSafeAreaFrame: () => frame,
      SafeAreaInsetsContext: React.createContext(inset),
      initialWindowMetrics: { insets: inset, frame },
    };
  }
});

// AI Access Migration — screens wrap AI surfaces in AIAccessGate / useRequireAIAccess.
// Those hooks need QueryClient + feature flags; unit tests render screens in isolation.
// Passthrough mocks keep entitlement gating out of component unit tests (covered by
// dedicated entitlement / feature-flag suites and Maestro E2E).
jest.mock('@components/ai/AIAccessGate', () => {
  const React = require('react');
  return {
    __esModule: true,
    AIAccessGate: ({ children }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock('@hooks/useRequireAIAccess', () => ({
  useRequireAIAccess: () => ({
    canUseAI: true,
    isPaid: true,
    isLoading: false,
    aiFeaturesEnabled: true,
    subscriptionsEnabled: true,
    bringYourOwnAIEnabled: true,
    denialReason: null,
    ensureCanUseAI: () => true,
    refetch: jest.fn(),
    invalidate: jest.fn(),
  }),
}));

jest.mock('@hooks/useAIEntitlement', () => ({
  useAIEntitlement: () => ({
    canUseAI: true,
    isPaid: true,
    isLoading: false,
    aiFeaturesEnabled: true,
    subscriptionsEnabled: true,
    bringYourOwnAIEnabled: true,
    denialReason: null,
    source: 'simplehouse',
    provider: 'anthropic',
    selectedModelId: null,
    availableModels: [],
    hasBYOKAccess: false,
    refetch: jest.fn(),
    invalidate: jest.fn(),
  }),
}));
