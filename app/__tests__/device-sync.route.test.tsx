/**
 * `/device-sync` route host — the deep-link half of the House V2 local-first
 * surface (plan §0.1, §5.1).
 *
 * This route is the reason `simplehouse://device-sync` resolves to anything at
 * all. Before it existed, `app/+not-found.tsx` swallowed the URL and redirected
 * to `/`, so the invite link handed to a partner — and the two-device suite's
 * `mm-open-lf-settings` fallback — both landed on Home with no error.
 *
 * The two guards are tested separately on purpose. Brand alone is not enough:
 * on a build with the ledger switched off, this screen describes a household
 * key and enrolled devices that do not exist.
 */
/*
 * `jest.mock` factories are hoisted above the import block, so they cannot use
 * `import` — the modules would not exist yet when the factory runs. `require`
 * inside a factory is the only form that works, as in the sibling route suites.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

let mockBrandId = 'symply-house';
let mockLocalFirst = true;

// Mocked outright rather than spread over `requireActual`: `@brand`'s barrel
// eagerly resolves brand capabilities at module load, and pulling the real one
// in here trips that circular init before the test can set a brand.
jest.mock('@brand', () => ({
  __esModule: true,
  isHouseBrand: () => mockBrandId === 'symply-house',
}));

jest.mock('@features/house/local/flag', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockLocalFirst,
}));

const mockRedirect = jest.fn();
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Redirect: (props: { href: unknown }) => {
      mockRedirect(props.href);
      return React.createElement(View, { testID: 'redirect' });
    },
  };
});

jest.mock('@screens/house-v2/enrolment', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    HouseDeviceSyncScreen: () =>
      React.createElement(View, { testID: 'house-device-sync-screen' }),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import DeviceSyncRoute from '../device-sync';

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<DeviceSyncRoute />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBrandId = 'symply-house';
  mockLocalFirst = true;
});

describe('/device-sync route', () => {
  it('mounts the device-sync screen under House with local-first on', async () => {
    const tree = await render();

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(
      tree.root.findByProps({ testID: 'house-device-sync-screen' }),
    ).toBeTruthy();
  });

  it.each([['symply-budget'], ['symply-kaizen'], ['symply-language'], ['symply-health']])(
    'redirects %s to "/" rather than mounting a House-only surface',
    async brand => {
      mockBrandId = brand;
      const tree = await render();

      expect(mockRedirect).toHaveBeenCalledWith('/');
      expect(
        tree.root.findAllByProps({ testID: 'house-device-sync-screen' }),
      ).toHaveLength(0);
    },
  );

  it('redirects on House when local-first is off — the ledger it describes is not running', async () => {
    mockLocalFirst = false;
    const tree = await render();

    expect(mockRedirect).toHaveBeenCalledWith('/');
    expect(
      tree.root.findAllByProps({ testID: 'house-device-sync-screen' }),
    ).toHaveLength(0);
  });
});
