/**
 * OnboardingNavigator — brand branching, stack registration, and Kaizen's
 * resume-on-relaunch `initialRouteName` computation.
 *
 * Matrix: documents/engineering/testing/matrices/kaizen.md — KAIZEN-ONB-015/016.
 *
 * The stack is mounted for real, but every screen component is a proxy stub
 * and `ThemeProvider` is a passthrough, so the suite exercises the
 * navigator's registration + branching logic rather than full screen trees
 * (same recording-native-stack pattern `BudgetNavigator.test.tsx` uses).
 */

jest.mock('@react-navigation/native-stack', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: ({
        children,
        initialRouteName,
      }: {
        children?: React.ReactNode;
        initialRouteName?: string;
      }) =>
        React.createElement(View, { testID: 'stack-navigator', initialRouteName }, children),
      Screen: ({
        name,
        component: Component,
        initialParams,
      }: {
        name: string;
        component?: React.ComponentType<Record<string, unknown>>;
        initialParams?: Record<string, unknown>;
      }) =>
        React.createElement(
          View,
          { testID: 'stack-screen', screenName: name, initialParams },
          Component ? React.createElement(Component) : null,
        ),
    }),
  };
});

jest.mock('@contexts/ThemeContext', () => ({
  __esModule: true,
  ThemeProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

const makeScreenBarrelProxy = () => {
  const React = require('react');
  const { View } = require('react-native');
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (typeof key !== 'string') return undefined;
        if (key === '__esModule') return true;
        if (!cache.has(key)) {
          const Stub = (props: Record<string, unknown>) =>
            React.createElement(View, { testID: `stub:${key}`, ...props });
          Stub.displayName = `Stub(${key})`;
          cache.set(key, Stub);
        }
        return cache.get(key);
      },
    },
  );
};

jest.mock('@screens/onboarding', () => makeScreenBarrelProxy());
// The local-first join screen now sits in the House onboarding stack too, so an
// invited member can reach the scanner before they have a home. Mocked like the
// rest: it reaches `@components/common` at import time, which this suite does
// not stand up.
jest.mock('@screens/house-v2/enrolment/HouseJoinScreen', () =>
  makeScreenBarrelProxy(),
);
jest.mock('@features/language', () => makeScreenBarrelProxy());

let mockIsHouseBrand = false;
let mockIsLanguageCapableBrand = false;
jest.mock('@brand', () => ({
  __esModule: true,
  isHouseBrand: () => mockIsHouseBrand,
  isLanguageCapableBrand: () => mockIsLanguageCapableBrand,
}));

let mockIsKaizenBrand = false;
jest.mock('@features/kaizen', () => ({
  __esModule: true,
  isKaizenBrand: () => mockIsKaizenBrand,
}));

let mockNextUnconfiguredSystem: string | null = null;
let mockNeedsCareerSetupStep = false;
jest.mock('@features/kaizen/services/setupFlow', () => ({
  __esModule: true,
  nextUnconfiguredSystem: () => mockNextUnconfiguredSystem,
  needsCareerSetupStep: () => mockNeedsCareerSetupStep,
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { OnboardingNavigator } from '../OnboardingNavigator';

function stackNavigatorProps(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'stack-navigator' }).props as {
    initialRouteName?: string;
  };
}

/** Route names of every screen registered on the mounted stack. */
function registeredRoutes(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => typeof n.type === 'string' && n.props?.testID === 'stack-screen')
    .map((n) => n.props.screenName as string);
}

function screenProps(tree: ReactTestRenderer.ReactTestRenderer, name: string) {
  return tree.root
    .findAll((n) => typeof n.type === 'string' && n.props?.testID === 'stack-screen')
    .find((n) => n.props.screenName === name)?.props as
    | { initialParams?: Record<string, unknown> }
    | undefined;
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<OnboardingNavigator />);
  });
  return tree;
}

beforeEach(() => {
  mockIsHouseBrand = false;
  mockIsLanguageCapableBrand = false;
  mockIsKaizenBrand = false;
  mockNextUnconfiguredSystem = null;
  mockNeedsCareerSetupStep = false;
});

describe('OnboardingNavigator — brand branching', () => {
  it('registers only LanguageOnboarding + EssentialPermissions on a language-capable brand', async () => {
    mockIsLanguageCapableBrand = true;
    const tree = await render();

    expect(registeredRoutes(tree)).toEqual(['LanguageOnboarding', 'EssentialPermissions']);
  });

  it('registers the full household stack on House', async () => {
    mockIsHouseBrand = true;
    const tree = await render();

    expect(registeredRoutes(tree)).toEqual([
      'Welcome',
      'EssentialPermissions',
      'CreateHousehold',
      'JoinHousehold',
      // The local-first join screen. `JoinHousehold` above only ever runs when a
      // deep link has already parked a token, so without this one a member
      // holding a QR code or a written-down code could not reach the scanner
      // without first creating a home they did not want.
      'HouseJoin',
      'SpaceSetup',
      // The AI ask, registered unconditionally and reached conditionally. It
      // decides whether `UploadReport` and `FloorPlan` are part of this
      // member's flow at all, so it has to sit in FRONT of them — and it stays
      // registered either way, so a deep link or a `goBack()` past it still
      // resolves to a real screen.
      'AIProvider',
      'UploadReport',
      'GarbageSetup',
      'FloorPlan',
    ]);
  });

  it('registers the Health goals screens and every Kaizen onboarding screen unconditionally on a non-House child brand', async () => {
    // Neither House nor Language-capable — matches Budget, Kaizen, and Health,
    // all of which share this one branch (gated by runtime checks, not a fork).
    const tree = await render();

    expect(registeredRoutes(tree)).toEqual([
      'Welcome',
      'HealthGoalsNutrition',
      'HealthGoalsWeight',
      'HealthGoalsActivity',
      'HealthGoalsWater',
      'HealthGoalsBiometrics',
      'EssentialPermissions',
      'HealthKitPermission',
      'KaizenSystemsSetup',
      'KaizenSystemConfig',
      'KaizenCareerSetup',
    ]);
  });
});

describe('OnboardingNavigator — Kaizen resume-on-relaunch', () => {
  it('starts at Welcome when Kaizen has no in-progress setup queue', async () => {
    mockIsKaizenBrand = true;
    const tree = await render();

    expect(stackNavigatorProps(tree).initialRouteName).toBe('Welcome');
  });

  it('resumes straight into KaizenSystemConfig, with the right system as initialParams, when the queue survived an app kill', async () => {
    mockIsKaizenBrand = true;
    mockNextUnconfiguredSystem = 'health';
    const tree = await render();

    expect(stackNavigatorProps(tree).initialRouteName).toBe('KaizenSystemConfig');
    expect(screenProps(tree, 'KaizenSystemConfig')?.initialParams).toEqual({ system: 'health' });
  });

  it('resumes into KaizenCareerSetup once every system is configured but Career setup is still pending', async () => {
    mockIsKaizenBrand = true;
    mockNextUnconfiguredSystem = null;
    mockNeedsCareerSetupStep = true;
    const tree = await render();

    expect(stackNavigatorProps(tree).initialRouteName).toBe('KaizenCareerSetup');
  });

  it('ignores the setup-queue state entirely on non-Kaizen brands', async () => {
    mockIsKaizenBrand = false;
    mockNextUnconfiguredSystem = 'health';
    mockNeedsCareerSetupStep = true;
    const tree = await render();

    expect(stackNavigatorProps(tree).initialRouteName).toBe('Welcome');
  });
});
