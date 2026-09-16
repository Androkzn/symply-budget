/**
 * Kaizen Guide tab — `app/(tabs)/mira.tsx` brand gate.
 * On Kaizen brand the mira slot must render KaizenGuideScreen (not House Mira).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockIsKaizenBrand = true;
let mockIsHouseBrand = false;

jest.mock('@brand', () => ({
  isHouseBrand: () => mockIsHouseBrand,
}));

jest.mock('@features/kaizen', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    isKaizenBrand: () => mockIsKaizenBrand,
    KaizenGuideScreen: () => R.createElement(View, { testID: 'guide-screen' }),
  };
});

jest.mock('@screens/aihousekeeper/AihousekeeperChatScreen', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    AihousekeeperChatScreen: () => R.createElement(View, { testID: 'house-mira-screen' }),
  };
});

jest.mock('expo-router', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      R.createElement(View, { testID: 'redirect', href }),
  };
});

import MiraTab from '../mira';

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<MiraTab />);
  });
  return tree;
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID)
    .length > 0;
}

describe('mira tab — Kaizen Guide', () => {
  beforeEach(() => {
    mockIsKaizenBrand = true;
    mockIsHouseBrand = false;
  });

  it('renders KaizenGuideScreen and never House Mira', () => {
    const tree = render();
    expect(has(tree, 'guide-screen')).toBe(true);
    expect(has(tree, 'house-mira-screen')).toBe(false);
    expect(has(tree, 'redirect')).toBe(false);
  });
});

describe('mira tab — non-Kaizen non-House', () => {
  beforeEach(() => {
    mockIsKaizenBrand = false;
    mockIsHouseBrand = false;
  });

  it('redirects to home', () => {
    const tree = render();
    expect(has(tree, 'guide-screen')).toBe(false);
    const redirect = tree.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.testID === 'redirect',
    )[0];
    expect(redirect?.props?.href).toBe('/');
  });
});

describe('mira tab — House', () => {
  beforeEach(() => {
    mockIsKaizenBrand = false;
    mockIsHouseBrand = true;
  });

  it('renders AihousekeeperChatScreen', () => {
    const tree = render();
    expect(has(tree, 'house-mira-screen')).toBe(true);
    expect(has(tree, 'guide-screen')).toBe(false);
  });
});
