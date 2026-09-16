/**
 * languageScreenTestKit — the shared query helpers every Symply Language
 * (`symply-language`) screen suite is built on.
 *
 * These helpers decide what the screen suites can see, so a silent regression
 * here (a missed nested child, a composite double-match, a swallowed no-match)
 * would quietly weaken all eight screen suites at once. This file drives the
 * helpers directly against a small fixture tree: text flattening, testID and
 * accessibilityRole lookup, pressable matching by text, and the explicit throw
 * pressByText raises when nothing matches.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import {
  allText,
  byRole,
  byTestId,
  hasTestId,
  instanceText,
  pressablesWithText,
  pressByText,
} from '../languageScreenTestKit';

const onSave = jest.fn();
const onGoal = jest.fn();

/**
 * A fixture shaped like the screens under test: nested text, a testID that also
 * exists on a composite-ish wrapper, two pressables and a checkbox role.
 */
function Fixture() {
  return (
    <View testID="kit-root">
      <Text>Good morning</Text>
      <View testID="kit-card">
        <Text>Daily </Text>
        <Text>goals</Text>
        <Text>{3}</Text>
      </View>
      <Pressable testID="kit-save" onPress={onSave}>
        <Text>Save changes</Text>
      </Pressable>
      <Pressable testID="kit-goal" onPress={onGoal} accessibilityRole="checkbox">
        <Text>Speak for 2 minutes</Text>
      </Pressable>
    </View>
  );
}

function renderFixture() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<Fixture />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('languageScreenTestKit — allText', () => {
  it('flattens every nested string + number in render order', () => {
    const tree = renderFixture();
    const text = allText(tree.toJSON());
    // Adjacent <Text> siblings concatenate, so screens can assert on a phrase
    // that the JSX splits across nodes.
    expect(text).toContain('Daily goals');
    expect(text).toContain('Good morning');
    expect(text).toContain('3'); // numbers are stringified
  });

  it('returns an empty string for nullish or childless nodes', () => {
    expect(allText(null)).toBe('');
    expect(allText(undefined)).toBe('');
    expect(allText({})).toBe('');
  });

  it('flattens a bare string, number or array without a tree', () => {
    expect(allText('hola')).toBe('hola');
    expect(allText(7)).toBe('7');
    expect(allText(['a', 1, null])).toBe('a1');
  });
});

describe('languageScreenTestKit — instanceText', () => {
  it('concatenates only the subtree of the given instance', () => {
    const tree = renderFixture();
    const card = tree.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.testID === 'kit-card',
    )[0];
    expect(instanceText(card)).toBe('Daily goals3');
    // Siblings outside the subtree are excluded.
    expect(instanceText(card)).not.toContain('Good morning');
  });
});

describe('languageScreenTestKit — byTestId / hasTestId', () => {
  it('matches host nodes by testID without composite double-matches', () => {
    const tree = renderFixture();
    expect(byTestId(tree, 'kit-card')).toHaveLength(1);
    expect(byTestId(tree, 'kit-card')[0].props.testID).toBe('kit-card');
    expect(hasTestId(tree, 'kit-root')).toBe(true);
  });

  it('reports a missing testID as absent rather than throwing', () => {
    const tree = renderFixture();
    expect(byTestId(tree, 'kit-nope')).toHaveLength(0);
    expect(hasTestId(tree, 'kit-nope')).toBe(false);
  });
});

describe('languageScreenTestKit — pressablesWithText / pressByText', () => {
  it('finds every pressable whose subtree contains the text', () => {
    const tree = renderFixture();
    expect(pressablesWithText(tree, 'Save changes').length).toBeGreaterThan(0);
    expect(pressablesWithText(tree, 'Speak for 2 minutes').length).toBeGreaterThan(0);
    expect(pressablesWithText(tree, 'Good morning')).toHaveLength(0); // not inside a pressable
  });

  it('fires onPress on the outermost matching pressable', () => {
    const tree = renderFixture();
    act(() => pressByText(tree, 'Save changes'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onGoal).not.toHaveBeenCalled();
  });

  it('throws a named error when no pressable matches', () => {
    const tree = renderFixture();
    // A silent no-op here would make a screen suite "pass" without ever
    // pressing anything, so the throw is load-bearing.
    expect(() => pressByText(tree, 'Nonexistent button')).toThrow(
      'No pressable found containing text: "Nonexistent button"',
    );
  });
});

describe('languageScreenTestKit — byRole', () => {
  it('matches nodes by accessibilityRole', () => {
    const tree = renderFixture();
    const checkboxes = byRole(tree, 'checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(instanceText(checkboxes[0])).toContain('Speak for 2 minutes');
  });

  it('returns nothing for a role the tree does not use', () => {
    expect(byRole(renderFixture(), 'radio')).toHaveLength(0);
  });
});
