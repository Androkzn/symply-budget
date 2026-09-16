/**
 * @format
 *
 * Smoke test for the app's root layout. The runtime entry is
 * `expo-router/entry`, which mounts `app/_layout.tsx`. The legacy
 * `src/App.tsx` was removed when notification handling was migrated
 * into `useNotificationHandler` — this test now exercises the new
 * root.
 *
 * Scope: this verifies the provider composition (GestureHandler →
 * SafeArea → QueryClient → Theme → I18n → Profile → Subscription →
 * Data → TapOutside) mounts without throwing. The navigation trees
 * (`RootNavigator` for the auth flow, expo-router `<Slot />` for the
 * authenticated shell) require a navigation runtime that doesn't exist
 * in isolation, so they're stubbed here — they have their own coverage,
 * and exercising real navigation is an e2e concern.
 */

// expo-router's <Slot/> is stubbed globally in jest.setup.js. RootNavigator
// (React Navigation) needs a NavigationContainer the router normally provides,
// so stub it for this isolated render.
// `usePropertyAddressCaptureGate` too: `_layout.tsx` calls it directly, because
// the mount decision is made there rather than inside the navigator. A stub that
// only supplies `RootNavigator` makes the render throw before anything is
// asserted, which is how this test broke when the gate landed.
jest.mock('@navigation/RootNavigator', () => ({
  RootNavigator: () => null,
  usePropertyAddressCaptureGate: () => false,
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import RootLayout from '../app/_layout';

test('renders correctly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<RootLayout />);
  });
  expect(tree).toBeDefined();
});
