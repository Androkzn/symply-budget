/**
 * ProjectionTargetModal — the savings-goal editor behind both Projection write
 * paths (one month / every remaining month).
 *
 * The parsing helpers carry the real risk here: a field that silently resolves
 * to 0 would write a "save nothing" goal the household never typed, and losing
 * the minus sign would turn a planned deficit month (a car, a wedding) into a
 * surplus. Both are covered as pure functions, plus the sheet's own wiring:
 * suggestions fill the field, the bulk toggle flows through to the caller, and
 * Clear is only offered when there is an existing goal to clear.
 */

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    // Mirrors `SheetHeader`, the sheet's top bar: the ✕ carries `leftTestID`
    // (the id the cancel flow drives) beside the centred title.
    SheetHeader: ({ title, onLeftPress, leftTestID }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onLeftPress, testID: leftTestID })
      ),
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  ProjectionTargetModal,
  parseTargetDollars,
  targetCentsToInput,
} from '../ProjectionTargetModal';

describe('parseTargetDollars', () => {
  it('parses plain, grouped and decorated dollar input', () => {
    expect(parseTargetDollars('1200')).toBe(120000);
    expect(parseTargetDollars('1,200')).toBe(120000);
    expect(parseTargetDollars('$1,200.50')).toBe(120050);
    expect(parseTargetDollars('0')).toBe(0);
  });

  it('keeps a leading minus — a planned deficit month is a real goal', () => {
    expect(parseTargetDollars('-2500')).toBe(-250000);
  });

  it('returns null (never 0) for empty or unparseable input', () => {
    expect(parseTargetDollars('')).toBeNull();
    expect(parseTargetDollars('   ')).toBeNull();
    expect(parseTargetDollars('abc')).toBeNull();
    expect(parseTargetDollars('-')).toBeNull();
    expect(parseTargetDollars('.')).toBeNull();
  });

  it('rounds to whole cents', () => {
    expect(parseTargetDollars('10.005')).toBe(1001);
  });
});

describe('targetCentsToInput', () => {
  it('renders a clean editable string, and nothing at all for "no goal"', () => {
    expect(targetCentsToInput(null)).toBe('');
    expect(targetCentsToInput(120000)).toBe('1200');
    expect(targetCentsToInput(120050)).toBe('1200.50');
    expect(targetCentsToInput(-250000)).toBe('-2500');
  });
});

describe('ProjectionTargetModal', () => {
  const baseProps = {
    visible: true,
    year: 2026,
    month: 9,
    initialTarget: null as number | null,
    remainingCount: 4,
    suggestions: [
      { label: 'Your pace', cents: 283333 },
      { label: 'Your best month', cents: 700000 },
    ],
    onClose: jest.fn(),
    onSubmit: jest.fn(),
  };

  function render(props: Partial<typeof baseProps> = {}) {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <ProjectionTargetModal {...baseProps} {...props} />
        </ThemeProvider>
      );
    });
    return tree;
  }

  beforeEach(() => {
    baseProps.onClose = jest.fn();
    baseProps.onSubmit = jest.fn();
  });

  it('submits the typed figure for the single month by default', () => {
    const onSubmit = jest.fn();
    const tree = render({ onSubmit });

    act(() => {
      tree.root.findByProps({ testID: 'projection-target-amount' }).props.onChangeText('1500');
    });
    act(() => {
      tree.root.findByProps({ testID: 'projection-target-save' }).props.onPress();
    });

    expect(onSubmit).toHaveBeenCalledWith(150000, false);
  });

  it('fills the field from a suggestion chip', () => {
    const onSubmit = jest.fn();
    const tree = render({ onSubmit });

    act(() => {
      tree.root
        .findByProps({ testID: 'projection-target-suggestion-Your best month' })
        .props.onPress();
    });
    act(() => {
      tree.root.findByProps({ testID: 'projection-target-save' }).props.onPress();
    });

    expect(onSubmit).toHaveBeenCalledWith(700000, false);
  });

  it('flags the bulk write when "apply to all" is on', () => {
    const onSubmit = jest.fn();
    const tree = render({ onSubmit });

    act(() => {
      tree.root.findByProps({ testID: 'projection-target-amount' }).props.onChangeText('900');
      tree.root.findByProps({ testID: 'projection-target-apply-all' }).props.onValueChange(true);
    });
    act(() => {
      tree.root.findByProps({ testID: 'projection-target-save' }).props.onPress();
    });

    expect(onSubmit).toHaveBeenCalledWith(90000, true);
  });

  it('opens with bulk pre-armed for the plan-the-year entry point', () => {
    const tree = render({ initialApplyToAll: true } as Partial<typeof baseProps>);
    expect(
      tree.root.findByProps({ testID: 'projection-target-apply-all' }).props.value
    ).toBe(true);
  });

  it('hides the bulk toggle when this is the last month of the year', () => {
    const tree = render({ month: 12, remainingCount: 1 });
    expect(
      tree.root.findAllByProps({ testID: 'projection-target-apply-all' })
    ).toHaveLength(0);
  });

  it('offers Clear only when a goal already exists, and submits a null', () => {
    const onSubmit = jest.fn();
    expect(
      render().root.findAllByProps({ testID: 'projection-target-clear' })
    ).toHaveLength(0);

    const tree = render({ initialTarget: 300000, onSubmit });
    act(() => {
      tree.root.findByProps({ testID: 'projection-target-clear' }).props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledWith(null, false);
  });

  it('refuses to save an empty field rather than writing a $0 goal', () => {
    const onSubmit = jest.fn();
    const tree = render({ onSubmit });

    const save = tree.root.findByProps({ testID: 'projection-target-save' });
    expect(save.props.disabled).toBe(true);
    act(() => {
      save.props.onPress();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
