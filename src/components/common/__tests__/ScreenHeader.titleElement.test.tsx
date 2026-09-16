/**
 * ScreenHeader — `titleElement`, the escape hatch for headers whose title is
 * itself a control (the Mortgage tab's property dropdown). It takes over the
 * CENTERED title slot: the plain `title` text must not render alongside it, and
 * passing it alone must still put the header in its nested (titled) branch
 * rather than the brand-lockup default.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

jest.mock('@contexts/ProfileContext', () => ({
  __esModule: true,
  useProfile: () => ({ user: { display_name: 'Andrei', email: 'a@example.com' } }),
}));

import React from 'react';
import { Text } from 'react-native';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { ScreenHeader } from '../ScreenHeader';

const textsOf = (root: ReturnType<typeof renderOnDevice>['root']): string[] =>
  root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .filter((c): c is string => typeof c === 'string');

describe('ScreenHeader titleElement', () => {
  it('renders the custom title element instead of the title text', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <ScreenHeader
        title="Mortgage"
        titleElement={<Text testID="custom-title">Main home</Text>}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />
    );

    expect(renderer.root.findAllByProps({ testID: 'custom-title' }).length).toBeGreaterThan(0);
    // The string title is superseded, not stacked on top of the control.
    expect(textsOf(renderer.root)).not.toContain('Mortgage');
  });

  it('takes the nested (titled) branch even with no title or back button', () => {
    const renderer = renderOnDevice(
      'iPhone 14 Pro',
      <ScreenHeader
        titleElement={<Text testID="custom-title">Main home</Text>}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />
    );

    expect(renderer.root.findAllByProps({ testID: 'custom-title' }).length).toBeGreaterThan(0);
  });
});
