import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Icon } from '../Icon';
import { IconBackgroundChip } from '../IconBackgroundChip';

jest.mock('@theme', () => ({
  useAppColors: () => ({
    textPrimary: '#0A1325',
    primary: '#2BB673',
  }),
  hexToRgba: (hex: string, alpha: number) => `rgba(${hex},${alpha})`,
  IconSize: { md: 22 },
}));

describe('IconBackgroundChip', () => {
  it('tints the icon to match body label text by default', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<IconBackgroundChip name="home-outline" testID="chip" />);
    });

    const icon = tree!.root.findByType(Icon);
    expect(icon.props.color).toBe('#0A1325');
    expect(icon.props.active).toBe(false);
  });

  it('uses palette primary for an active chip', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<IconBackgroundChip name="income" active testID="chip" />);
    });

    expect(tree!.root.findByType(Icon).props.active).toBe(true);
    expect(tree!.root.findByType(Icon).props.color).toBe('#2BB673');
  });

  it('allows an explicit icon color for disabled or semantic rows', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <IconBackgroundChip name="add-outline" color="#999999" testID="chip" />
      );
    });

    expect(tree!.root.findByType(Icon).props.color).toBe('#999999');
  });
});
