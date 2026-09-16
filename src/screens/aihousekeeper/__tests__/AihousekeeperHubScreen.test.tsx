/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * AihousekeeperHubScreen — landing tab for the AI Housekeeper (Mira).
 *
 * Covers the hero briefing card (loading / empty / composed + tap-to-open), the
 * primary action grid (Chat / Approvals / Trust ledger / Briefings / Settings)
 * and its live badges, the conditional Followups card, the "select a household"
 * empty state, and that everything lays out on iPhone AND iPad (AdaptiveContainer
 * caps width at 720 on tablets). Navigation goes through the expo-router
 * `useRouter().push(<route>)`, which every card asserts against.
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Stable router so card taps can be asserted (overrides jest.setup's fresh-per-call stub).
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
}));

// Household selection drives `hid`; a null household triggers the empty state.
const mockHouseholdState: { currentHousehold: { id: string } | null } = {
  currentHousehold: { id: 'hh_hub_1' },
};
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: Object.assign(
    (selector?: (s: typeof mockHouseholdState) => unknown) =>
      typeof selector === 'function' ? selector(mockHouseholdState) : mockHouseholdState,
    { getState: () => mockHouseholdState, setState: jest.fn(), subscribe: jest.fn() }
  ),
}));

// Persona name is woven through the hero + card copy; pin it to "Mira".
jest.mock('@hooks/useAihousekeeperPersona', () => ({
  useAihousekeeperPersona: () => ({
    name: 'Mira',
    persona: { displayName: 'Mira', fallbackEmoji: '🐱', image: null },
  }),
}));

// React Query drives the badges + briefing preview. Mock useQuery so each of the
// three queries returns controllable state keyed by queryKey[1] — no async, no
// QueryClientProvider needed, and every corner case is deterministic.
const mockQueryState: Record<string, { data: unknown; isLoading: boolean }> = {
  briefings: { data: undefined, isLoading: false },
  approvals: { data: undefined, isLoading: false },
  followups: { data: undefined, isLoading: false },
};
jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: jest.fn((opts: { queryKey?: unknown[] }) => {
      const kind = String(opts?.queryKey?.[1] ?? '');
      return mockQueryState[kind] ?? { data: undefined, isLoading: false };
    }),
  };
});

// The api is never actually hit (useQuery is mocked) but the screen imports it.
jest.mock('@api/aihousekeeper', () => ({
  __esModule: true,
  aihousekeeperApi: {
    listBriefings: jest.fn(),
    listApprovals: jest.fn(),
    listFollowups: jest.fn(),
  },
}));

// Stub the chrome from @components/common (AppBackground / ScreenHeader). The real
// ScreenHeader pulls in ProfileProvider + notification wiring not under test here.
// AdaptiveContainer (@components/layout), Card + Typography (@components/ui) stay
// REAL so the iPad width-cap and the tap assertions exercise real behaviour.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'app-background' }, children ?? null),
    ScreenHeader: ({ title }: { title?: string }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(Text, { testID: 'screen-header-title' }, title ?? '')
      ),
  };
});

// PersonaAvatar renders artwork/emoji — not the subject; stub to a marker view.
jest.mock('@components/aihousekeeper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    PersonaAvatar: () => React.createElement(View, { testID: 'persona-avatar' }),
  };
});

import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { AihousekeeperHubScreen } from '@screens/aihousekeeper/AihousekeeperHubScreen';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  pressables,
  renderOnDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const TODAY = new Date().toISOString().slice(0, 10);

/** Every string/number fragment in a subtree, flattened (Typography often
 *  renders `{expr} literal` as an ARRAY child, so string-only walks miss it). */
function instanceText(node: ReactTestInstance): string {
  const out: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === 'string' || typeof x === 'number') out.push(String(x));
  };
  node.findAll(() => true, { deep: true }).forEach((n) => {
    const c = n.props?.children;
    if (Array.isArray(c)) c.forEach(push);
    else push(c);
  });
  return out.join(' ');
}

/** First pressable whose rendered subtree contains `text`. */
function pressableWithText(
  r: ReturnType<typeof renderOnDevice>,
  text: string
): ReactTestInstance | undefined {
  return pressables(r).find((n) => {
    try {
      return instanceText(n).includes(text);
    } catch {
      return false;
    }
  });
}

beforeEach(() => {
  mockRouter.push.mockClear();
  mockHouseholdState.currentHousehold = { id: 'hh_hub_1' };
  mockQueryState.briefings = { data: undefined, isLoading: false };
  mockQueryState.approvals = { data: undefined, isLoading: false };
  mockQueryState.followups = { data: undefined, isLoading: false };
});

describe('AihousekeeperHubScreen — layout', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'renders the hub header + all primary cards on %s',
    (device) => {
      const r = renderOnDevice(device, <AihousekeeperHubScreen />);
      const text = treeText(r);
      expect(r.root.findByProps({ testID: 'screen-header-title' }).props.children).toBe(
        'AI Housekeeper'
      );
      expect(text).toContain('Chat with Mira');
      expect(text).toContain('Approvals');
      expect(text).toContain('Trust ledger');
      expect(text).toContain('Briefings');
      expect(text).toContain('Settings');
    }
  );

  it('caps content width at 720 on iPad but not on iPhone', () => {
    const has720 = (device: DeviceName) =>
      renderOnDevice(device, <AihousekeeperHubScreen />)
        .root.findAll((n) => n.props?.maxWidth === 720).length > 0;
    expect(has720('iPad Pro 11 (portrait)')).toBe(true);
    expect(has720('iPhone 14 Pro')).toBe(false);
  });
});

describe('AihousekeeperHubScreen — navigation', () => {
  const cases: Array<[string, string]> = [
    ['Chat with Mira', '/aihousekeeper-chat'],
    ['Approvals', '/aihousekeeper-approvals'],
    ['Trust ledger', '/aihousekeeper-trust-ledger'],
    ['Briefings', '/aihousekeeper-briefings'],
    ['Settings', '/aihousekeeper-settings'],
  ];

  it.each(cases)('navigates from the "%s" card to %s (iPhone)', (label, route) => {
    const r = renderOnDevice('iPhone 14 Pro', <AihousekeeperHubScreen />);
    const card = pressableWithText(r, label);
    expect(card).toBeTruthy();
    card!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith(route);
  });

  it.each(cases)('navigates from the "%s" card to %s (iPad)', (label, route) => {
    const r = renderOnDevice('iPad Pro 11 (portrait)', <AihousekeeperHubScreen />);
    const card = pressableWithText(r, label);
    expect(card).toBeTruthy();
    card!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith(route);
  });
});

describe('AihousekeeperHubScreen — briefing hero (corner cases)', () => {
  it('shows a loading indicator in the hero while the briefing is fetching', () => {
    mockQueryState.briefings = { data: undefined, isLoading: true };
    const r = renderOnDevice('iPhone 14 Pro', <AihousekeeperHubScreen />);
    const spinners = r.root.findAllByType(ActivityIndicator);
    expect(spinners.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the "not composed yet" hero copy when there is no briefing', () => {
    const r = renderOnDevice('iPad mini (portrait)', <AihousekeeperHubScreen />);
    const text = treeText(r);
    expect(text).toContain("hasn't composed a briefing yet");
    expect(text).not.toContain('Tap to open');
  });

  it('renders a composed briefing preview and navigates to /briefing/<date> when tapped', () => {
    mockQueryState.briefings = {
      isLoading: false,
      data: {
        briefings: [
          {
            date: TODAY,
            paragraph: 'Two things need your attention around the home today.',
            bullets: ['Change the furnace filter', 'Book water-heater service'],
          },
        ],
      },
    };
    const r = renderOnDevice('iPhone 14 Pro', <AihousekeeperHubScreen />);
    const text = treeText(r);
    expect(text).toContain('Two things need your attention');
    expect(text).toContain('Tap to open');
    // The count line renders as split children (["2", " action item", "s"]).
    expect(text).toContain('action item');

    const hero = pressableWithText(r, "TODAY'S BRIEFING");
    expect(hero).toBeTruthy();
    hero!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith(`/briefing/${TODAY}`);
  });

  it('does not navigate when the passive (no-briefing) hero is tapped', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AihousekeeperHubScreen />);
    const hero = pressableWithText(r, "TODAY'S BRIEFING");
    expect(hero).toBeTruthy();
    expect(hero!.props.disabled).toBe(true);
    hero!.props.onPress();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('AihousekeeperHubScreen — badges & conditional cards', () => {
  it('surfaces the pending-approvals count + badge and navigates to approvals', () => {
    mockQueryState.approvals = {
      isLoading: false,
      data: { approvals: [{}, {}, {}] },
    };
    const r = renderOnDevice('iPhone 14 Pro', <AihousekeeperHubScreen />);
    const text = treeText(r);
    expect(text).toContain('3 pending actions');

    const card = pressableWithText(r, 'Approvals');
    expect(instanceText(card!)).toContain('3');
    card!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith('/aihousekeeper-approvals');
  });

  it('shows "No pending actions" and no Followups card when both counts are zero', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AihousekeeperHubScreen />);
    const text = treeText(r);
    expect(text).toContain('No pending actions');
    expect(text).not.toContain('Followups');
  });

  it('renders the Followups card only when followups are pending, routing to settings', () => {
    mockQueryState.followups = {
      isLoading: false,
      data: { followups: [{}, {}] },
    };
    const r = renderOnDevice('iPad Pro 11 (portrait)', <AihousekeeperHubScreen />);
    const text = treeText(r);
    expect(text).toContain('Followups');
    expect(text).toContain('2 scheduled');

    const card = pressableWithText(r, 'Followups');
    card!.props.onPress();
    expect(mockRouter.push).toHaveBeenCalledWith('/aihousekeeper-settings');
  });
});

describe('AihousekeeperHubScreen — no household (corner case)', () => {
  it.each(PHONES.slice(0, 1).concat(IPADS.slice(0, 1)).map((d) => [d] as [DeviceName]))(
    'renders the "Select a household" empty state on %s',
    (device) => {
      mockHouseholdState.currentHousehold = null;
      const r = renderOnDevice(device, <AihousekeeperHubScreen />);
      const text = treeText(r);
      expect(text).toContain('Select a household');
      expect(text).toContain('Mira');
      // Primary action grid is not rendered without a household.
      expect(text).not.toContain('Trust ledger');
    }
  );
});
