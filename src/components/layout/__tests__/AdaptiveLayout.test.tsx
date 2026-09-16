/**
 * The layout primitives that actually make the app "iPad-native" instead of a
 * stretched iPhone screen: AdaptiveContainer caps the reading width on tablets,
 * AdaptiveGrid lays children into device-appropriate columns. These assert the
 * tablet branch really engages (a common regression is it silently staying in
 * the phone layout).
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { Text, View } from 'react-native';

import { AdaptiveContainer, AdaptiveGrid } from '@components/layout';

import {
  IPADS,
  PHONES,
  renderOnDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const PHONE_CASES = PHONES.map((d) => [d] as [DeviceName]);
const IPAD_CASES = IPADS.map((d) => [d] as [DeviceName]);

/** Does any style object in the rendered tree carry a numeric maxWidth? */
function hasMaxWidthConstraint(json: unknown): boolean {
  return JSON.stringify(json).includes('"maxWidth"');
}

describe('AdaptiveContainer — reading-width cap', () => {
  it.each(IPAD_CASES)('caps content width on %s (iPad)', (device) => {
    const r = renderOnDevice(
      device,
      <AdaptiveContainer>
        <Text>Body content</Text>
      </AdaptiveContainer>
    );
    expect(treeText(r)).toContain('Body content');
    expect(hasMaxWidthConstraint(r.toJSON())).toBe(true);
  });

  it.each(PHONE_CASES)('does NOT cap width on %s (phone → full-bleed)', (device) => {
    const r = renderOnDevice(
      device,
      <AdaptiveContainer>
        <Text>Body content</Text>
      </AdaptiveContainer>
    );
    expect(treeText(r)).toContain('Body content');
    expect(hasMaxWidthConstraint(r.toJSON())).toBe(false);
  });
});

describe('AdaptiveGrid — renders all children on both form factors', () => {
  const children = Array.from({ length: 6 }, (_, i) => (
    <View key={i}>
      <Text>{`item-${i}`}</Text>
    </View>
  ));

  it.each([...PHONE_CASES, ...IPAD_CASES])('lays out every child on %s', (device) => {
    const r = renderOnDevice(device, <AdaptiveGrid>{children}</AdaptiveGrid>);
    const text = treeText(r);
    for (let i = 0; i < 6; i++) expect(text).toContain(`item-${i}`);
  });

  it('honours an explicit column override without crashing on iPad', () => {
    const r = renderOnDevice(
      'iPad Pro 12.9 (portrait)',
      <AdaptiveGrid columns={4}>{children}</AdaptiveGrid>
    );
    expect(r.toJSON()).toBeTruthy();
  });
});
