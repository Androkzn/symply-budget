/**
 * Kaizen first-class tab wrappers — app/(tabs)/kaizen-{career,assess,learn,systems}.tsx.
 *
 * Each is a thin brand gate: on the Symply Kaizen brand it renders the section
 * screen; on any other brand it must <Redirect href="/"> so a mis-pinned tab
 * can never surface a Kaizen screen inside House/Budget/Language/Health. The
 * kaizen feature module and expo-router are mocked so both branches are driven
 * deterministically regardless of the bundle's active brand.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockIsKaizenBrand = true;
jest.mock('@features/kaizen', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const screen = (testID: string) => () => ReactMock.createElement(View, { testID });
  return {
    isKaizenBrand: () => mockIsKaizenBrand,
    KaizenCareerScreen: screen('career-screen'),
    KaizenAssessScreen: screen('assess-screen'),
    KaizenLearnScreen: screen('learn-screen'),
    KaizenSystemsScreen: screen('systems-screen'),
  };
});

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactMock.createElement(View, { testID: 'redirect', href }),
  };
});

import KaizenAssessTab from '../kaizen-assess';
import KaizenCareerTab from '../kaizen-career';
import KaizenLearnTab from '../kaizen-learn';
import KaizenSystemsTab from '../kaizen-systems';

type Tab = React.ComponentType;

function render(Component: Tab) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<Component />);
  });
  return tree;
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0;
}

function redirectHref(tree: ReactTestRenderer.ReactTestRenderer): string | undefined {
  const nodes = tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'redirect');
  return nodes[0]?.props?.href;
}

const TABS: Array<{ name: string; Component: Tab; screen: string }> = [
  { name: 'kaizen-career', Component: KaizenCareerTab, screen: 'career-screen' },
  { name: 'kaizen-assess', Component: KaizenAssessTab, screen: 'assess-screen' },
  { name: 'kaizen-learn', Component: KaizenLearnTab, screen: 'learn-screen' },
  { name: 'kaizen-systems', Component: KaizenSystemsTab, screen: 'systems-screen' },
];

describe('Kaizen tab wrappers — on the Kaizen brand', () => {
  beforeEach(() => {
    mockIsKaizenBrand = true;
  });

  TABS.forEach(({ name, Component, screen }) => {
    it(`${name} renders its section screen and does not redirect`, () => {
      const tree = render(Component);
      expect(has(tree, screen)).toBe(true);
      expect(has(tree, 'redirect')).toBe(false);
    });
  });
});

describe('Kaizen tab wrappers — on a non-Kaizen brand', () => {
  beforeEach(() => {
    mockIsKaizenBrand = false;
  });

  TABS.forEach(({ name, Component, screen }) => {
    it(`${name} redirects to "/" and never renders the screen`, () => {
      const tree = render(Component);
      expect(has(tree, screen)).toBe(false);
      expect(redirectHref(tree)).toBe('/');
    });
  });
});
