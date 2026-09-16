/**
 * CopyEntryModal — target-date picker for "copy income / spending to another
 * month or day". Covers the exported date helpers (day shift, month shift with
 * end-of-month clamping) and the sheet interaction: default target = source
 * date, quick-shift chips, and confirm/cancel callbacks.
 */

// Native date picker → prop-forwarding stub so the sheet can mount under jest.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props: Record<string, unknown>) =>
    React.createElement(View, { testID: 'mock-datetimepicker', ...props });
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  CopyEntryModal,
  addDaysYMD,
  addMonthsYMD,
  dateToYMD,
  parseYMD,
} from '../CopyEntryModal';

describe('CopyEntryModal date helpers', () => {
  it('parses and re-serializes a YMD string without timezone drift', () => {
    expect(dateToYMD(parseYMD('2026-07-15'))).toBe('2026-07-15');
  });

  it('shifts by whole days across a month boundary', () => {
    expect(addDaysYMD('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysYMD('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('shifts by whole months keeping the day when it exists', () => {
    expect(addMonthsYMD('2026-07-15', 1)).toBe('2026-08-15');
    expect(addMonthsYMD('2026-07-15', -1)).toBe('2026-06-15');
  });

  it('clamps the day to the last day of a shorter target month', () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year).
    expect(addMonthsYMD('2026-01-31', 1)).toBe('2026-02-28');
    // Feb 29 in a leap year.
    expect(addMonthsYMD('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('rolls the year over when shifting months past December', () => {
    expect(addMonthsYMD('2026-12-10', 1)).toBe('2027-01-10');
  });
});

function renderModal(props: Partial<React.ComponentProps<typeof CopyEntryModal>> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <CopyEntryModal
          visible
          title="Copy income"
          entryLabel="July Paycheck"
          sourceDateYMD="2026-01-31"
          onClose={onClose}
          onConfirm={onConfirm}
          {...props}
        />
      </ThemeProvider>
    );
  });
  return { tree, onConfirm, onClose };
}

describe('CopyEntryModal interaction', () => {
  it('confirms the source date by default', () => {
    const { tree, onConfirm } = renderModal();

    act(() => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith('2026-01-31');
  });

  it('confirms a month-shifted (clamped) date after tapping "Next month"', () => {
    const { tree, onConfirm } = renderModal();

    act(() => {
      tree.root.findAllByProps({ testID: 'copy-entry-quick-next-month' })[0].props.onPress();
    });
    act(() => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith('2026-02-28');
  });

  it('confirms a day-shifted date after tapping "Next day"', () => {
    const { tree, onConfirm } = renderModal();

    act(() => {
      tree.root.findAllByProps({ testID: 'copy-entry-quick-next-day' })[0].props.onPress();
    });
    act(() => {
      tree.root.findAllByProps({ testID: 'copy-entry-confirm' })[0].props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith('2026-02-01');
  });

  it('invokes onClose from the Cancel button', () => {
    const { tree, onClose } = renderModal();

    act(() => {
      tree.root.findAllByProps({ testID: 'copy-entry-cancel' })[0].props.onPress();
    });

    expect(onClose).toHaveBeenCalled();
  });
});
