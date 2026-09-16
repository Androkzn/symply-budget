/**
 * PensionBackfillSheet — the per-month contribution grid. Verifies it (1) pre-fills each
 * month from the server, (2) "Apply to all" fills every month with the same amount, and
 * (3) saves the whole year's per-month self/employer amounts (dollars → cents) at once.
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

const mockGetMonthly = jest.fn();
const mockBackfill = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    getMemberMonthly: (...a: unknown[]) => mockGetMonthly(...a),
    backfillMemberContributions: (...a: unknown[]) => mockBackfill(...a),
  },
}));

jest.mock('@api/households', () => ({
  householdsApi: { get: jest.fn().mockResolvedValue({ members: [] }) },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PensionBackfillSheet } from '../PensionBackfillSheet';

const members = [
  { id: 'm1', display_name: 'Alex', email: 'alex@example.com' },
  { id: 'm2', display_name: 'Sam', email: 'sam@example.com' },
];

// A past year → "Apply to all" fills all 12 months deterministically (no dependence on `now`).
const YEAR = 2020;

async function mount() {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionBackfillSheet
          visible
          householdId="hh-test"
          members={members as never}
          year={YEAR}
          onClose={onClose}
          onSaved={onSaved}
        />
      </ThemeProvider>
    );
  });
  // Flush the pre-fill fetch promise.
  await act(async () => {});
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
const valueOf = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  tree.root.findByProps({ testID }).props.value;

beforeEach(() => {
  jest.clearAllMocks();
  mockBackfill.mockResolvedValue({ account: {} });
  // Jan has data, everything else empty.
  mockGetMonthly.mockResolvedValue({
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      selfCents: i === 0 ? 10000 : 0,
      employerCents: i === 0 ? 5000 : 0,
    })),
  });
});

describe('PensionBackfillSheet', () => {
  it('pre-fills the grid from getMemberMonthly for the selected member/type/year', async () => {
    const { tree } = await mount();
    expect(mockGetMonthly).toHaveBeenCalledWith('hh-test', 'm1', 'rrsp', YEAR);
    expect(valueOf(tree, 'pension-backfill-self-1')).toBe('100');
    expect(valueOf(tree, 'pension-backfill-employer-1')).toBe('50');
    expect(valueOf(tree, 'pension-backfill-self-2')).toBe('');
  });

  it('saves each month\'s self/employer amounts (dollars → cents)', async () => {
    const { tree, onSaved, onClose } = await mount();
    await type(tree, 'pension-backfill-self-3', '200');
    await type(tree, 'pension-backfill-employer-3', '75');
    await press(tree, 'pension-backfill-save');

    expect(mockBackfill).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockBackfill.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(payload.member_id).toBe('m1');
    expect(payload.account_type).toBe('rrsp');
    expect(payload.year).toBe(YEAR);
    expect(payload.entries).toHaveLength(12);
    expect(payload.entries[0]).toEqual({ month: 1, self_cents: 10000, employer_cents: 5000 });
    expect(payload.entries[2]).toEqual({ month: 3, self_cents: 20000, employer_cents: 7500 });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('"Apply to all" fills every month with the same amount, then saves them', async () => {
    const { tree } = await mount();
    await type(tree, 'pension-backfill-fill-self', '300');
    await type(tree, 'pension-backfill-fill-employer', '150');
    await press(tree, 'pension-backfill-apply-all');

    expect(valueOf(tree, 'pension-backfill-self-1')).toBe('300');
    expect(valueOf(tree, 'pension-backfill-self-12')).toBe('300');

    await press(tree, 'pension-backfill-save');
    const [, payload] = mockBackfill.mock.calls[0];
    expect(payload.entries.every((e: { self_cents: number }) => e.self_cents === 30000)).toBe(true);
    expect(payload.entries.every((e: { employer_cents: number }) => e.employer_cents === 15000)).toBe(true);
  });
});
