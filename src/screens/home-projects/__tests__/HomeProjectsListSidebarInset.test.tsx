/**
 * The Projects list has to reserve the width of the iPad sidebar itself.
 *
 * The rail is a FLOATING bar — `SidebarTabBar` is `position: absolute`,
 * `left: 0`, `zIndex: 9999` — so it does not take width away from the screen
 * underneath it, it draws on top of whatever that screen puts at x=0. Screens
 * wrapped in `AppBackground` get the leading inset for free; this one paints its
 * own background and so had none, and the project card is what made it visible:
 * its 124pt cover rail starts at the card's leading edge, so most of the project
 * photo — and the leading half of the Active tab pill — sat under the glass.
 *
 * Asserted against `SIDEBAR_COMPACT_WIDTH` rather than a bare number, because
 * the invariant is "content clears the rail", not "content is inset by 104".
 * A rail that grows and a screen that does not is the same bug again.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import type ReactTestRenderer from 'react-test-renderer';

import { SIDEBAR_COMPACT_WIDTH, SIDEBAR_FULL_WIDTH } from '@components/navigation/sidebarWidth';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';

import { renderOnDevice, type DeviceName } from '../../../test-utils/deviceRender';
import { HomeProjectsListScreen } from '../HomeProjectsListScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@api/home-projects', () => ({
  homeProjectsApi: { uploadSelectionPhoto: jest.fn(), update: jest.fn() },
  useHomeProjects: () => ({
    data: [],
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (selector: (s: unknown) => unknown) =>
    selector({ currentHousehold: { id: 'hh_1' } }),
}));

jest.mock('@features/house/local/useMemberFacingAlert', () => ({
  useMemberFacingAlert: () => jest.fn(),
}));

jest.mock('@components/common', () => ({
  AttachmentSourceSheet: () => null,
  HeaderActionButton: () => null,
  ScreenHeader: () => null,
  SettingsGearButton: () => null,
}));

jest.mock('@components/ui/FilterTabs', () => ({ FilterTabs: () => null }));
jest.mock('@components/home-projects/HomeProjectListCard', () => ({
  HomeProjectListCard: () => null,
}));
jest.mock('@components/home-projects/HomeProjectRenameSheet', () => ({
  HomeProjectRenameSheet: () => null,
}));

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  getState: () => ({ index: 0 }),
};

type Props = React.ComponentProps<typeof HomeProjectsListScreen>;

function leadingInsetOn(device: DeviceName): number {
  const renderer = renderOnDevice(
    device,
    <HomeProjectsListScreen
      {...({ navigation, route: { params: undefined } } as unknown as Props)}
    />
  );
  const root = renderer.root
    .findAllByProps({ testID: 'home-projects-list-screen' })
    .find(
      (node: ReactTestRenderer.ReactTestInstance) => typeof node.type === 'string'
    );
  return StyleSheet.flatten(root?.props.style).paddingLeft ?? 0;
}

describe('the Projects list next to the iPad sidebar', () => {
  beforeEach(() => {
    // What `SidebarTabBar` publishes once it has actually mounted.
    useTabBarVisibilityStore.setState({ isSidebarVisible: true });
  });

  afterAll(() => {
    useTabBarVisibilityStore.setState({ isSidebarVisible: false });
  });

  it('clears the compact rail in iPad portrait', () => {
    // The device in the report: 1024pt wide, rail collapsed to icons.
    expect(leadingInsetOn('iPad Pro 12.9 (portrait)')).toBeGreaterThanOrEqual(
      SIDEBAR_COMPACT_WIDTH
    );
  });

  it('clears the full-width rail once labels are showing', () => {
    // >= 1180pt earns the labelled 320pt sidebar, which is 3.5x the rail the
    // portrait case reserves — an inset that only covered the compact width
    // would put the cover photo back underneath it.
    expect(leadingInsetOn('iPad Pro 11 (landscape)')).toBeGreaterThanOrEqual(
      SIDEBAR_FULL_WIDTH
    );
  });

  it('reserves nothing on a phone, where the tab bar is along the bottom', () => {
    expect(leadingInsetOn('iPhone 14 Pro')).toBe(0);
  });

  it('reserves nothing on an iPad too narrow for a sidebar', () => {
    // Below the split-view breakpoint the bottom floating bar is what renders,
    // and a leading inset there would just be a dead margin.
    expect(leadingInsetOn('iPad mini (portrait)')).toBe(0);
  });

  it('gives the width back when a route suppresses the sidebar', () => {
    useTabBarVisibilityStore.setState({ isSidebarVisible: false });
    expect(leadingInsetOn('iPad Pro 12.9 (portrait)')).toBe(0);
  });
});
