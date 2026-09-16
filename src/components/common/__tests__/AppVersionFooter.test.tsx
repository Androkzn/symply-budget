/**
 * AppVersionFooter — the settings footer that reports which build is running and
 * what it talks to.
 *
 * The regression it guards is the bug it was written for: the footer rendered
 * `v1.0.0 (Build 1)` on every install because `ENV.APP_VERSION`/`BUILD_NUMBER`
 * were hardcoded strings, and the second line only ever printed the literal
 * `Staging`, gated on `__DEV__` rather than on the resolved API target — so a
 * release build pointed at staging said nothing at all. The tests mock
 * `@config/env` rather than the native layer: the footer's contract is "render
 * what ENV resolved", and `env-native`'s job (reading the native bundle) is a
 * separate one.
 */

const mockEnv = {
  APP_NAME: 'Symply House',
  APP_VERSION: '1.2.0',
  BUILD_NUMBER: '45',
  BUILD_TIME: '2026-09-04T14:32:11.000Z' as string | null,
  IS_PRODUCTION: false,
  ENV_LABEL: 'Staging',
};
// A GETTER, not `{ ENV: mockEnv }`: Babel hoists `jest.mock` (and the imports
// below) above the `const mockEnv` initialiser, so a factory that reads the
// object eagerly captures `undefined`.
jest.mock('@config/env', () => ({
  get ENV() {
    return mockEnv;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { AppVersionFooter, formatBuildTime } from '../AppVersionFooter';

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <AppVersionFooter testID="footer" />
      </ThemeProvider>,
    );
  });
  return tree;
}

const lineText = (tree: ReactTestRenderer.ReactTestRenderer, testID: string): string => {
  const node = tree.root.findAll((n) => n.props?.testID === testID)[0];
  return String(node.props.children);
};

beforeEach(() => {
  mockEnv.APP_VERSION = '1.2.0';
  mockEnv.BUILD_NUMBER = '45';
  mockEnv.BUILD_TIME = '2026-09-04T14:32:11.000Z';
  mockEnv.IS_PRODUCTION = false;
  mockEnv.ENV_LABEL = 'Staging';
});

describe('AppVersionFooter', () => {
  it('VER-001: shows the version + build ENV resolved, not a hardcoded 1.0.0 / 1', () => {
    expect(lineText(render(), 'footer-version')).toBe('Symply House v1.2.0 (Build 45)');
  });

  it('VER-002: names the resolved API environment and when the bundle was built', () => {
    const meta = lineText(render(), 'footer-meta');

    expect(meta).toContain('Staging');
    expect(meta).toContain('Built');
    expect(meta).toContain('2026');
  });

  it('VER-003: says Production on a production build — the label is not __DEV__-gated', () => {
    mockEnv.IS_PRODUCTION = true;
    mockEnv.ENV_LABEL = 'Production';

    expect(lineText(render(), 'footer-meta')).toContain('Production');
  });

  it('VER-004: falls back to the environment alone when the bundle carries no stamp', () => {
    mockEnv.BUILD_TIME = null;

    expect(lineText(render(), 'footer-meta')).toBe('Staging');
  });
});

describe('formatBuildTime', () => {
  it('VER-005: returns null for a missing or unparseable stamp, never "Invalid Date"', () => {
    expect(formatBuildTime(null)).toBeNull();
    expect(formatBuildTime('')).toBeNull();
    expect(formatBuildTime('not-a-date')).toBeNull();
  });

  it('VER-006: renders a real ISO stamp as a human date', () => {
    const out = formatBuildTime('2026-09-04T14:32:11.000Z');

    expect(out).toBeTruthy();
    expect(out).toContain('2026');
  });
});
