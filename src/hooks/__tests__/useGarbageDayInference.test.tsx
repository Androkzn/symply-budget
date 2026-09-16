/**
 * `useGarbageDayInference` — the first production caller of the P2 ladder's
 * garbage-day consumer (DoD H7).
 *
 * What is worth locking here is not the ladder (it has ~150 tests of its own)
 * but the WIRING, which is where the H7 gap actually was: an engine nothing
 * imported. So these assert the three things the hook decides —
 *
 *   1. non-local-first builds are untouched and still fall through to the
 *      server (`detect` resolves `null`, `inferGarbageDay` is never called);
 *   2. a Stage-C result becomes the ladder's own member-facing copy, and
 *      never a raw reason code or a method identifier;
 *   3. a Stage-A/B answer is projected into the sheet's existing draft shape,
 *      carrying the municipality forward so the save path cannot overwrite the
 *      member's town with "Unknown".
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { GarbageDayInferenceOutcome } from '@hooks/useGarbageDayInference';
import {
  toDetectedSchedule,
  useGarbageDayInference,
} from '@hooks/useGarbageDayInference';

const mockState = {
  localFirst: true,
  ledger: {
    garbageSchedules: [
      {
        id: 'gs1',
        household_id: 'hh1',
        municipality: 'Burnaby',
        schedules: [],
      },
    ],
  } as Record<string, unknown>,
  result: { stage: 'A', value: null } as unknown,
};

jest.mock('@features/house/local', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockState.localFirst,
  getLocalHouseLedgerFor: jest.fn(async () => mockState.ledger),
  inferGarbageDay: jest.fn(async () => mockState.result),
  // The real copy, so a test that asserts on a sentence is asserting on the
  // sentence a member would actually read.
  getHouseAiUnavailableCopy: (reason: string) =>
    reason === 'no_key'
      ? {
          title: 'Add an AI key to use this',
          message: 'Your home data stays on your devices…',
        }
      : {
          title: 'The assistant cannot answer that yet',
          message: 'Beyond what Symply can work out…',
        },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const local = require('@features/house/local') as {
  getLocalHouseLedgerFor: jest.Mock;
  inferGarbageDay: jest.Mock;
};

/** Render the hook and hand back its current value. */
function renderDetect(): {
  current: ReturnType<typeof useGarbageDayInference>;
} {
  const box = {
    current: null as unknown as ReturnType<typeof useGarbageDayInference>,
  };
  function Harness() {
    box.current = useGarbageDayInference();
    return null;
  }
  act(() => {
    ReactTestRenderer.create(<Harness />);
  });
  return box;
}

const ANSWER = {
  source: 'schedule' as const,
  next: [{ date: '2026-08-20', types: ['garbage'] }],
  streams: [
    { type: 'garbage' as const, frequency: 'weekly' as const, dayOfWeek: 4 },
  ],
  summary: 'Garbage goes out Thu 20 Aug.',
  needsConfirmation: false,
};

describe('useGarbageDayInference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.localFirst = true;
    mockState.ledger = {
      garbageSchedules: [
        {
          id: 'gs1',
          household_id: 'hh1',
          municipality: 'Burnaby',
          schedules: [],
        },
      ],
    };
  });

  it('is disabled and touches nothing on a non-local-first build', async () => {
    mockState.localFirst = false;
    const hook = renderDetect();
    expect(hook.current.enabled).toBe(false);

    let outcome: GarbageDayInferenceOutcome | null = {
      status: 'unavailable',
      title: '',
      message: '',
      reason: 'not_supported',
    };
    await act(async () => {
      outcome = await hook.current.detect('hh1');
    });

    // `null` is the caller's signal to use the server path — and the ladder
    // must not even have been consulted.
    expect(outcome).toBeNull();
    expect(local.getLocalHouseLedgerFor).not.toHaveBeenCalled();
    expect(local.inferGarbageDay).not.toHaveBeenCalled();
  });

  it('renders Stage C as the ladder copy, not a reason code', async () => {
    mockState.result = { stage: 'C', reason: 'no_key' };
    const hook = renderDetect();

    let outcome: GarbageDayInferenceOutcome | null = null;
    await act(async () => {
      outcome = await hook.current.detect('hh1');
    });

    expect(outcome).toEqual({
      status: 'unavailable',
      title: 'Add an AI key to use this',
      message: 'Your home data stays on your devices…',
      // The reason rides along so the sheet can offer the route rather than a
      // third identical Try Again.
      reason: 'no_key',
    });
    // The negative half of DoD H7: nothing machine-shaped is DISPLAYED. Only
    // the two strings the sheet renders are checked — `reason` is deliberately
    // machine-shaped and deliberately never rendered, it exists so the sheet
    // can offer "Add AI provider" instead of a third identical Try Again.
    const shown = outcome as unknown as { title: string; message: string };
    const rendered = `${shown.title}\n${shown.message}`;
    expect(rendered).not.toContain('no_key');
    expect(rendered).not.toContain('garbage-collection.aiDetect');
    expect(rendered).not.toContain('is not available offline yet');
  });

  it('projects a Stage-A answer into the sheet draft and keeps the municipality', async () => {
    mockState.result = { stage: 'A', value: ANSWER };
    const hook = renderDetect();

    let outcome: GarbageDayInferenceOutcome | null = null;
    await act(async () => {
      outcome = await hook.current.detect('hh1');
    });

    expect(outcome).toMatchObject({
      status: 'found',
      draft: {
        municipality: 'Burnaby',
        schedules: ANSWER.streams,
        confidence: 1,
        addressSpecific: false,
        notes: ANSWER.summary,
        sources: [],
      },
    });
    expect(local.inferGarbageDay).toHaveBeenCalledWith({
      ledger: mockState.ledger,
      householdId: 'hh1',
    });
  });

  it('matches the municipality on the household, not on row order', async () => {
    mockState.ledger = {
      garbageSchedules: [
        {
          id: 'gs_other',
          household_id: 'hh_other',
          municipality: 'Toronto',
          schedules: [],
        },
        {
          id: 'gs1',
          household_id: 'hh1',
          municipality: 'Burnaby',
          schedules: [],
        },
      ],
    };
    mockState.result = {
      stage: 'B',
      value: { ...ANSWER, source: 'assistant' },
    };
    const hook = renderDetect();

    let outcome: GarbageDayInferenceOutcome | null = null;
    await act(async () => {
      outcome = await hook.current.detect('hh1');
    });

    // A multi-property device must not label one home with another's town.
    expect(outcome).toMatchObject({
      status: 'found',
      draft: { municipality: 'Burnaby' },
    });
  });
});

describe('toDetectedSchedule', () => {
  it('marks an assistant guess as a best guess, not a fact', () => {
    const draft = toDetectedSchedule(
      { ...ANSWER, source: 'assistant' },
      'Burnaby',
    );
    // The sheet renders 0.4–0.7 as "Best guess — please verify"; a guessed bin
    // day the member acts on unverified costs them a week of rubbish.
    expect(draft.confidence).toBeGreaterThanOrEqual(0.4);
    expect(draft.confidence).toBeLessThan(0.7);
  });

  it('never claims address specificity, on either stage', () => {
    expect(toDetectedSchedule(ANSWER, 'Burnaby').addressSpecific).toBe(false);
    expect(
      toDetectedSchedule({ ...ANSWER, source: 'assistant' }, null)
        .addressSpecific,
    ).toBe(false);
  });
});
