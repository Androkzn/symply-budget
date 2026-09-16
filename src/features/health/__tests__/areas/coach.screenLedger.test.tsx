/**
 * `HealthCoachScreen` — the LEDGER card, the STORED-summary card and the three
 * newest proposal shapes.
 *
 * `screens/__tests__/HealthCoachScreen.test.tsx` owns consent, one turn, the
 * water / weight / meal proposals and the safety grep. This file owns everything
 * the screen grew afterwards, none of which had a case:
 *
 *  - **THE STORED SUMMARY.** The card used to render only what the last
 *    generate returned, so closing the screen lost prose that was in the table
 *    the whole time. It now hydrates from `/body-insights/latest`, and a stored
 *    row and a freshly generated one are DIFFERENT models — the stored one knows
 *    its date and does not know how many sentences were dropped. Both render
 *    through one card, which is what makes it worth pinning that neither branch
 *    invents the other's fields.
 *  - **"WHAT THE COACH HAS LOGGED".** The commit ledger, and the per-operation
 *    receipt behind it. This is the member-facing answer to "what did this thing
 *    do on my behalf", and every word on it is the app's own — `commit_status`
 *    and `target_type` are database columns and must never reach the screen.
 *  - **A PENDING RECEIPT IS SHOWN, NOT HIDDEN.** The ledger is claimed before
 *    the diary write, so pending means "you confirmed this and it did not
 *    finish". Hiding it would leave a member hunting for an entry that was never
 *    written.
 *  - **THE THREE ADDED VERBS.** A workout, a period day and a habit tick can now
 *    be proposed. The habit card has to state what it CANNOT do, because a
 *    toggle that could untick would be a destructive write behind a button
 *    labelled "log".
 *
 * Only the storage-backed async functions are mocked; nothing reaches a model
 * and no case depends on a network.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  confirmProposal,
  generateBodyInsight,
  loadBodyInsightHistory,
  loadCoachConsent,
  loadCoachOperationReceipt,
  loadCoachOperations,
  loadCoachState,
  loadLatestBodyInsight,
  type BodyInsightHistoryEntry,
  type CoachState,
} from '../../healthCoachStorage';
import { HealthCoachScreen } from '../../screens/HealthCoachScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthCoachStorage', () => {
  const actual = jest.requireActual('../../healthCoachStorage');
  return {
    ...actual,
    loadCoachState: jest.fn(),
    loadCoachConsent: jest.fn(),
    setCoachConsent: jest.fn(),
    sendCoachMessage: jest.fn(),
    confirmProposal: jest.fn(),
    dismissProposal: jest.fn(),
    generateBodyInsight: jest.fn(),
    clearCoachTranscript: jest.fn(),
    loadLatestBodyInsight: jest.fn(),
    loadBodyInsightHistory: jest.fn(),
    loadCoachOperations: jest.fn(),
    loadCoachOperationReceipt: jest.fn(),
  };
});

const mockLoadState = loadCoachState as jest.Mock;
const mockLoadConsent = loadCoachConsent as jest.Mock;
const mockInsight = generateBodyInsight as jest.Mock;
const mockLatest = loadLatestBodyInsight as jest.Mock;
const mockHistory = loadBodyInsightHistory as jest.Mock;
const mockOperations = loadCoachOperations as jest.Mock;
const mockReceipt = loadCoachOperationReceipt as jest.Mock;
const mockConfirm = confirmProposal as jest.Mock;

/** A promise the test releases by hand, for asserting the in-flight state. */
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release: (value: T) => release(value) };
}

const EMPTY_STATE: CoachState = { messages: [], insights: [], aiStatus: 'idle' };

const GRANTED = {
  granted: true,
  version: 'health-coach-2',
  granted_at: '2026-07-25T12:00:00.000Z',
  revoked_at: null,
  required_version: 'health-coach-2',
};

function historyEntry(over: Partial<BodyInsightHistoryEntry> = {}): BodyInsightHistoryEntry {
  return {
    id: 'bci_1',
    date: '2026-07-25',
    observations: ['Your waist reads 86.6 cm now, down from 88.'],
    whatToLogNext: [],
    singleReadingSites: [],
    aiWritten: true,
    createdAt: '2026-07-25T10:00:00.000Z',
    ...over,
  };
}

function operation(over: Record<string, unknown> = {}) {
  return {
    operation_id: 'hop_1',
    user_id: 'u_1',
    target_type: 'water',
    target_id: 'h2o_1',
    payload_hash: 'a1b2c3d4',
    commit_status: 'committed',
    result_json: JSON.stringify({ ids: ['h2o_1'] }),
    created_at: '2026-07-25T10:00:00.000Z',
    updated_at: '2026-07-25T10:00:00.000Z',
    ...over,
  };
}

function proposalMessage(payload: Record<string, unknown>, targetType: string) {
  return {
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        text: 'Ready to confirm.',
        createdAt: 'now',
        proposal: {
          operation_id: 'hop_1',
          operation_type: 'create' as const,
          target_type: targetType,
          original_text: 'said so',
          normalized_payload: payload,
          payload_hash: 'a1b2c3d4',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          commit_status: 'proposed' as const,
        },
      },
    ],
    insights: [],
    aiStatus: 'ok',
  };
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthCoachScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance | string) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as never);
  };
  walk(tree.root);
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadState.mockResolvedValue(EMPTY_STATE);
  mockLoadConsent.mockResolvedValue(GRANTED);
  mockLatest.mockResolvedValue(null);
  mockHistory.mockResolvedValue([]);
  mockOperations.mockResolvedValue([]);
});

/* ==================================================================== */
/* The stored summary                                                    */
/* ==================================================================== */

describe('HealthCoachScreen — the stored measurement summary', () => {
  it('HEALTH-AI-617: opening the screen shows the summary already on file', async () => {
    // Before this, the prose existed only in the response that created it: the
    // row was in `body_comprehensive_insights` the whole time with nothing
    // asking for it, so closing the screen lost it.
    mockLatest.mockResolvedValue(historyEntry());
    const tree = await render();

    expect(mockLatest).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({ testID: 'health-coach-body-observations' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('Your waist reads 86.6 cm now, down from 88.');
    // A STORED summary knows which day it describes, so it says so — a summary
    // from a week ago read as today's would be a claim about the wrong body.
    expect(text).toContain('Summary of 2026-07-25');
    // And with something already on screen the button offers to refresh it
    // rather than to make the first one.
    expect(text).toContain('Refresh');
  });

  it('HEALTH-AI-618: a FRESH summary drops the date line — it is about today', async () => {
    mockInsight.mockResolvedValue({
      insight: {
        observations: ['Your waist reads 86.6 cm now.'],
        whatToLogNext: [],
        facts: {},
        aiStatus: 'ok',
        droppedUngrounded: 0,
      },
      outcome: 'generated',
      message: null,
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-body-generate' }).props.onPress();
    });

    expect(tree.root.findAllByProps({ testID: 'health-coach-body-date' })).toHaveLength(0);
    expect(textOf(tree)).toContain('Your waist reads 86.6 cm now.');
  });

  it('HEALTH-AI-619: a stored DETERMINISTIC summary says a model did not write it', async () => {
    // `aiWritten` comes from `analysis_provider`. A reader is entitled to know
    // which they are reading, and the same line has to appear whether the card
    // was hydrated or generated.
    mockLatest.mockResolvedValue(historyEntry({ aiWritten: false }));
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-body-deterministic' })).toBeTruthy();
    expect(textOf(tree)).toContain('the AI was not available');
  });

  it('HEALTH-AI-620: a FAILED refresh keeps the summary that was already there', async () => {
    // The stored summary is still true. Blanking it because the network dropped
    // would lose the member something they already had, on a card whose whole
    // purpose is that it persists.
    mockLatest.mockResolvedValue(historyEntry());
    mockInsight.mockResolvedValue({
      insight: null,
      outcome: 'failed',
      message: 'That could not be generated just now. Please try again.',
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-body-generate' }).props.onPress();
    });

    const text = textOf(tree);
    expect(text).toContain('Your waist reads 86.6 cm now, down from 88.');
    expect(text).toContain('could not be generated just now');
    expect(text).not.toMatch(/Error|undefined|500/);
  });

  it('HEALTH-AI-621: EARLIER summaries stay collapsed until asked for, then open and close', async () => {
    // The head of the list is already the card above, so the toggle only appears
    // once there is a SECOND one — a "(0)" affordance would be an invitation to
    // nothing.
    mockLatest.mockResolvedValue(historyEntry());
    mockHistory.mockResolvedValue([
      historyEntry(),
      historyEntry({
        id: 'bci_0',
        date: '2026-07-18',
        observations: ['Your chest reads 101 cm now.'],
        aiWritten: false,
      }),
    ]);
    const tree = await render();

    const toggle = tree.root.findByProps({ testID: 'health-coach-body-history-toggle' });
    expect(textOf(tree)).toContain('Earlier summaries (1)');
    expect(tree.root.findAllByProps({ testID: 'health-coach-body-history' })).toHaveLength(0);

    await act(async () => {
      toggle.props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'health-coach-body-history-2026-07-18' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('Your chest reads 101 cm now.');
    expect(text).toContain('Written from your readings directly.');
    expect(text).toContain('Hide earlier summaries');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-body-history-toggle' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-coach-body-history' })).toHaveLength(0);
  });

  it('HEALTH-AI-622: a SINGLE stored summary offers no "earlier" affordance at all', async () => {
    mockLatest.mockResolvedValue(historyEntry());
    mockHistory.mockResolvedValue([historyEntry()]);
    const tree = await render();

    expect(
      tree.root.findAllByProps({ testID: 'health-coach-body-history-toggle' })
    ).toHaveLength(0);
  });
});

/* ==================================================================== */
/* The ledger                                                            */
/* ==================================================================== */

describe('HealthCoachScreen — what the coach has logged', () => {
  it('HEALTH-AI-623: an empty ledger explains itself and states the coach cannot write alone', async () => {
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-operations-empty' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('WHAT THE COACH HAS LOGGED');
    // The claim that matters: nothing reaches this list without a tap.
    expect(text).toContain('The coach cannot save');
    expect(text).toContain('nothing reaches this list without your tap');
  });

  it('HEALTH-AI-624: a committed row is named in the app\'s OWN words, never the column', async () => {
    mockOperations.mockResolvedValue([
      operation({ operation_id: 'hop_w', target_type: 'workout' }),
      operation({
        operation_id: 'hop_n',
        target_type: 'nutrition',
        result_json: JSON.stringify({ ids: ['n1', 'n2'] }),
      }),
    ]);
    const tree = await render();

    const text = textOf(tree);
    expect(text).toContain('Workout');
    expect(text).toContain('Food diary');
    expect(text).toContain('Saved');
    // A meal is several diary rows from ONE confirmation, so the count is shown.
    expect(text).toContain('2 entries');
    // And nothing prints a raw column value.
    expect(text).not.toMatch(/\bnutrition\b|\bcommitted\b|hop_w/);
  });

  it('HEALTH-AI-625: a PENDING row is SHOWN and says nothing was saved', async () => {
    // The ledger is claimed before the diary write, so pending means "you
    // confirmed this and it did not finish". Hiding it would leave the member
    // hunting for an entry that was never written.
    mockOperations.mockResolvedValue([
      operation({ operation_id: 'hop_p', commit_status: 'pending', result_json: null }),
    ]);
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-operation-hop_p' })).toBeTruthy();
    expect(textOf(tree)).toContain('nothing was saved for this one');
  });

  it('HEALTH-AI-626: a row opens its receipt, and closing it collapses again', async () => {
    mockOperations.mockResolvedValue([operation()]);
    mockReceipt.mockResolvedValue(operation());
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-operation-toggle-hop_1' }).props.onPress();
    });

    expect(mockReceipt).toHaveBeenCalledWith('hop_1');
    expect(tree.root.findByProps({ testID: 'health-coach-operation-receipt' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('Confirmed 2026-07-25');
    // The receipt says what to do next with what was written.
    expect(text).toContain('Wrote 1 entry, which you can edit or delete on the normal screens.');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-operation-toggle-hop_1' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-coach-operation-receipt' })).toHaveLength(0);
  });

  it('HEALTH-AI-627: a receipt in flight says Loading rather than showing an empty panel', async () => {
    mockOperations.mockResolvedValue([operation()]);
    const pending = deferred<unknown>();
    mockReceipt.mockReturnValue(pending.promise);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-operation-toggle-hop_1' }).props.onPress();
    });
    expect(textOf(tree)).toContain('Loading…');

    await act(async () => {
      pending.release(operation());
    });
    expect(textOf(tree)).not.toContain('Loading…');
  });

  it('HEALTH-AI-628: an unreachable receipt says so, and never implies a permission problem', async () => {
    // A missing id, an id on another account and a dead network are ONE answer
    // on purpose — the Worker 404s for the first two so that an id cannot be
    // probed for existence. The copy must not try to tell them apart.
    mockOperations.mockResolvedValue([operation()]);
    mockReceipt.mockResolvedValue(null);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-operation-toggle-hop_1' }).props.onPress();
    });

    expect(
      tree.root.findByProps({ testID: 'health-coach-operation-receipt-missing' })
    ).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('That receipt could not be loaded');
    expect(text).not.toMatch(/permission|not allowed|forbidden|403|404/i);
  });

  it('HEALTH-AI-629b: a receipt for a MEAL counts the rows it became, in the plural', async () => {
    // One confirmation, several diary rows. The count is the answer to "why are
    // there three entries for the sandwich I told it about once", and it has to
    // read as English rather than "Wrote 3 entry".
    mockOperations.mockResolvedValue([
      operation({ target_type: 'nutrition', result_json: JSON.stringify({ ids: ['a', 'b', 'c'] }) }),
    ]);
    mockReceipt.mockResolvedValue(
      operation({ target_type: 'nutrition', result_json: JSON.stringify({ ids: ['a', 'b', 'c'] }) })
    );
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-operation-toggle-hop_1' }).props.onPress();
    });
    expect(textOf(tree)).toContain(
      'Wrote 3 entries, which you can edit or delete on the normal screens.'
    );
  });

  it('HEALTH-AI-629: a receipt for a row that wrote NOTHING says so plainly', async () => {
    // The pending case. Omitting the line would leave the member reading a
    // receipt for an entry that does not exist.
    mockOperations.mockResolvedValue([
      operation({ commit_status: 'pending', result_json: null }),
    ]);
    mockReceipt.mockResolvedValue(operation({ commit_status: 'pending', result_json: null }));
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-operation-toggle-hop_1' }).props.onPress();
    });
    expect(textOf(tree)).toContain('No entry was written for this one.');
  });

  it('HEALTH-AI-630: confirming a proposal RE-READS the ledger so the receipt appears at once', async () => {
    // A member who confirms something and looks straight down at the list would
    // otherwise see it missing until the next open, which reads as the write
    // having failed.
    mockLoadState.mockResolvedValue(
      proposalMessage({ kind: 'water', amount_ml: 500 }, 'water')
    );
    mockConfirm.mockResolvedValue({ state: EMPTY_STATE, outcome: 'saved', message: null });
    mockOperations.mockResolvedValueOnce([]).mockResolvedValue([operation()]);
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-operations-empty' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-proposal-confirm' }).props.onPress();
    });

    expect(mockOperations).toHaveBeenCalledTimes(2);
    expect(tree.root.findByProps({ testID: 'health-coach-operation-hop_1' })).toBeTruthy();
  });

  it('HEALTH-AI-631: a REFUSED confirmation does not re-read the ledger', async () => {
    // Nothing was written, so there is nothing new to show — and a second read
    // on every failure would hammer the route from a retry loop.
    mockLoadState.mockResolvedValue(
      proposalMessage({ kind: 'water', amount_ml: 500 }, 'water')
    );
    mockConfirm.mockResolvedValue({
      state: EMPTY_STATE,
      outcome: 'failed',
      message: 'That could not be saved just now. Please try again.',
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-proposal-confirm' }).props.onPress();
    });

    expect(mockOperations).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain('could not be saved just now');
  });
});

/* ==================================================================== */
/* The three added proposal shapes                                       */
/* ==================================================================== */

describe('HealthCoachScreen — workout, period and habit proposals', () => {
  it('HEALTH-AI-632: a WORKOUT card prints the figures and refuses to invent a burn', async () => {
    mockLoadState.mockResolvedValue(
      proposalMessage(
        {
          kind: 'workout',
          workout_type: 'Running',
          minutes: 32,
          calories: null,
          note: null,
          intensity: null,
        },
        'workout'
      )
    );
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-proposal-workout' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('Running');
    expect(text).toContain('32');
    // "not recorded" rather than 0 kcal — a zero burn is a claim nobody made.
    expect(text).toContain('Calories burned not recorded');
    expect(text).not.toContain('0 kcal burned');
    // And with no effort stated the card does not invent one.
    expect(text).not.toMatch(/\bFelt (easy|steady|hard|max)\b/);
    expect(text).not.toMatch(/\bnull\b|\bundefined\b/);
  });

  it('HEALTH-AI-633: a workout that DOES carry a burn, an effort and a note prints all three', async () => {
    mockLoadState.mockResolvedValue(
      proposalMessage(
        {
          kind: 'workout',
          workout_type: 'Rowing',
          minutes: 20,
          calories: 210,
          note: 'river loop',
          intensity: 'hard',
        },
        'workout'
      )
    );
    const tree = await render();

    // `textOf` joins every text node with a space, and JSX interpolation splits
    // `Felt {intensity}` into two — so the phrase is matched with flexible
    // whitespace rather than as one rendered string.
    const text = textOf(tree);
    expect(text).toContain('210 kcal burned');
    expect(text).toMatch(/Felt\s+hard/);
    expect(text).toContain('river loop');
  });

  it('HEALTH-AI-634: a PERIOD card names the flow in words, never as a bare level', async () => {
    // `flow_level` is a 1–5 column. "Level 3" on a card about someone's body is
    // a database value; the label is what they logged it as on the Cycle screen.
    mockLoadState.mockResolvedValue(
      proposalMessage({ kind: 'period', flow_level: 2, notes: 'light so far' }, 'period')
    );
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-proposal-period' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('Period day');
    expect(text).toContain('light so far');
    expect(text).not.toContain('Level 2');
  });

  it('HEALTH-AI-635: a period level this build does not know still renders something readable', async () => {
    // The label table is indexed by the level. A Worker that widened the scale
    // must not produce a blank line where the flow should be.
    mockLoadState.mockResolvedValue(
      proposalMessage({ kind: 'period', flow_level: 9, notes: null }, 'period')
    );
    const tree = await render();

    const text = textOf(tree);
    expect(text).toContain('Level 9');
    expect(text).not.toMatch(/\bundefined\b/);
  });

  it('HEALTH-AI-636: a HABIT card names the habit and states it can never untick', async () => {
    // The server enforces mark-done-only; the card states it. A toggle that
    // could untick would be a destructive write behind a button labelled "log",
    // and the person confirming has to know which of the two they are agreeing
    // to.
    mockLoadState.mockResolvedValue(
      proposalMessage(
        { kind: 'habit', habit_id: 'habit_med', habit_name: 'Meditate' },
        'habit'
      )
    );
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-proposal-habit' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toMatch(/Tick\s+Meditate\s+for today/);
    expect(text).toContain('It can never untick a habit.');
    // The id is an internal handle and is never shown.
    expect(text).not.toContain('habit_med');
  });

  it('HEALTH-AI-637: the consent card names every verb the coach can OFFER to write', async () => {
    // `COACH_CONSENT_VERSION` moved to `health-coach-2` for exactly this
    // paragraph: the v1 words described reads only, and the coach could log
    // three things. It can now log six, including a period day. A consent is
    // only meaningful against the words it was given for, so the words have to
    // list them.
    mockLoadConsent.mockResolvedValue({ ...GRANTED, granted: false });
    const tree = await render();

    const logging = tree.root.findByProps({ testID: 'health-coach-consent-logging' });
    const said = JSON.stringify(logging.props);
    const missing = ['water', 'weight', 'food', 'workout', 'period day', 'habit tick'].filter(
      (verb) => !said.includes(verb)
    );
    expect(missing).toEqual([]);
    // …and that none of them happens without a tap.
    expect(said).toContain('cannot save anything by itself');
    expect(said).toContain('never untick');

    // The read scope now names habits too, and STILL excludes the cycle log —
    // both halves are true: the coach can add a day you describe to it, and it
    // cannot look at the log.
    const scope = JSON.stringify(
      tree.root.findByProps({ testID: 'health-coach-consent-scope' }).props
    );
    expect(scope).toContain('names of your habits');
    expect(scope).toContain('does not read your cycle log');
  });
});
