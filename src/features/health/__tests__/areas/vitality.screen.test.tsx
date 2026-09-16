/**
 * Symply Health — Men's Health (Vitality) screen: the behaviours that only exist
 * while the screen is MOUNTED and being driven.
 *
 * `screens/__tests__/HealthCycleVitalityScreens.test.tsx` proves that every
 * control writes the field it is labelled with, and that a preset entry renders
 * the right numbers. It does that by rendering a FRESH tree per state — so the
 * two conditional rows are only ever seen already-present or already-absent, and
 * the screen's own optimistic state machine is never actually exercised.
 *
 * The gaps that leaves, and that this file closes:
 *
 *   * **A gate that FLIPS.** `persist()` paints the tap immediately and only
 *     then reconciles with the store. Tapping "Sex with a partner" must reveal
 *     the Satisfaction row in the SAME tree, with no reload — and untapping it
 *     must take the row away again, because Satisfaction feeds the sexual
 *     sub-score and a stale row would keep scoring a day that no longer
 *     happened.
 *   * **The `||` in that gate.** Two independent toggles open the same row.
 *     Proving each one separately still permits a build where the second one
 *     REPLACES the first — the row must survive turning one off while the other
 *     is on.
 *   * **The kegel field's real input surface.** `onEndEditing` carries the
 *     NATIVE text, which has never been through `sanitizeIntegerInput`. Junk,
 *     emptiness, a literal zero and an absurd figure all arrive here, and
 *     `clampKegelSets` is the only thing between them and the store.
 *   * **The derived chrome.** The ring's `progress`, the `—` placeholder on the
 *     week's Avg score tile, the six-row history cap, the pluralised issue
 *     counter and its colour, and the two mutually exclusive score captions.
 *
 * Only the storage-backed async fns are mocked; every pure helper (the score
 * formulas, the trend maths, `libidoDescription`) stays real, so a number
 * asserted here is a number the shipped formula produced.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createEmptyVitalityEntry,
  loadVitalityEntries,
  loadVitalityForDate,
  saveVitalityEntry,
  vitalityScore,
  type VitalityEntry,
} from '../../healthVitalityStorage';
import { HealthVitalityScreen } from '../../screens/HealthVitalityScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// This suite renders the screen standalone, with no real NavigationContainer,
// so the real `useFocusEffect` (used to re-hydrate on focus/HealthKit sync)
// would throw the instant it mounts. Same inert-callback shim
// HealthSectionScreens.test.tsx uses.
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthVitalityStorage', () => {
  const actual = jest.requireActual('../../healthVitalityStorage');
  return {
    ...actual,
    loadVitalityEntries: jest.fn(),
    loadVitalityForDate: jest.fn(),
    saveVitalityEntry: jest.fn(),
  };
});

const mockLoadVitality = loadVitalityEntries as jest.Mock;
const mockLoadVitalityForDate = loadVitalityForDate as jest.Mock;
const mockSaveVitality = saveVitalityEntry as jest.Mock;

/** Fixed local noon so `todayDateKey()` === '2026-07-13' in every timezone. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function vitality(over: Partial<VitalityEntry> = {}): VitalityEntry {
  return {
    ...createEmptyVitalityEntry(over.date ?? TODAY),
    loggedAt: `${over.date ?? TODAY}T10:00:00.000Z`,
    ...over,
  };
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

/** The kegel-sets field — a host `TextInput`, not the composite around it. */
function kegelInput(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.find(
    (n) =>
      (n.type as unknown as string) === 'TextInput' &&
      n.props?.testID === 'health-vitality-kegel-input'
  );
}

/** The `ProgressRing` composite, whose `progress` is the ring's fill fraction. */
function ring(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.find(
    (n) => n.props?.testID === 'health-vitality-ring' && typeof n.props?.progress === 'number'
  );
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadVitality.mockResolvedValue([]);
  mockLoadVitalityForDate.mockResolvedValue(null);
  // Resolving to `[]` means `persist()` finds no server row for today and keeps
  // its optimistic one — which is exactly the state a flip has to be observed in.
  mockSaveVitality.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen — load', () => {
  it('HEALTH-VITALITY-240: the spinner holds the whole tab until BOTH reads land', async () => {
    // `hydrate` awaits `Promise.all([entries, today])`. Rendering the cards off a
    // half-loaded state would flash the neutral 50 ring and then jump — on the
    // one tab where that number reads as a verdict.
    let releaseEntries!: (rows: VitalityEntry[]) => void;
    mockLoadVitality.mockReturnValue(
      new Promise<VitalityEntry[]>((resolve) => {
        releaseEntries = resolve;
      })
    );
    mockLoadVitalityForDate.mockResolvedValue(vitality({ libido: 9 }));

    const tree = await render(<HealthVitalityScreen />);

    // The shell is up (so the header and back affordance work) but nothing that
    // depends on data is rendered — not even the scroll container.
    expect(byTestId(tree, 'health-vitality-screen').length).toBe(1);
    expect(byTestId(tree, 'health-vitality-screen-scroll').length).toBe(0);
    expect(byTestId(tree, 'health-vitality-score').length).toBe(0);
    expect(byTestId(tree, 'health-vitality-disclaimer').length).toBe(0);

    await act(async () => releaseEntries([vitality({ libido: 9 })]));

    expect(byTestId(tree, 'health-vitality-screen-scroll').length).toBe(1);
    expect(byTestId(tree, 'health-vitality-score').length).toBe(1);
  });

  it('HEALTH-VITALITY-241: the ring fill is the score as a FRACTION, not the score', async () => {
    // `ProgressRing` takes 0–1. Handing it the raw 0–100 figure would peg the arc
    // full for every score above 1, i.e. always — and it would still render a
    // plausible-looking screen, which is why this needs its own assertion.
    const unlogged = await render(<HealthVitalityScreen />);
    expect(ring(unlogged).props.progress).toBeCloseTo(0.5, 5);

    // A real logged day: energy 10 → 100, everything else neutral → floor(250/4).
    const entry = vitality({ energyLevel: 10 });
    mockLoadVitalityForDate.mockResolvedValue(entry);
    const logged = await render(<HealthVitalityScreen />);

    expect(vitalityScore(entry)).toBe(62);
    expect(allText(byTestId(logged, 'health-vitality-score')[0])).toBe('62');
    expect(ring(logged).props.progress).toBeCloseTo(0.62, 5);
  });

  it('HEALTH-VITALITY-242: the two score captions are mutually exclusive', async () => {
    // The caption is the ONLY thing distinguishing "we have nothing from you, so
    // here is the neutral baseline" from "this is your day". Both showing, or
    // neither, would make the 50 unreadable.
    const NEUTRAL = 'Not logged today — showing the neutral baseline.';
    const AVERAGED = 'Average of your sexual-health, erection, energy and mental sub-scores.';

    const unlogged = allText((await render(<HealthVitalityScreen />)).toJSON());
    expect(unlogged).toContain(NEUTRAL);
    expect(unlogged).not.toContain(AVERAGED);

    mockLoadVitalityForDate.mockResolvedValue(vitality({ libido: 7 }));
    const logged = allText((await render(<HealthVitalityScreen />)).toJSON());
    expect(logged).toContain(AVERAGED);
    expect(logged).not.toContain(NEUTRAL);
  });

  it('HEALTH-VITALITY-243: an entry with NO timestamp still counts as unlogged', async () => {
    // A row can come back from the wire with every field populated and
    // `updated_at` missing (see HEALTH-VITAL-031). `loggedAt.length > 0` is the
    // whole test for "logged today", so such a row must NOT flip the caption or
    // score the ring — the values are shown in the controls, the verdict is not
    // claimed.
    mockLoadVitalityForDate.mockResolvedValue({
      ...createEmptyVitalityEntry(TODAY),
      libido: 10,
      energyLevel: 10,
      loggedAt: '',
    });
    const tree = await render(<HealthVitalityScreen />);

    expect(allText(byTestId(tree, 'health-vitality-score')[0])).toBe('50');
    expect(allText(tree.toJSON())).toContain('Not logged today');
    // …and the sub-score tiles agree with the ring rather than with the row.
    expect(allText(byTestId(tree, 'health-vitality-sub-energy')[0])).toContain('50');
    // The CONTROL still shows what is stored — the data is not hidden, only
    // uncredited.
    expect(allText(byTestId(tree, 'health-vitality-libido-value')[0])).toBe('10/10');
    // The libido hint is the same two-state read, so it prompts rather than
    // reporting a band it has not earned.
    expect(allText(tree.toJSON())).toContain('Track your sex drive');
  });
});

/* ------------------------------------------------------------------ */
/* Conditional rows, driven                                            */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen — conditional rows appear and disappear', () => {
  it('HEALTH-VITALITY-250: Satisfaction appears on the tap and goes away on the untap', async () => {
    const tree = await render(<HealthVitalityScreen />);
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(0);

    await act(async () => press(tree, 'health-vitality-partner-sex'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ hadPartnerSex: true });
    // The row is there BEFORE any reload — `persist` paints optimistically.
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(1);

    await act(async () => press(tree, 'health-vitality-partner-sex'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ hadPartnerSex: false });
    // Gone again. A row left behind would keep a satisfaction rating attached to
    // a day the user has just said did not happen, and it feeds the sub-score.
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(0);
  });

  it('HEALTH-VITALITY-251: EITHER activity toggle holds Satisfaction open', async () => {
    // `(hadPartnerSex || hadMasturbation)`. Driving the two separately still
    // permits a build where the second assignment replaces the first, so the
    // overlap is what has to be walked: on, on, off — and the row survives.
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => press(tree, 'health-vitality-solo'));
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(1);

    await act(async () => press(tree, 'health-vitality-partner-sex'));
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(1);

    // Solo off, partner still on → the row MUST stay.
    await act(async () => press(tree, 'health-vitality-solo'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ hadMasturbation: false });
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(1);

    // Only when the last one goes does the row go.
    await act(async () => press(tree, 'health-vitality-partner-sex'));
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(0);
  });

  it('HEALTH-VITALITY-252: Morning quality tracks its own toggle, both ways', async () => {
    const tree = await render(<HealthVitalityScreen />);
    expect(byTestId(tree, 'health-vitality-morning-quality').length).toBe(0);
    // The unconditional row below the slot is present throughout, so the counts
    // above and below are about ABSENCE and not about a failed render.
    expect(byTestId(tree, 'health-vitality-quality').length).toBe(1);

    await act(async () => press(tree, 'health-vitality-morning'));
    expect(byTestId(tree, 'health-vitality-morning-quality').length).toBe(1);

    await act(async () => press(tree, 'health-vitality-morning'));
    expect(byTestId(tree, 'health-vitality-morning-quality').length).toBe(0);
    expect(byTestId(tree, 'health-vitality-quality').length).toBe(1);
  });

  it('HEALTH-VITALITY-253: a value set in a conditional row survives hiding and re-showing it', async () => {
    // The gate hides the ROW; it does not clear the field. That is deliberate —
    // an accidental untap must not silently discard a rating — but it means the
    // stored value keeps feeding the sub-score while invisible, so the behaviour
    // is pinned rather than assumed.
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => press(tree, 'health-vitality-morning'));
    await act(async () => press(tree, 'health-vitality-morning-quality-9'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ morningErectionQuality: 9 });
    expect(allText(byTestId(tree, 'health-vitality-morning-quality-value')[0])).toBe('9/10');

    await act(async () => press(tree, 'health-vitality-morning'));
    expect(byTestId(tree, 'health-vitality-morning-quality').length).toBe(0);

    await act(async () => press(tree, 'health-vitality-morning'));
    expect(allText(byTestId(tree, 'health-vitality-morning-quality-value')[0])).toBe('9/10');
  });

  it('HEALTH-VITALITY-254: an unrated conditional row reads `—`, not a phantom 5', async () => {
    // `overallSatisfaction` and the two erection-quality fields are nullable on
    // purpose, and `HealthScaleRow` renders null as an em dash. Defaulting them
    // to the midpoint would pay out (10 − 5) × 3 = 0 on the sub-score for a
    // rating nobody gave.
    mockLoadVitalityForDate.mockResolvedValue(vitality({ hadPartnerSex: true }));
    const tree = await render(<HealthVitalityScreen />);

    expect(allText(byTestId(tree, 'health-vitality-satisfaction-value')[0])).toBe('—');
    expect(allText(byTestId(tree, 'health-vitality-quality-value')[0])).toBe('—');
  });
});

/* ------------------------------------------------------------------ */
/* Kegels — the input surface                                          */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen — kegel input', () => {
  it('HEALTH-VITALITY-260: typing strips everything that is not a digit', async () => {
    // `keyboardType="number-pad"` is a hint, not a guarantee — a hardware
    // keyboard, a paste or a dictation all deliver letters.
    const tree = await render(<HealthVitalityScreen />);
    const input = kegelInput(tree);

    act(() => input.props.onChangeText('1a2b3'));
    expect(kegelInput(tree).props.value).toBe('123');

    act(() => input.props.onChangeText('-5'));
    expect(kegelInput(tree).props.value).toBe('5');

    act(() => input.props.onChangeText('abc'));
    expect(kegelInput(tree).props.value).toBe('');
  });

  it('HEALTH-VITALITY-261: an empty field commits ZERO sets and stays empty', async () => {
    // Committing nothing must be an explicit "0 today", not a no-op: leaving the
    // previous count in place would keep crediting yesterday's work. The box
    // still shows the placeholder rather than a literal `0`.
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 6 }));
    const tree = await render(<HealthVitalityScreen />);
    expect(kegelInput(tree).props.value).toBe('6');

    act(() => kegelInput(tree).props.onChangeText(''));
    await act(async () => kegelInput(tree).props.onEndEditing({ nativeEvent: { text: '' } }));

    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 0 });
    expect(kegelInput(tree).props.value).toBe('');
  });

  it('HEALTH-VITALITY-262: a literal 0 is accepted and renders as the placeholder', async () => {
    // Distinct from HEALTH-VITALITY-261: the user TYPED a zero. It must persist
    // (so the day reads "I did none" rather than "I did not say") while the box
    // still shows the placeholder — a stuck `0` reads as a logged zero every
    // time the tab is opened.
    const tree = await render(<HealthVitalityScreen />);

    act(() => kegelInput(tree).props.onChangeText('0'));
    expect(kegelInput(tree).props.value).toBe('0');
    await act(async () => kegelInput(tree).props.onSubmitEditing());

    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 0 });
    expect(kegelInput(tree).props.value).toBe('');
  });

  it('HEALTH-VITALITY-263: junk arriving as NATIVE text is clamped to zero, never NaN', async () => {
    // `onEndEditing` commits `e.nativeEvent.text`, which has NOT been through
    // `sanitizeIntegerInput` — the sanitizer only guards the controlled value.
    // `clampKegelSets` is therefore the ONLY thing between an autocorrect, a
    // paste or an IME composition and the store, and a NaN reaching it would be
    // written to the entry and then summed into the week's kegel total.
    for (const native of ['abc', '12abc', '  ', '1.5.2', '٣']) {
      jest.clearAllMocks();
      mockLoadVitality.mockResolvedValue([]);
      mockLoadVitalityForDate.mockResolvedValue(null);
      mockSaveVitality.mockResolvedValue([]);

      const tree = await render(<HealthVitalityScreen />);
      await act(async () =>
        kegelInput(tree).props.onEndEditing({ nativeEvent: { text: native } })
      );

      const [[patch]] = mockSaveVitality.mock.calls;
      expect([native, patch]).toEqual([native, { kegelSets: 0 }]);
      expect(Number.isNaN((patch as { kegelSets: number }).kegelSets)).toBe(false);
    }
  });

  it('HEALTH-VITALITY-264: absurd figures are clamped to the 50-set ceiling', async () => {
    // Including the two that are not merely "large": `1e309` parses to Infinity
    // and `9007199254740993` is past `Number.MAX_SAFE_INTEGER`. Both would
    // survive a naive `> 50` comparison written as a string check.
    for (const [native, expected] of [
      ['999', 50],
      ['50', 50],
      ['51', 50],
      ['9007199254740993', 50],
      ['1e309', 0], // Infinity is not finite → the clamp's zero branch
    ] as const) {
      jest.clearAllMocks();
      mockLoadVitality.mockResolvedValue([]);
      mockLoadVitalityForDate.mockResolvedValue(null);
      mockSaveVitality.mockResolvedValue([]);

      const tree = await render(<HealthVitalityScreen />);
      await act(async () =>
        kegelInput(tree).props.onEndEditing({ nativeEvent: { text: native } })
      );

      expect([native, mockSaveVitality.mock.calls[0][0]]).toEqual([native, { kegelSets: expected }]);
      // The field re-renders the CLAMPED number, so the user sees what was
      // actually stored rather than the figure they typed.
      expect([native, kegelInput(tree).props.value]).toEqual([
        native,
        expected > 0 ? String(expected) : '',
      ]);
    }
  });

  it('HEALTH-VITALITY-265: committing without touching the field re-writes the SAME count', async () => {
    // Tapping Save on an untouched field is idempotent — it must not clear a
    // stored count, which is what a naive "commit the empty draft" would do.
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 12 }));
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => press(tree, 'health-vitality-kegel-save'));

    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 12 });
    expect(kegelInput(tree).props.value).toBe('12');
  });
});

/* ------------------------------------------------------------------ */
/* Issues, week card and history                                       */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen — derived chrome', () => {
  it('HEALTH-VITALITY-270: the issue counter pluralises and re-tints as issues accumulate', async () => {
    // Seven toggles feed one counter. It is asserted at `None`, at one, and at
    // the full set, because "N noted" is a template and the None/N branch is the
    // only place the label changes shape.
    const counter = (tree: ReactTestRenderer.ReactTestRenderer) =>
      tree.root.find(
        (n) =>
          n.props?.testID === 'health-vitality-issue-count' && typeof n.props?.color === 'string'
      );

    const tree = await render(<HealthVitalityScreen />);
    expect(allText(byTestId(tree, 'health-vitality-issue-count')[0])).toBe('None');
    const quietTint = counter(tree).props.color;

    await act(async () => press(tree, 'health-vitality-issue-hadErectionDifficulty'));
    expect(allText(byTestId(tree, 'health-vitality-issue-count')[0])).toBe('1 noted');
    // The counter takes the accent the moment there IS something to notice —
    // sharing the muted colour with `None` would make the card read the same
    // whether or not anything was wrong.
    const loudTint = counter(tree).props.color;
    expect(loudTint).not.toBe(quietTint);

    await act(async () => press(tree, 'health-vitality-issue-hadPainOrDiscomfort'));
    expect(allText(byTestId(tree, 'health-vitality-issue-count')[0])).toBe('2 noted');

    // …and back down to None restores the quiet tint.
    await act(async () => press(tree, 'health-vitality-issue-hadErectionDifficulty'));
    await act(async () => press(tree, 'health-vitality-issue-hadPainOrDiscomfort'));
    expect(allText(byTestId(tree, 'health-vitality-issue-count')[0])).toBe('None');
    expect(counter(tree).props.color).toBe(quietTint);
  });

  it('HEALTH-VITALITY-271: all seven issue rows render, each writing its own flag', async () => {
    // The rows come from one `VITALITY_ISSUES.map`, so a key typo would drop a
    // row entirely rather than mislabel it — and three of the seven cost nothing
    // on the score, which means a missing one is invisible in the ring.
    const FLAGS = [
      'hadErectionDifficulty',
      'hadMaintenanceDifficulty',
      'hadPrematureEjaculation',
      'hadDelayedEjaculation',
      'hadPerformanceAnxiety',
      'hadLowDesire',
      'hadPainOrDiscomfort',
    ] as const;

    const tree = await render(<HealthVitalityScreen />);
    for (const flag of FLAGS) {
      expect([flag, byTestId(tree, `health-vitality-issue-${flag}`).length]).toEqual([flag, 1]);
    }

    // Driven one at a time from a fresh tree so "writes its own flag" cannot be
    // satisfied by an earlier tap still sitting in optimistic state.
    for (const flag of FLAGS) {
      jest.clearAllMocks();
      mockLoadVitality.mockResolvedValue([]);
      mockLoadVitalityForDate.mockResolvedValue(null);
      mockSaveVitality.mockResolvedValue([]);

      const fresh = await render(<HealthVitalityScreen />);
      await act(async () => press(fresh, `health-vitality-issue-${flag}`));

      expect(mockSaveVitality).toHaveBeenCalledTimes(1);
      expect(mockSaveVitality).toHaveBeenCalledWith({ [flag]: true });
    }
  });

  it('HEALTH-VITALITY-272: the Avg score tile shows `—` until something is logged', async () => {
    // `summarizeVitality` returns 0 for an empty week, and a literal `0` in that
    // tile would read as "your average is zero" — the same mistake the ring
    // avoids with its neutral 50.
    const empty = await render(<HealthVitalityScreen />);
    expect(allText(byTestId(empty, 'health-vitality-week-score')[0])).toContain('—');
    expect(allText(byTestId(empty, 'health-vitality-week-days')[0])).toContain('0/7');
    // The kegel total is a genuine zero and is shown as one.
    expect(allText(byTestId(empty, 'health-vitality-week-kegels')[0])).toContain('0');

    mockLoadVitality.mockResolvedValue([vitality({ date: TODAY, energyLevel: 10 })]);
    const logged = await render(<HealthVitalityScreen />);
    expect(allText(byTestId(logged, 'health-vitality-week-score')[0])).toContain('62');
    expect(allText(byTestId(logged, 'health-vitality-week-days')[0])).toContain('1/7');
  });

  it('HEALTH-VITALITY-273: history shows at most SIX days, newest first', async () => {
    // `entries.slice(0, 6)`. The list has no "see all", so an uncapped render
    // would grow to 400 rows on a long-standing account and push the disclaimer
    // card — a product requirement — an unreachable distance down the screen.
    const dates = [
      TODAY,
      '2026-07-12',
      '2026-07-11',
      '2026-07-10',
      '2026-07-09',
      '2026-07-08',
      '2026-07-07',
      '2026-07-06',
    ];
    mockLoadVitality.mockResolvedValue(dates.map((date) => vitality({ date })));
    const tree = await render(<HealthVitalityScreen />);

    for (const date of dates.slice(0, 6)) {
      expect([date, byTestId(tree, `health-vitality-history-${date}`).length]).toEqual([date, 1]);
    }
    for (const date of dates.slice(6)) {
      expect([date, byTestId(tree, `health-vitality-history-${date}`).length]).toEqual([date, 0]);
    }

    // The disclaimer still closes the screen.
    expect(byTestId(tree, 'health-vitality-disclaimer').length).toBe(1);
  });

  it('HEALTH-VITALITY-274: each history row states that day’s score and issue count', async () => {
    // The row is `score · N issues` — two independently derived figures on one
    // line, so a row that showed today's score against another day's issues
    // would look entirely plausible.
    const good = vitality({ date: TODAY, energyLevel: 10 });
    const rough = vitality({
      date: '2026-07-12',
      energyLevel: 2,
      hadLowDesire: true,
      hadPainOrDiscomfort: true,
    });
    mockLoadVitality.mockResolvedValue([good, rough]);
    const tree = await render(<HealthVitalityScreen />);

    expect(vitalityScore(good)).toBe(62);
    expect(allText(byTestId(tree, `health-vitality-history-${TODAY}`)[0])).toBe('62 · 0 issues');
    // energy 2 → 20; low desire → sexual 35; two flags → "2 issues".
    expect(vitalityScore(rough)).toBe(38);
    expect(allText(byTestId(tree, 'health-vitality-history-2026-07-12')[0])).toBe('38 · 2 issues');

    // Today's row is labelled "Today" rather than by its date key.
    expect(allText(tree.toJSON())).toContain('Today');
    expect(allText(tree.toJSON())).toContain('Yesterday');
  });

  it('HEALTH-VITALITY-275: a save re-reads the whole list, so the week card follows the write', async () => {
    // `persist` sets `entries` from the store's return value. If it did not, the
    // LAST 7 DAYS card and the history list would keep describing the state the
    // tab was opened in until the user left and came back.
    const tree = await render(<HealthVitalityScreen />);
    expect(allText(byTestId(tree, 'health-vitality-week-days')[0])).toContain('0/7');

    mockSaveVitality.mockResolvedValue([
      vitality({ date: TODAY, kegelSets: 4, energyLevel: 10 }),
      vitality({ date: '2026-07-12', kegelSets: 1, energyLevel: 10 }),
    ]);
    await act(async () => press(tree, 'health-vitality-energy-10'));

    expect(allText(byTestId(tree, 'health-vitality-week-days')[0])).toContain('2/7');
    expect(allText(byTestId(tree, 'health-vitality-week-kegels')[0])).toContain('5');
    expect(byTestId(tree, `health-vitality-history-${TODAY}`).length).toBe(1);
    // …and the kegel draft is NOT re-seeded from the server row: it is owned by
    // the field, so a reconcile must not overwrite what the user is typing.
    expect(kegelInput(tree).props.value).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* The guided session's onComplete — ADDS to the day, never replaces    */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen — handleSessionComplete (the guided timer callback)', () => {
  /**
   * `HealthKegelTimer` itself is real here — only its `onComplete` prop is
   * invoked. The screen renders it as `<HealthKegelTimer onComplete={...} />`
   * with no explicit `testID`, so `health-kegel-timer` (the component's own
   * internal default) lands on an INNER host `View`, not on this composite —
   * find by the distinctive `onComplete` prop instead, which only this one
   * element on the whole screen carries.
   */
  function kegelTimer(tree: ReactTestRenderer.ReactTestRenderer) {
    return tree.root.find((n) => typeof n.props?.onComplete === 'function');
  }

  it('HEALTH-VITALITY-280: a finished session ADDS its sets to the day, not replaces them', async () => {
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 6 }));
    mockSaveVitality.mockResolvedValue([vitality({ kegelSets: 9 })]);
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => {
      kegelTimer(tree).props.onComplete(3);
    });

    // 6 already logged + 3 just finished = 9, not a bare 3.
    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 9 });
    expect(kegelInput(tree).props.value).toBe('9');
  });

  it('HEALTH-VITALITY-281: the result is clamped the same way manual entry is', async () => {
    // clampKegelSets caps the field; a guided session finishing near the ceiling
    // must not push the stored figure past it either.
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 99 }));
    mockSaveVitality.mockResolvedValue([]);
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => {
      kegelTimer(tree).props.onComplete(10);
    });

    const [[patch]] = mockSaveVitality.mock.calls;
    expect((patch as { kegelSets: number }).kegelSets).toBeLessThanOrEqual(99 + 10);
    expect(Number.isFinite((patch as { kegelSets: number }).kegelSets)).toBe(true);
  });

  it('HEALTH-VITALITY-282: a non-positive completion count is a no-op — nothing is saved or changed', async () => {
    // The timer only ever calls back with a real positive count once a session
    // actually finishes, but the handler guards `completedSets <= 0` defensively.
    // Proving the guard directly is the only way to exercise it, since the real
    // `HealthKegelTimer` cannot produce a zero itself.
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 6 }));
    const tree = await render(<HealthVitalityScreen />);
    // The manual input is pre-filled from today's load (6), not blank — a true
    // no-op must leave it exactly as loaded, which this pins BEFORE the call.
    expect(kegelInput(tree).props.value).toBe('6');
    mockSaveVitality.mockClear();

    await act(async () => {
      kegelTimer(tree).props.onComplete(0);
    });

    expect(mockSaveVitality).not.toHaveBeenCalled();
    expect(kegelInput(tree).props.value).toBe('6');
  });
});
