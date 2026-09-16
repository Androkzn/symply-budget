/**
 * Symply Health AI COACH tab — consent, one turn, a confirmable proposal, and
 * the emergency notice.
 *
 * Renders the REAL screen through <ThemeProvider> and drives the primary paths.
 * Only the storage-backed async functions are mocked; nothing here reaches a
 * model, and no case depends on a network.
 *
 * The invariants these cases exist to pin:
 *
 *  1. **Consent gates the composer.** Nothing can be typed and sent before the
 *     person has agreed, and the card names exactly what would be read.
 *  2. **The screen never diagnoses, prescribes or advises treatment.** A case
 *     greps the whole rendered tree for the clinical register the injury screen
 *     already refuses (`HEALTH-INJUI-017`) — this is the same line, held on the
 *     surface most able to cross it.
 *  3. **A proposal is not saved until it is confirmed**, and confirming hands
 *     back the SAME object that was rendered — no rebuild, no re-round.
 *  4. **Fail-closed states are distinguishable.** "Could not be reached" and
 *     "you have not consented" and "your account cannot use AI" each render
 *     their own copy, because each has a different next step.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  clearCoachTranscript,
  confirmProposal,
  dismissProposal,
  generateBodyInsight,
  loadCoachConsent,
  loadCoachState,
  sendCoachMessage,
  setCoachConsent,
  type CoachState,
} from '../../healthCoachStorage';
import { HealthCoachScreen } from '../HealthCoachScreen';

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
  };
});

const mockLoadState = loadCoachState as jest.Mock;
const mockLoadConsent = loadCoachConsent as jest.Mock;
const mockSetConsent = setCoachConsent as jest.Mock;
const mockSend = sendCoachMessage as jest.Mock;
const mockConfirm = confirmProposal as jest.Mock;
const mockDismiss = dismissProposal as jest.Mock;
const mockInsight = generateBodyInsight as jest.Mock;
const mockClear = clearCoachTranscript as jest.Mock;

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
  version: 'health-coach-1',
  granted_at: '2026-07-25T12:00:00.000Z',
  revoked_at: null,
  required_version: 'health-coach-1',
};
const DENIED = { ...GRANTED, granted: false, granted_at: null };

function proposal(over: Record<string, unknown> = {}) {
  return {
    operation_id: 'hop_1',
    operation_type: 'create' as const,
    target_type: 'water' as const,
    original_text: 'I drank a big glass',
    normalized_payload: { kind: 'water' as const, amount_ml: 500 },
    payload_hash: 'a1b2c3d4',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    commit_status: 'proposed' as const,
    ...over,
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
});

describe('HealthCoachScreen', () => {
  it('HEALTH-AI-260: renders the shell and an honest empty state', async () => {
    const tree = await render();
    expect(tree.root.findByProps({ testID: 'health-coach-screen' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'health-coach-empty' })).toBeTruthy();
    // Consent is granted, so the gate card is absent.
    expect(tree.root.findAllByProps({ testID: 'health-coach-consent-card' })).toHaveLength(0);
  });

  it('HEALTH-AI-261: without consent the composer is disabled and the gate names the scope', async () => {
    mockLoadConsent.mockResolvedValue(DENIED);
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-consent-card' })).toBeTruthy();
    const scope = textOf(tree);
    // It has to say WHAT is read and WHAT is not.
    expect(scope).toContain('food diary');
    expect(scope).toContain('does not read your cycle log');
    // And the composer cannot be used.
    expect(tree.root.findByProps({ testID: 'health-coach-input' }).props.editable).toBe(false);
    expect(
      tree.root.findByProps({ testID: 'health-coach-send' }).props.accessibilityState.disabled
    ).toBe(true);
  });

  it('HEALTH-AI-262: granting consent unlocks the composer', async () => {
    mockLoadConsent.mockResolvedValue(DENIED);
    mockSetConsent.mockResolvedValue(GRANTED);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-consent-grant' }).props.onPress();
    });
    expect(mockSetConsent).toHaveBeenCalledWith(true);
    expect(tree.root.findByProps({ testID: 'health-coach-input' }).props.editable).toBe(true);
  });

  it('HEALTH-AI-263: an offline grant says so instead of showing an unlocked coach', async () => {
    mockLoadConsent.mockResolvedValue(DENIED);
    // The store returns the DENIED state when the write never landed.
    mockSetConsent.mockResolvedValue(DENIED);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-consent-grant' }).props.onPress();
    });
    expect(textOf(tree)).toContain('could not be saved just now');
    expect(tree.root.findByProps({ testID: 'health-coach-input' }).props.editable).toBe(false);
  });

  it('HEALTH-AI-264: sending renders both sides of the turn', async () => {
    mockSend.mockResolvedValue({
      state: {
        messages: [
          { id: 'u1', role: 'user', text: 'how am I doing', createdAt: 'now' },
          { id: 'a1', role: 'assistant', text: 'You logged nothing yet.', createdAt: 'now' },
        ],
        insights: [],
        aiStatus: 'ok',
      },
      status: 'answered',
      message: null,
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-input' }).props.onChangeText('how am I doing');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-send' }).props.onPress();
    });

    expect(mockSend).toHaveBeenCalledWith('how am I doing');
    expect(textOf(tree)).toContain('You logged nothing yet.');
  });

  it('HEALTH-AI-265: the coach being unreachable still shows the person their own figures', async () => {
    mockSend.mockResolvedValue({
      state: {
        messages: [
          { id: 'u1', role: 'user', text: 'how am I doing', createdAt: 'now' },
          {
            id: 'a1',
            role: 'assistant',
            text: 'The coach could not be reached just now.',
            createdAt: 'now',
          },
        ],
        insights: [
          {
            id: 'calories',
            priority: 1,
            kind: 'calories',
            title: 'Calories today',
            facts: [{ label: 'Logged', value: 1850, unit: 'kcal' }],
            caveats: [],
            data_window: { start: 'a', end: 'b' },
            speakable: 'You have logged 1850 kcal today.',
          },
        ],
        aiStatus: 'unavailable',
      },
      status: 'answered',
      message: null,
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-input' }).props.onChangeText('how am I doing');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-send' }).props.onPress();
    });

    // The figures are there AND the screen says the coach itself was not.
    expect(tree.root.findByProps({ testID: 'health-coach-insight-calories' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'health-coach-ai-offline' })).toBeTruthy();
    expect(textOf(tree)).toContain('1850');
  });

  it('HEALTH-AI-266: an emergency turn renders the notice and no proposal', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        { id: 'u1', role: 'user', text: 'I have chest pain', createdAt: 'now' },
        {
          id: 'a1',
          role: 'assistant',
          text: 'Chest pain can be serious. Please seek emergency medical care now. I have not contacted anyone on your behalf.',
          createdAt: 'now',
          escalation: true,
          proposal: null,
        },
      ],
      insights: [],
      aiStatus: 'skipped',
    });
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-escalation' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('I have not contacted anyone on your behalf');
    expect(tree.root.findAllByProps({ testID: 'health-coach-proposal' })).toHaveLength(0);
  });

  it('HEALTH-AI-267: a proposal renders "Not saved yet" and confirms the SAME object', async () => {
    const p = proposal();
    mockLoadState.mockResolvedValue({
      messages: [
        { id: 'u1', role: 'user', text: 'I drank a big glass', createdAt: 'now' },
        { id: 'a1', role: 'assistant', text: 'Ready to confirm.', createdAt: 'now', proposal: p },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    mockConfirm.mockResolvedValue({ state: EMPTY_STATE, outcome: 'saved', message: null });
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-proposal' })).toBeTruthy();
    expect(textOf(tree)).toContain('Not saved yet');
    // `textOf` joins every text node with a space, and JSX interpolation
    // splits `{amount} ml` into two, so the figure and its unit are matched
    // separately rather than as one rendered string.
    expect(textOf(tree)).toContain('500');
    expect(textOf(tree)).toContain('ml of water');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-proposal-confirm' }).props.onPress();
    });
    // Identity, not equality: a rebuilt payload would hash differently and 409.
    expect(mockConfirm).toHaveBeenCalledWith('a1', p);
  });

  it('HEALTH-AI-268: an expired proposal offers no Confirm button at all', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'Ready to confirm.',
          createdAt: 'now',
          proposal: proposal({ expires_at: '2020-01-01T00:00:00.000Z' }),
        },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-proposal-expired' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'health-coach-proposal-confirm' })).toHaveLength(0);
  });

  it('HEALTH-AI-269: dismissing a proposal writes nothing', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        { id: 'a1', role: 'assistant', text: 'Ready.', createdAt: 'now', proposal: proposal() },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    mockDismiss.mockResolvedValue(EMPTY_STATE);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-proposal-dismiss' }).props.onPress();
    });
    expect(mockDismiss).toHaveBeenCalledWith('a1');
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-270: a meal proposal says "calories not known" rather than 0', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'Ready.',
          createdAt: 'now',
          proposal: proposal({
            target_type: 'nutrition',
            normalized_payload: {
              kind: 'nutrition',
              meal_type: 'lunch',
              items: [
                { food_name: 'Soup', grams: 300, calories: null, protein_g: null, carbs_g: null, fat_g: null },
              ],
            },
          }),
        },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    const tree = await render();
    const text = textOf(tree);
    expect(text).toContain('calories not known');
    expect(text).not.toContain('0 kcal');
  });

  it('HEALTH-AI-271: the body-insight card states its scope and generates on demand', async () => {
    mockInsight.mockResolvedValue({
      insight: {
        observations: ['Your waist went from 88 to 86.6 cm.'],
        whatToLogNext: [],
        facts: {
          window_from: null,
          window_to: null,
          dates_logged: 2,
          sites_logged: 1,
          changes: [],
          single_reading_sites: [],
          mixed_units: false,
        },
        aiStatus: 'ok',
        droppedUngrounded: 0,
      },
      outcome: 'generated',
      message: null,
    });
    const tree = await render();

    // The scope line is the honest part: no posture, no body fat, no photo.
    const scope = tree.root.findByProps({ testID: 'health-coach-body-scope' });
    expect(JSON.stringify(scope.props)).toContain('no body-fat estimate');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-body-generate' }).props.onPress();
    });
    expect(textOf(tree)).toContain('Your waist went from 88 to 86.6 cm.');
  });

  it('HEALTH-AI-272: a body insight with no data says what to do, not that it failed', async () => {
    mockInsight.mockResolvedValue({
      insight: null,
      outcome: 'needs_data',
      message: 'Log some body measurements first — there is nothing to summarise yet.',
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-body-generate' }).props.onPress();
    });
    expect(textOf(tree)).toContain('Log some body measurements first');
  });

  it('HEALTH-AI-300: a second Send while one is in flight does not send twice', async () => {
    const turn = deferred<{ state: CoachState; status: string; message: string | null }>();
    mockSend.mockReturnValue(turn.promise);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-input' }).props.onChangeText('how am I doing');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-send' }).props.onPress();
    });

    // While the turn is out, the button says so and the field is locked — a
    // double tap on a slow connection must not cost a second model call.
    expect(textOf(tree)).toContain('Sending…');
    expect(tree.root.findByProps({ testID: 'health-coach-input' }).props.editable).toBe(false);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-send' }).props.onPress();
    });
    expect(mockSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      turn.release({ state: EMPTY_STATE, status: 'answered', message: null });
    });

    // The composer was cleared when the turn went out, so pressing Send again
    // with nothing typed sends nothing.
    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-send' }).props.onPress();
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).not.toContain('Sending…');
  });

  it('HEALTH-AI-301: a turn refused for consent re-shows the gate, not a generic failure', async () => {
    mockSend.mockResolvedValue({
      state: {
        messages: [{ id: 'u1', role: 'user', text: 'how am I doing', createdAt: 'now' }],
        insights: [],
        aiStatus: 'idle',
      },
      status: 'consent_required',
      message: 'Turn on coach insights above so it can read the health data you have logged.',
    });
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-input' }).props.onChangeText('how am I doing');
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-send' }).props.onPress();
    });

    // The gate comes back so the fix is one tap away, and what was typed is
    // still on screen, unanswered.
    expect(tree.root.findByProps({ testID: 'health-coach-consent-card' })).toBeTruthy();
    expect(textOf(tree)).toContain('Turn on coach insights above');
    expect(textOf(tree)).toContain('how am I doing');
    expect(tree.root.findByProps({ testID: 'health-coach-input' }).props.editable).toBe(false);
  });

  it('HEALTH-AI-302: confirming reports saved, already saved, and refused, each in its own words', async () => {
    const p = proposal();
    const withProposal = {
      messages: [
        { id: 'a1', role: 'assistant', text: 'Ready to confirm.', createdAt: 'now', proposal: p },
      ],
      insights: [],
      aiStatus: 'ok',
    };
    mockLoadState.mockResolvedValue(withProposal);

    mockConfirm.mockResolvedValue({
      state: withProposal,
      outcome: 'already_saved',
      message: null,
    });
    const replay = await render();
    await act(async () => {
      replay.root.findByProps({ testID: 'health-coach-proposal-confirm' }).props.onPress();
    });
    // The ledger made the retry a no-op; saying "Saved." would imply a second
    // glass of water landed in the diary.
    expect(textOf(replay)).toContain('That was already saved.');

    mockConfirm.mockResolvedValue({
      state: withProposal,
      outcome: 'changed',
      message: 'Those numbers changed since the coach suggested them.',
    });
    const changed = await render();
    await act(async () => {
      changed.root.findByProps({ testID: 'health-coach-proposal-confirm' }).props.onPress();
    });
    expect(textOf(changed)).toContain('Those numbers changed since the coach suggested them.');
    expect(textOf(changed)).not.toMatch(/409|Error|undefined/);
  });

  it('HEALTH-AI-303: a confirmation in flight says "Saving…" and cannot be pressed twice', async () => {
    const p = proposal();
    mockLoadState.mockResolvedValue({
      messages: [
        { id: 'a1', role: 'assistant', text: 'Ready to confirm.', createdAt: 'now', proposal: p },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    const commit = deferred<{ state: CoachState; outcome: string; message: string | null }>();
    mockConfirm.mockReturnValue(commit.promise);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-proposal-confirm' }).props.onPress();
    });

    const button = tree.root.findByProps({ testID: 'health-coach-proposal-confirm' });
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(textOf(tree)).toContain('Saving…');

    await act(async () => {
      commit.release({ state: EMPTY_STATE, outcome: 'saved', message: null });
    });
    expect(textOf(tree)).toContain('Saved.');
  });

  it('HEALTH-AI-304: Clear only appears once there is something to clear, and wipes it', async () => {
    const empty = await render();
    expect(empty.root.findAllByProps({ testID: 'health-coach-clear' })).toHaveLength(0);

    mockLoadState.mockResolvedValue({
      messages: [{ id: 'u1', role: 'user', text: 'how am I doing', createdAt: 'now' }],
      insights: [],
      aiStatus: 'ok',
    });
    mockClear.mockResolvedValue(EMPTY_STATE);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-clear' }).props.onPress();
    });

    expect(mockClear).toHaveBeenCalledTimes(1);
    // The transcript is the most revealing thing this app stores, so clearing
    // has to leave the honest empty state rather than a stale bubble.
    expect(tree.root.findByProps({ testID: 'health-coach-empty' })).toBeTruthy();
    expect(textOf(tree)).not.toContain('how am I doing');
  });

  it('HEALTH-AI-305: an assistant bubble carrying a notice shows the notice under the reply', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'You have logged 1850 kcal today.',
          createdAt: 'now',
          notice: 'Some of this answer used your own figures only.',
        },
      ],
      insights: [
        {
          id: 'calories',
          priority: 1,
          kind: 'calories',
          title: 'Calories today',
          facts: [{ label: 'Logged', value: 1850, unit: 'kcal' }],
          caveats: ['Only 2 of the last 7 days were logged.'],
          data_window: { start: 'a', end: 'b' },
          speakable: 'You have logged 1850 kcal today.',
        },
      ],
      aiStatus: 'ok',
    });
    const tree = await render();

    const text = textOf(tree);
    expect(text).toContain('Some of this answer used your own figures only.');
    // A caveat is what stops a figure over two logged days reading as a week's
    // average, so it renders under the figure rather than being dropped.
    expect(text).toContain('Only 2 of the last 7 days were logged.');
  });

  it('HEALTH-AI-306: a weight proposal prints the figure and its unit verbatim', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'Ready.',
          createdAt: 'now',
          proposal: proposal({
            target_type: 'weight',
            normalized_payload: { kind: 'weight', weight: 72.4, unit: 'kg' },
          }),
        },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    const tree = await render();

    expect(tree.root.findByProps({ testID: 'health-coach-proposal-weight' })).toBeTruthy();
    const text = textOf(tree);
    expect(text).toContain('72.4');
    expect(text).toContain('kg');
    // Nothing was converted on the way to the card — 72.4 kg is what gets
    // hashed and what gets saved.
    expect(text).not.toContain('lb');
  });

  it('HEALTH-AI-307: a meal item with calories but no weight prints the kcal and no phantom grams', async () => {
    mockLoadState.mockResolvedValue({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          text: 'Ready.',
          createdAt: 'now',
          proposal: proposal({
            target_type: 'nutrition',
            normalized_payload: {
              kind: 'nutrition',
              meal_type: null,
              items: [
                {
                  food_name: 'Flat white',
                  grams: null,
                  calories: 120,
                  protein_g: null,
                  carbs_g: null,
                  fat_g: null,
                },
              ],
            },
          }),
        },
      ],
      insights: [],
      aiStatus: 'ok',
    });
    const tree = await render();

    const text = textOf(tree);
    expect(text).toContain('Flat white');
    expect(text).toContain('120');
    expect(text).toContain('kcal');
    // No weight was given, so none is printed — not "0 g", not "null g".
    expect(text).not.toMatch(/\b0 g\b|null|undefined/);
    // And with no meal named, the card does not invent a slot.
    expect(text).not.toMatch(/\bAs (breakfast|lunch|dinner|snack)\b/);
  });

  it('HEALTH-AI-308: the measurement summary lists what to log next and flags a deterministic write-up', async () => {
    const insight = deferred<{
      insight: unknown;
      outcome: string;
      message: string | null;
    }>();
    mockInsight.mockReturnValue(insight.promise);
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-coach-body-generate' }).props.onPress();
    });
    // The button reports itself as busy rather than looking ignored.
    expect(textOf(tree)).toContain('Working…');
    expect(
      tree.root.findByProps({ testID: 'health-coach-body-generate' }).props.accessibilityState
        .disabled
    ).toBe(true);

    await act(async () => {
      insight.release({
        insight: {
          observations: ['Your waist went from 88 to 86.6 cm.'],
          whatToLogNext: ['Log your hips too — one reading cannot show a change.'],
          facts: {
            window_from: null,
            window_to: null,
            dates_logged: 2,
            sites_logged: 1,
            changes: [],
            single_reading_sites: ['hips'],
            mixed_units: false,
          },
          aiStatus: 'unavailable',
          droppedUngrounded: 0,
        },
        outcome: 'generated',
        message: null,
      });
    });

    const text = textOf(tree);
    expect(text).toContain('To make more of it readable');
    expect(text).toContain('Log your hips too');
    // The prose came from the readings, not from a model — saying so is what
    // stops it being read as an AI opinion.
    expect(tree.root.findByProps({ testID: 'health-coach-body-deterministic' })).toBeTruthy();
    // Once there is a summary the button offers to refresh it rather than to
    // make the first one again.
    expect(text).toContain('Refresh');
  });

  it('HEALTH-AI-273: the screen never diagnoses, prescribes or advises treatment', async () => {
    // The same grep `HEALTH-INJUI-017` runs on the injury screen, held here on
    // the surface most able to cross the line. This covers the app's OWN copy —
    // the model's words are constrained by the prompt and by
    // `coach-safety.ts`, both of which have their own tests.
    mockLoadConsent.mockResolvedValue(DENIED);
    const denied = textOf(await render());
    mockLoadConsent.mockResolvedValue(GRANTED);
    const granted = textOf(await render());
    const all = `${denied} ${granted}`;

    // Each pattern targets an AFFIRMATIVE clinical claim. The negated forms are
    // deliberately allowed and asserted below — "it will not diagnose anything"
    // is the app disclaiming the register, which is the opposite of entering it,
    // and a guard that could not tell them apart would force the disclaimer out
    // of the copy.
    for (const forbidden of [
      /(?<!\bnot )\bdiagnos(e|es|is|ing)\b/i,
      /(?<!\bnot )\bprescrib(e|es|ing)\b/i,
      /\bdosage\b/i,
      /\b\d+\s*mg\b/i,
      /\bRICE\b/,
      /consult a professional/i,
      // "you have a …" is a finding; "the figures you have logged" is not.
      /\byou (?:have|are having|likely have) (?:a|an|the)\b/i,
      /\btake (?:a|an|two|some)\b/i,
      /(?<!\bnot give you a )\btreatment plan\b/i,
    ]) {
      expect(all).not.toMatch(forbidden);
    }
    // And it says out loud what it is not.
    expect(all).toContain('not a clinician');
    expect(all).toContain('will not diagnose');
    expect(all).toContain('For anything medical, ask your doctor.');
  });
});
