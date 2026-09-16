/**
 * navigateToTabRoot — tapping a bottom-nav item lands on that tab's ROOT
 * screen, whatever its nested stack currently holds.
 *
 * Matrix: documents/engineering/testing/matrices/budget.md — BUDGET-NAV-013
 *
 * Unlike the rest of the navigation suites, this one mounts REAL navigators
 * (bottom-tabs hosting a native-stack) instead of the recording stubs: the
 * behaviour under test is a router state transition, and a stubbed navigator
 * has no state to transition. jest.setup.js's global inert native-stack mock
 * is therefore replaced with the real module here.
 *
 * The regression that motivated it: on Budget-A the Home tab's nested stack
 * was `["BudgetSettings"]` — rooted at the drill-down, not at BudgetMain —
 * so `popToTop()` was a no-op and tapping Home never left Budget Settings.
 */

jest.mock('@react-navigation/native-stack', () =>
  jest.requireActual('@react-navigation/native-stack'),
);

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Text, Pressable } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { navigateToTabRoot } from '@navigation/navigateToTabRoot';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Root() {
  const navigation = useNavigation<{
    navigate: (name: string) => void;
    goBack: () => void;
  }>();
  return (
    <>
      <Pressable
        testID="push-child"
        onPress={() => navigation.navigate('Child')}
      >
        <Text>root-screen</Text>
      </Pressable>
      <Pressable testID="pop-self" onPress={() => navigation.goBack()}>
        <Text>pop</Text>
      </Pressable>
    </>
  );
}
const Child = () => <Text>child-screen</Text>;
const Other = () => <Text>other-screen</Text>;

/** Mirrors app/(tabs)/index.tsx for Budget: the tab hosts a nested stack. */
function HomeTab() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Root" component={Root} />
      <Stack.Screen name="Child" component={Child} />
    </Stack.Navigator>
  );
}

/**
 * Stand-in for FloatingTabBar / SidebarTabBar — same single call they make.
 *
 * The casts bridge two type identities of ONE runtime module: the helper is
 * typed against `expo-router/js-tabs` (what the app's tab bars receive) while
 * the navigators here come from `@react-navigation/bottom-tabs`. metro.config
 * aliases the two onto a single instance at runtime; tsc still sees them as
 * distinct declarations.
 */
function Bar({ state, navigation }: BottomTabBarProps) {
  const tap = (routeName: string) =>
    navigateToTabRoot(
      navigation as unknown as Parameters<typeof navigateToTabRoot>[0],
      state as unknown as Parameters<typeof navigateToTabRoot>[1],
      routeName,
    );
  return (
    <>
      <Pressable testID="tab-index" onPress={() => tap('index')}>
        <Text>Home</Text>
      </Pressable>
      <Pressable testID="tab-other" onPress={() => tap('other')}>
        <Text>Other</Text>
      </Pressable>
    </>
  );
}

type ContainerInitialState = React.ComponentProps<
  typeof NavigationContainer
>['initialState'];

const renderTabs = (initialState?: ContainerInitialState) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NavigationContainer initialState={initialState}>
        <Tab.Navigator tabBar={props => <Bar {...props} />}>
          <Tab.Screen name="index" component={HomeTab} />
          <Tab.Screen name="other" component={Other} />
        </Tab.Navigator>
      </NavigationContainer>,
    );
  });
  return tree;
};

const press = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  act(() => {
    tree.root.findAll(node => node.props?.testID === testID)[0].props.onPress();
  });

const rendered = (tree: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());

describe('navigateToTabRoot', () => {
  it('pops a drill-down off the tapped tab (BUDGET-NAV-013)', () => {
    const tree = renderTabs();
    press(tree, 'push-child');
    expect(rendered(tree)).toContain('child-screen');

    press(tree, 'tab-index');

    expect(rendered(tree)).not.toContain('child-screen');
    expect(rendered(tree)).toContain('root-screen');
  });

  it('rebuilds a stack that is ROOTED at a drill-down (BUDGET-NAV-013)', () => {
    // The shape observed on Budget-A after a `screen=` deep link into the Home
    // tab: the nested stack's only route is the drill-down itself, so there is
    // no "top" to pop back to. Popping Root off a rehydrated [Child, Root] is
    // how the fixture reaches that shape with a settled (keyed) stack, which
    // is what the tab bar actually sees on the device.
    const tree = renderTabs({
      index: 0,
      routes: [
        {
          name: 'index',
          state: { routes: [{ name: 'Child' }, { name: 'Root' }] },
        },
        { name: 'other' },
      ],
    });
    press(tree, 'pop-self');
    expect(rendered(tree)).toContain('child-screen');
    expect(rendered(tree)).not.toContain('root-screen');

    press(tree, 'tab-index');

    expect(rendered(tree)).not.toContain('child-screen');
    expect(rendered(tree)).toContain('root-screen');
  });

  it('rebuilds when the root screen sits ABOVE the drill-down (BUDGET-NAV-013)', () => {
    // Same fault, one push later: popToTop would land back on the drill-down.
    const tree = renderTabs({
      index: 0,
      routes: [
        {
          name: 'index',
          state: { routes: [{ name: 'Child' }, { name: 'Root' }] },
        },
        { name: 'other' },
      ],
    });

    press(tree, 'tab-index');

    expect(rendered(tree)).not.toContain('child-screen');
    expect(rendered(tree)).toContain('root-screen');
  });

  it('resets the tapped tab when switching from another tab', () => {
    const tree = renderTabs();
    press(tree, 'push-child');
    press(tree, 'tab-other');
    expect(rendered(tree)).toContain('other-screen');

    press(tree, 'tab-index');

    expect(rendered(tree)).not.toContain('child-screen');
    expect(rendered(tree)).toContain('root-screen');
  });

  it('is a no-op for a tab whose nested stack has not mounted', () => {
    const tree = renderTabs();

    // `other` has no nested navigator at all — nothing to unwind, no crash.
    expect(() => press(tree, 'tab-other')).not.toThrow();
    expect(rendered(tree)).toContain('other-screen');
  });
});
