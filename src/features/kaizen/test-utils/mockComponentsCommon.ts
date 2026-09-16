/**
 * Shared @components/common stub for Kaizen screen tests.
 * Use inside jest.mock('@components/common', () => createKaizenComponentsCommonMock())
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted */

import type { ReactNode } from 'react';

export function createKaizenComponentsCommonMock(): Record<string, unknown> {
  const R = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    __esModule: true,
    // Passthrough — screens using the shared Budget/House-pattern layout
    // (e.g. Kaizen's SettingsScreen) wrap their content in this; tests never
    // assert on the gradient itself.
    AppBackground: ({ children }: { children?: ReactNode }) =>
      R.createElement(View, { testID: 'app-background' }, children),
    // Render the header `title` (detail screens now surface their screen title
    // in the centered header rather than a large in-body heading), so text
    // assertions still find it wherever the screen chose to place it.
    ScreenHeader: ({ title }: { title?: string }) =>
      R.createElement(
        View,
        { testID: 'screen-header' },
        title ? R.createElement(Text, null, title) : null,
      ),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      R.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    // Purely decorative (blur + gradient backdrop for a floating footer) —
    // a no-op stub is faithful enough for screen tests, which never assert
    // on it directly.
    ScreenFooterGlass: () => R.createElement(View, { testID: 'screen-footer-glass' }),
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    // Faithful enough to the real component (src/components/common/PermissionCard.tsx)
    // for text/testID assertions: title + the copy for the current state, plus a
    // `-request` button in `not-requested` and a `-settings` button in `denied`.
    PermissionCard: ({
      state,
      title,
      copy,
      onRequest,
      onOpenSettings,
      busy,
      testID = 'permission-card',
    }: {
      state: string;
      title: string;
      copy: Record<string, { body: string } | undefined>;
      onRequest?: () => void;
      onOpenSettings?: () => void;
      busy?: boolean;
      testID?: string;
    }) =>
      R.createElement(
        View,
        { testID },
        R.createElement(Text, null, title),
        R.createElement(Text, null, copy[state]?.body ?? ''),
        state === 'not-requested' && onRequest
          ? R.createElement(
              Pressable,
              { testID: `${testID}-request`, onPress: onRequest, disabled: busy },
              R.createElement(Text, null, busy ? 'Requesting…' : 'Allow'),
            )
          : null,
        state === 'denied' && onOpenSettings
          ? R.createElement(
              Pressable,
              { testID: `${testID}-settings`, onPress: onOpenSettings },
              R.createElement(Text, null, 'Open Settings'),
            )
          : null,
      ),
  };
}
