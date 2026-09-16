/**
 * KaizenScreen (`common.tsx`) — the shared Symply Kaizen screen scaffold that
 * every Kaizen screen renders through. These tests lock in the contract the
 * whole app depends on:
 *   1. content is always inside a scroll container (every screen is scrollable);
 *   2. the back button is actually wired (ScreenHeader needs an `onBackPress`,
 *      so a back button must hand it one — defaulting to `router.back`);
 *   3. the large body heading is suppressed when the header carries the title,
 *      so the title is not duplicated (the "Profile / Profile" bug);
 *   4. `variant` controls the header: `detail` (default) → standard centered
 *      header title + back button, no body hero; `root` (tab dashboards) →
 *      title-less home header + the large in-body hero heading.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { allText, expectScrollableScreen, hasTestId } from '../../test-utils/kaizenScreenTestKit';
import { KAIZEN_SCREEN_SCROLL_TEST_ID, KaizenScreen } from '../common';

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
    navigate: jest.fn(),
  },
}));

// Capture the props KaizenScreen hands the (shared) header without dragging in
// the real header's native chrome (blur / glass / avatar context).
let headerProps: Record<string, unknown> = {};
jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ScreenHeader: (props: Record<string, unknown>) => {
      headerProps = props;
      return ReactMock.createElement(View, { testID: 'screen-header' });
    },
    ScreenScrollEnd: ({ testID }: { testID: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('@features/kaizen/brand', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    BrandBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'brand-bg' }, children),
    GlassCard: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, null, children),
  };
});

async function render(ui: React.ReactElement): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{ui}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  headerProps = {};
});

describe('KaizenScreen scaffold', () => {
  it('always renders its content inside a scroll container', async () => {
    const tree = await render(
      <KaizenScreen title="Systems">
        <Text>body</Text>
      </KaizenScreen>,
    );
    expect(hasTestId(tree, 'kaizen-screen-scroll')).toBe(true);
    expect(hasTestId(tree, KAIZEN_SCREEN_SCROLL_TEST_ID)).toBe(true);
    expectScrollableScreen(tree, KAIZEN_SCREEN_SCROLL_TEST_ID);
  });

  it('root variant shows the large body hero heading and no header title', async () => {
    const tree = await render(
      <KaizenScreen variant="root" title="Systems">
        <Text>body</Text>
      </KaizenScreen>,
    );
    // The hero title lives in the body; the home-variant header carries none.
    expect(allText(tree.toJSON())).toContain('Systems');
    expect(headerProps.title).toBeUndefined();
  });

  it('detail variant (default) moves the title into the centered header', async () => {
    const tree = await render(
      <KaizenScreen title="Skill detail">
        <Text>body</Text>
      </KaizenScreen>,
    );
    // The mocked header renders no text, so the title must NOT survive in the
    // body — it has moved to the centered header title.
    expect(allText(tree.toJSON())).not.toContain('Skill detail');
    expect(headerProps.title).toBe('Skill detail');
  });

  it('detail variant hides the tab dashboard bell + avatar for a clean header', async () => {
    await render(
      <KaizenScreen title="Skill detail">
        <Text>body</Text>
      </KaizenScreen>,
    );
    expect(headerProps.showNotificationBell).toBe(false);
    expect(headerProps.showAvatar).toBe(false);
  });

  it('suppresses the duplicate body title when a sticky header title is set', async () => {
    const tree = await render(
      <KaizenScreen title="Profile" headerTitle="Profile">
        <Text>body</Text>
      </KaizenScreen>,
    );
    // Header (mocked) renders no text, so "Profile" must NOT survive in the body.
    expect(allText(tree.toJSON())).not.toContain('Profile');
    // ...it moved to the sticky header instead.
    expect(headerProps.title).toBe('Profile');
  });

  it('keeps the subtitle even when the body heading is suppressed', async () => {
    const tree = await render(
      <KaizenScreen title="Profile" headerTitle="Profile" subtitle="Your account.">
        <Text>body</Text>
      </KaizenScreen>,
    );
    expect(allText(tree.toJSON())).toContain('Your account.');
  });

  it('detail variant wires a working back handler by default', async () => {
    await render(
      <KaizenScreen title="Settings">
        <Text>body</Text>
      </KaizenScreen>,
    );
    expect(headerProps.showBackButton).toBe(true);
    expect(typeof headerProps.onBackPress).toBe('function');
    (headerProps.onBackPress as () => void)();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('prefers a custom onBackPress over router.back', async () => {
    const custom = jest.fn();
    await render(
      <KaizenScreen title="Settings" onBackPress={custom}>
        <Text>body</Text>
      </KaizenScreen>,
    );
    (headerProps.onBackPress as () => void)();
    expect(custom).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('does not hand the header a back handler on tab roots (variant="root")', async () => {
    await render(
      <KaizenScreen variant="root" title="Today">
        <Text>body</Text>
      </KaizenScreen>,
    );
    expect(headerProps.showBackButton).toBe(false);
    expect(headerProps.onBackPress).toBeUndefined();
  });
});
