/**
 * PensionEntrySheet — the one reusable add/edit sheet for the simple Pension flow.
 * Verifies each mode routes to the right API with the right payload (dollars → cents,
 * goal %, manual contribution) and marks the caller dirty on success.
 */

// Render the sheet body inline (BottomSheet is a Modal/portal in the real app).
jest.mock('@components/ui', () => {
  const actual = jest.requireActual('@components/ui');
  return {
    ...actual,
    BottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? children : null,
  };
});

const mockSetMemberLine = jest.fn();
const mockAddContribution = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    setMemberLine: (...a: unknown[]) => mockSetMemberLine(...a),
    addMemberContribution: (...a: unknown[]) => mockAddContribution(...a),
  },
}));

// Members are passed via prop here; stub the roster fetch so it's never network-bound.
jest.mock('@api/households', () => ({
  householdsApi: { get: jest.fn().mockResolvedValue({ members: [] }) },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PensionEntrySheet, type PensionEntryMode } from '../PensionEntrySheet';

const members = [
  { id: 'm1', display_name: 'Alex', email: 'alex@example.com' },
  { id: 'm2', display_name: 'Sam', email: 'sam@example.com' },
];

async function mount(mode: PensionEntryMode, extra?: Partial<React.ComponentProps<typeof PensionEntrySheet>>) {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionEntrySheet
          visible
          mode={mode}
          householdId="hh-test"
          members={members as never}
          onClose={onClose}
          onSaved={onSaved}
          {...extra}
        />
      </ThemeProvider>
    );
  });
  return { tree, onSaved, onClose };
}

async function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, value: string) {
  await act(async () => tree.root.findByProps({ testID }).props.onChangeText(value));
}
async function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    await tree.root.findByProps({ testID }).props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetMemberLine.mockResolvedValue({ account: {} });
  mockAddContribution.mockResolvedValue({ account: {}, transaction: {} });
});

describe('PensionEntrySheet', () => {
  it('room mode saves setMemberLine with room_cents (dollars → cents) and marks dirty', async () => {
    const { tree, onSaved, onClose } = await mount('room');
    await type(tree, 'pension-entry-primary', '15,000');
    await press(tree, 'pension-entry-save');

    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      room_cents: 1500000,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('goal mode (percent) saves goal_pct and clears goal_cents', async () => {
    const { tree } = await mount('goal');
    await press(tree, 'pension-entry-goalmode-percent');
    await type(tree, 'pension-entry-primary', '80');
    await press(tree, 'pension-entry-save');

    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      goal_pct: 80,
      goal_cents: null,
    });
  });

  it('goal mode (percent) previews the dollar goal (pct × room base) live', async () => {
    // m1/rrsp room base = $25,000 (2_500_000 cents); 80% → $20,000.00.
    const { tree } = await mount('goal', { goalBases: { 'm1:rrsp': 2_500_000 } });
    await press(tree, 'pension-entry-goalmode-percent');
    const preview = () => tree.root.findByProps({ testID: 'pension-entry-goal-preview' }).props.children;

    expect(preview()).toBe('—'); // nothing typed yet
    await type(tree, 'pension-entry-primary', '80');
    // Grouped, in the display currency — the sheet formats through @utils/money
    // rather than a local `toFixed(2)` that printed "$20000.00".
    expect(preview()).toBe('$20,000.00');
  });

  it('goal mode (percent) shows an em-dash when the room base is unknown', async () => {
    const { tree } = await mount('goal'); // no goalBases → no base for m1/rrsp
    await press(tree, 'pension-entry-goalmode-percent');
    await type(tree, 'pension-entry-primary', '80');
    expect(
      tree.root.findByProps({ testID: 'pension-entry-goal-preview' }).props.children
    ).toBe('—');
  });

  it('contribution mode (self only) posts addMemberContribution with contributor self', async () => {
    const { tree } = await mount('contribution');
    await press(tree, 'pension-entry-member-m2');
    await press(tree, 'pension-entry-type-tfsa');
    await type(tree, 'pension-entry-primary', '250');
    await press(tree, 'pension-entry-save');

    expect(mockAddContribution).toHaveBeenCalledWith('hh-test', {
      member_id: 'm2',
      account_type: 'tfsa',
      amount_cents: 25000,
      contributor: 'self',
    });
  });

  it('contribution mode with employer match defaults employer to the member amount', async () => {
    const { tree } = await mount('contribution');
    await type(tree, 'pension-entry-primary', '250');
    // Turn on the employer portion — "Match my contribution" is on by default.
    await act(async () =>
      tree.root.findByProps({ testID: 'pension-entry-employer-toggle' }).props.onValueChange(true)
    );
    await press(tree, 'pension-entry-save');

    expect(mockAddContribution).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      amount_cents: 25000,
      contributor: 'self',
      employer_amount_cents: 25000,
    });
  });

  it('contribution mode with a custom employer amount sends that figure', async () => {
    const { tree } = await mount('contribution');
    await type(tree, 'pension-entry-primary', '250');
    await act(async () =>
      tree.root.findByProps({ testID: 'pension-entry-employer-toggle' }).props.onValueChange(true)
    );
    // Turn "match" off to reveal the custom employer field.
    await act(async () =>
      tree.root.findByProps({ testID: 'pension-entry-employer-match-toggle' }).props.onValueChange(false)
    );
    await type(tree, 'pension-entry-employer-match', '100');
    await press(tree, 'pension-entry-save');

    expect(mockAddContribution).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      amount_cents: 25000,
      contributor: 'self',
      employer_amount_cents: 10000,
    });
  });

  it('recurring mode saves both the self amount and the custom employer match', async () => {
    const { tree } = await mount('recurring');
    await type(tree, 'pension-entry-primary', '500');
    await type(tree, 'pension-entry-employer-match', '250');
    await press(tree, 'pension-entry-save');

    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      regular_contribution_cents: 50000,
      employer_match_cents: 25000,
    });
  });

  it('recurring mode with "match my contribution" mirrors the self amount into the employer match', async () => {
    const { tree } = await mount('recurring');
    await type(tree, 'pension-entry-primary', '500');
    await act(async () =>
      tree.root.findByProps({ testID: 'pension-entry-employer-match-toggle' }).props.onValueChange(true)
    );
    await press(tree, 'pension-entry-save');

    expect(mockSetMemberLine).toHaveBeenCalledWith('hh-test', {
      member_id: 'm1',
      account_type: 'rrsp',
      regular_contribution_cents: 50000,
      employer_match_cents: 50000,
    });
  });
});
