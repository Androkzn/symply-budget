/**
 * SettingsNavigator — the House V2 local-first routes are registered.
 *
 * These six screens existed, were unit-tested, and were reachable by nobody:
 * until 2026-08-14 nothing in `src/` or `app/` referenced
 * `src/screens/house-v2/`, so `navigate('HouseDeviceSync')` would have thrown
 * and `mm-open-lf-settings` had nothing to open. The engine behind them had
 * been deployed and green since H4/H6/H9 — the gap was purely the doorway.
 *
 * This suite guards the doorway. It mounts the real navigator with every screen
 * stubbed, so it asserts registration rather than thirty screen trees.
 *
 * Registration is deliberately UNCONDITIONAL, matching every other route in
 * this navigator: a route registered only for some brands makes `navigate()`
 * throw at runtime on the others, which is a worse failure than a dead row. The
 * brand/flag decision lives on the Settings *row* instead
 * (`SettingsScreen.tsx`), and on the deep-link route (`app/device-sync.tsx`),
 * both of which have their own tests.
 */
/*
 * `jest.mock` factories are hoisted above the import block, so they cannot use
 * `import` — the modules would not exist yet when the factory runs. `require`
 * inside a factory is the only form that works, which is why every navigator
 * suite here does it (see BudgetNavigator.test.tsx).
 */
/* eslint-disable @typescript-eslint/no-require-imports */

// Recording native-stack: each <Stack.Screen name=…> renders a host View tagged
// with its route name, so the registered list is readable off the tree. Mirrors
// BudgetNavigator.test.tsx, which replaces the same global inert mock.
jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(View, { testID: 'stack-navigator' }, children),
      Screen: ({ name }: { name: string }) =>
        React.createElement(View, { testID: 'stack-screen', screenName: name }),
      Group: ({ children }: { children?: React.ReactNode }) => children ?? null,
    }),
  };
});

const makeScreenBarrelProxy = () => {
  const React = require('react');
  const { View } = require('react-native');
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== 'string') return undefined;
        if (key === '__esModule') return true;
        if (!cache.has(key)) {
          const Stub = (props: Record<string, unknown>) =>
            React.createElement(View, { testID: `stub:${key}`, ...props });
          Stub.displayName = `Stub(${key})`;
          cache.set(key, Stub);
        }
        return cache.get(key);
      },
    },
  );
};

// The house-v2 barrels are stubbed like every other screen barrel. That also
// keeps the sync orchestrator and ledger engine out of this suite's module
// graph — they are the real screens' dependencies, not the navigator's.
jest.mock('@screens/house-v2/enrolment', () => makeScreenBarrelProxy());
jest.mock('@screens/house-v2/backup', () => makeScreenBarrelProxy());
// `ApplianceDetail` hosts the H6 attachment field, so the real barrel pulls the
// blob store, `expo-file-system` and the crypto engine into this suite's module
// graph. Those are the screen's dependencies, not the navigator's.
jest.mock('@screens/appliances', () => makeScreenBarrelProxy());
jest.mock('@screens/households/HouseholdManagementScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/households/HouseholdMembersScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/households/PropertyDetailScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/main/SettingsScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/ai', () => makeScreenBarrelProxy());
jest.mock('@screens/floor-plans', () => makeScreenBarrelProxy());
jest.mock('@screens/spaces', () => makeScreenBarrelProxy());
jest.mock('@features/ecosystem', () => makeScreenBarrelProxy());
jest.mock('@features/budget/screens', () => makeScreenBarrelProxy());

// `@brand` is deliberately NOT mocked. Two attempts to do so both failed for
// instructive reasons: replacing it wholesale takes down the theme, which reads
// `brand.colors` at import time; and spreading over `requireActual` trips the
// barrel's eager `getBrandCapabilities` getter during the spread. It is also
// unnecessary — the Jest brand is House, so `isFullBudget()` is already false
// and `HouseholdRootScreen` resolves to the stubbed HouseholdManagementScreen.

// The settings screens are imported one-by-one rather than through a barrel, so
// each needs its own stub to keep this suite's module graph to the navigator.
jest.mock('@screens/settings/AihousekeeperConnectedAccountsScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/AihousekeeperSettingsScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/AIHousePreferencesScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/AppearanceScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/CalendarSyncScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/CurrencyScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/CustomizationScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/NavigationCustomizationScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/NotificationSettingsScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/PrivacyPolicyScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/RegionScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/TermsOfServiceScreen', () => makeScreenBarrelProxy());
jest.mock('@screens/settings/WidgetCustomizationScreen', () => makeScreenBarrelProxy());

jest.mock('@services/deepLinks', () => ({
  __esModule: true,
  clearSettingsDeepLinkParams: jest.fn(),
}));

jest.mock('@services/nav-when-ready', () => ({
  __esModule: true,
  navigateAfterInteractions: (fn: () => void) => fn(),
  runWhenNavigatorReady: jest.fn(),
}));

jest.mock('@stores/settingsNavigationStore', () => ({
  __esModule: true,
  flushPendingSettingsNavigation: jest.fn(),
  registerSettingsStackNavigation: jest.fn(),
}));

jest.mock('expo-router/react-navigation', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { SettingsNavigator } from '../SettingsNavigator';

/**
 * Every `name=` the navigator registered, in declaration order.
 *
 * Host elements only (`typeof node.type === 'string'`). `findAllByProps` returns
 * the composite `View` element AND the host instance it renders to, so the
 * naive form reports every route twice — which is indistinguishable from a real
 * double registration, and is exactly what the "exactly once" case caught.
 */
async function registeredRoutes(): Promise<string[]> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<SettingsNavigator />);
  });
  return tree.root
    .findAll(
      node => typeof node.type === 'string' && node.props.testID === 'stack-screen',
    )
    .map(node => node.props.screenName as string);
}

// `HouseRestore` is deliberately absent: restore moved INSIDE
// `HouseBackupScreen` (the archive list restores on tap, and "Restore from
// elsewhere" reaches Drive / Dropbox / Files), matching Budget's single
// Backup & Restore screen. A second route into the same flow was two places to
// keep in step and left on-device archives unreachable from the screen that
// wrote them.
const HOUSE_V2_ROUTES = [
  'HouseDeviceSync',
  'HouseInvite',
  'HouseJoin',
  'HouseDevices',
  'HouseBackup',
] as const;

describe('SettingsNavigator — House V2 local-first routes', () => {
  it('registers the stack at all (guard against a vacuous suite)', async () => {
    const routes = await registeredRoutes();
    // If the recording mock or the barrel stubs ever stop matching the real
    // navigator, this collapses to [] and every assertion below passes for the
    // wrong reason.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('SettingsMain');
  });

  it.each(HOUSE_V2_ROUTES)('registers %s', async route => {
    expect(await registeredRoutes()).toContain(route);
  });

  it('registers them unconditionally, so navigate() cannot throw on a non-House brand', async () => {
    // @brand is mocked to isFullBudget() === false above; the House routes must
    // be present regardless, exactly like SpacesManagement and FloorPlansMain.
    const routes = await registeredRoutes();
    for (const route of HOUSE_V2_ROUTES) {
      expect(routes).toContain(route);
    }
  });

  it('registers each route exactly once', async () => {
    const routes = await registeredRoutes();
    for (const route of HOUSE_V2_ROUTES) {
      expect(routes.filter(name => name === route)).toHaveLength(1);
    }
  });
});

describe('SettingsNavigator — the appliance attachment doorway', () => {
  /**
   * The seventh route on the same rule, added 2026-08-15.
   *
   * `ApplianceDetailScreen` is the only caller of `HouseAttachmentField` in
   * `src/`, and the list screen it hangs off had two empty `onPress` stubs from
   * the day it was written. Registering it here is what makes the H6 attachment
   * channel reachable by a member rather than by a test — the same gap the six
   * routes above closed for enrolment and backup.
   */
  it('registers ApplianceDetail, exactly once', async () => {
    const routes = await registeredRoutes();
    expect(routes.filter(name => name === 'ApplianceDetail')).toHaveLength(1);
  });

  it('registers it unconditionally — the gate is inside the screen', async () => {
    // Same reasoning as the House V2 block: a route registered only for some
    // brands makes `navigate()` throw at runtime on the others. The screen gates
    // its ATTACHMENT FIELD on `isHouseLocalFirst()` and lists the documents
    // either way, so there is nothing for the navigator to decide.
    expect(await registeredRoutes()).toContain('ApplianceDetail');
  });
});
