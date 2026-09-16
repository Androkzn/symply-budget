/**
 * ActivityIndicator — the brand-aware spinner shim every screen imports instead
 * of react-native's ActivityIndicator.
 *
 * The branches that matter: on `symply-health` this MUST render the red
 * HealthSpinner (enso ring + heartbeat); on `symply-house` it MUST render the
 * teal HouseSpinner (enso ring + pulsing house mark); every other fleet brand
 * gets the lime→teal SymplySpinner. A regression here silently ships one
 * brand's spinner inside another with no type error and no visual test to
 * catch it. `brandId` is baked in at module load, so each brand is exercised
 * through an isolated module registry.
 *
 * Also pins the RN prop parity the shim promises its call sites: `animating`,
 * `size`, `color`, `style`, `testID`.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- brand id is module-scoped, so each case needs an isolated registry */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

type Rendered = ReactTestRenderer.ReactTestRenderer;

/** Solid override a call site passes on a coloured surface (e.g. inside a button). */
const OVERRIDE_COLOR = 'rgb(255, 255, 255)';

/**
 * Load the shim with `brandId` pinned to `brand`, with both spinners replaced by
 * marker views so the assertion is about which one was chosen, not how it draws.
 */
function loadForBrand(brand: string) {
  let Component!: React.ComponentType<Record<string, unknown>>;
  jest.isolateModules(() => {
    jest.doMock('@brand', () => ({ brandId: brand }));
    jest.doMock('@features/health/components/HealthSpinner', () => {
      const ReactMock = require('react');
      const { View } = require('react-native');
      return {
        HealthSpinner: (props: Record<string, unknown>) =>
          ReactMock.createElement(View, { ...props, testID: props.testID ?? 'health-spinner' }),
      };
    });
    jest.doMock('@features/house/components/HouseSpinner', () => {
      const ReactMock = require('react');
      const { View } = require('react-native');
      return {
        HouseSpinner: (props: Record<string, unknown>) =>
          ReactMock.createElement(View, { ...props, testID: props.testID ?? 'house-spinner' }),
      };
    });
    jest.doMock('../SymplySpinner', () => {
      const ReactMock = require('react');
      const { View } = require('react-native');
      return {
        SymplySpinner: (props: Record<string, unknown>) =>
          ReactMock.createElement(View, { ...props, testID: props.testID ?? 'symply-spinner' }),
      };
    });
    Component = require('../ActivityIndicator').ActivityIndicator;
  });
  return Component;
}

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

function has(tree: Rendered, testID: string): boolean {
  return tree.root.findAll((n) => n.props?.testID === testID).length > 0;
}

/**
 * Props of the DEEPEST node carrying `testID` — i.e. what the chosen spinner
 * actually received. The shim element itself also carries the testID, and it
 * still holds props (like `color`) that it deliberately does not forward.
 */
function propsOf(tree: Rendered, testID: string): Record<string, unknown> {
  const matches = tree.root.findAll((n) => n.props?.testID === testID);
  return matches[matches.length - 1].props as Record<string, unknown>;
}

afterEach(() => {
  jest.resetModules();
  jest.dontMock('@brand');
});

describe('ActivityIndicator — brand routing', () => {
  it('HEALTH-SPIN-018: symply-health renders the HealthSpinner, never the Symply or House one', () => {
    const ActivityIndicator = loadForBrand('symply-health');
    const tree = render(<ActivityIndicator />);
    expect(has(tree, 'health-spinner')).toBe(true);
    expect(has(tree, 'symply-spinner')).toBe(false);
    expect(has(tree, 'house-spinner')).toBe(false);
  });

  it('HOUSE-SPIN-026: symply-house renders the HouseSpinner, never the Symply or Health one', () => {
    const ActivityIndicator = loadForBrand('symply-house');
    const tree = render(<ActivityIndicator />);
    expect(has(tree, 'house-spinner')).toBe(true);
    expect(has(tree, 'symply-spinner')).toBe(false);
    expect(has(tree, 'health-spinner')).toBe(false);
  });

  it.each(['symply-budget', 'symply-kaizen', 'symply-language'])(
    'HEALTH-SPIN-019: %s renders the SymplySpinner, never the Health or House one',
    (brand) => {
      const ActivityIndicator = loadForBrand(brand);
      const tree = render(<ActivityIndicator />);
      expect(has(tree, 'symply-spinner')).toBe(true);
      expect(has(tree, 'health-spinner')).toBe(false);
      expect(has(tree, 'house-spinner')).toBe(false);
    },
  );

  it('HEALTH-SPIN-020: an unknown brand id falls back to the Symply spinner, not Health or House', () => {
    const ActivityIndicator = loadForBrand('symply-nope');
    const tree = render(<ActivityIndicator />);
    expect(has(tree, 'symply-spinner')).toBe(true);
    expect(has(tree, 'health-spinner')).toBe(false);
    expect(has(tree, 'house-spinner')).toBe(false);
  });
});

describe('ActivityIndicator — prop parity', () => {
  it('HEALTH-SPIN-021: renders nothing when animating is false (both brands)', () => {
    for (const brand of ['symply-health', 'symply-house']) {
      const ActivityIndicator = loadForBrand(brand);
      const tree = render(<ActivityIndicator animating={false} />);
      expect(tree.toJSON()).toBeNull();
    }
  });

  it('HEALTH-SPIN-022: animating defaults to true', () => {
    const ActivityIndicator = loadForBrand('symply-health');
    const tree = render(<ActivityIndicator />);
    expect(tree.toJSON()).not.toBeNull();
  });

  it('HEALTH-SPIN-023: forwards size, style and testID to the Health spinner', () => {
    const ActivityIndicator = loadForBrand('symply-health');
    const tree = render(
      <ActivityIndicator size="large" style={{ marginTop: 8 }} testID="health-loading" />,
    );
    const props = propsOf(tree, 'health-loading');
    expect(props.size).toBe('large');
    expect(props.style).toEqual({ marginTop: 8 });
  });

  it('HEALTH-SPIN-024: size defaults to small', () => {
    const ActivityIndicator = loadForBrand('symply-health');
    const tree = render(<ActivityIndicator testID="health-loading" />);
    expect(propsOf(tree, 'health-loading').size).toBe('small');
  });

  it('HEALTH-SPIN-025: color is a Symply-spinner-only override — Health ignores it', () => {
    const HealthIndicator = loadForBrand('symply-health');
    const healthTree = render(<HealthIndicator testID="health-loading" color={OVERRIDE_COLOR} />);
    expect(propsOf(healthTree, 'health-loading').color).toBeUndefined();

    const HouseIndicator = loadForBrand('symply-house');
    const houseTree = render(<HouseIndicator testID="house-loading" color={OVERRIDE_COLOR} />);
    expect(propsOf(houseTree, 'house-loading').color).toBe(OVERRIDE_COLOR);
  });
});
