/**
 * Symply Health — Women's Health (Cycle) SCREEN: the parts of
 * `HealthCycleScreen` that the shared screen suite does not reach.
 *
 * `screens/__tests__/HealthCycleVitalityScreens.test.tsx` drives one flow chip,
 * one symptom, one craving, one mood level and one delete. That proves the
 * wiring exists. It does not prove:
 *
 *   * that the OTHER four flow levels write their own level (they share one
 *     closure over `level`, so a copy-paste there logs "spotting" as "heavy"
 *     and looks perfect on screen);
 *   * that each phase renders its OWN advice paragraph — four strings behind a
 *     single lookup, where a wrong key is invisible unless the phase changes;
 *   * that the PATTERNS card cuts to three, orders ties the way the store does,
 *     and gets the day/days grammar right;
 *   * that RECENT PERIOD DAYS caps at six rows while the wheel still knows
 *     about every logged day;
 *   * the empty, loading and no-anchor states of the whole tab.
 *
 * Only the storage-backed async functions are mocked. The pure helpers (phase
 * maths, predictions, averages, `commonSymptoms`) stay REAL, so a figure on the
 * card is the figure the store would actually produce.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createEmptySymptomEntry,
  CYCLE_PHASE_DESCRIPTIONS,
  FLOW_LEVELS,
  loadCycleSettings,
  loadCycleSymptoms,
  loadCycleSymptomsForDate,
  loadPeriodEntries,
  logPeriodDay,
  removePeriodDay,
  saveCycleSettings,
  saveCycleSymptomEntry,
  type CyclePhase,
  type CycleSettings,
  type CycleSymptomEntry,
  type FlowLevel,
  type PeriodEntry,
} from '../../healthCycleStorage';
import { HealthCycleScreen } from '../../screens/HealthCycleScreen';

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

jest.mock('../../healthCycleStorage', () => {
  const actual = jest.requireActual('../../healthCycleStorage');
  return {
    ...actual,
    loadCycleSettings: jest.fn(),
    loadPeriodEntries: jest.fn(),
    loadCycleSymptoms: jest.fn(),
    loadCycleSymptomsForDate: jest.fn(),
    logPeriodDay: jest.fn(),
    removePeriodDay: jest.fn(),
    saveCycleSettings: jest.fn(),
    saveCycleSymptomEntry: jest.fn(),
  };
});

const mockLoadCycleSettings = loadCycleSettings as jest.Mock;
const mockLoadPeriods = loadPeriodEntries as jest.Mock;
const mockLoadSymptoms = loadCycleSymptoms as jest.Mock;
const mockLoadSymptomsForDate = loadCycleSymptomsForDate as jest.Mock;
const mockLogPeriodDay = logPeriodDay as jest.Mock;
const mockRemovePeriodDay = removePeriodDay as jest.Mock;
const mockSaveCycleSettings = saveCycleSettings as jest.Mock;
const mockSaveSymptomEntry = saveCycleSymptomEntry as jest.Mock;

/** Local noon so `todayDateKey()` is 2026-07-13 in every timezone. */
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

const NO_ANCHOR: CycleSettings = { cycleLength: 28, periodLength: 5, lastPeriodStart: null };

/**
 * Anchors chosen so that TODAY (2026-07-13) lands in each phase of a 28-day /
 * 5-day cycle: ovulation is the 3-day window around day 14.
 */
const PHASE_ANCHORS: Array<[CyclePhase, string, number]> = [
  ['menstrual', '2026-07-10', 4],
  ['follicular', '2026-07-05', 9],
  ['ovulation', '2026-06-30', 14],
  ['luteal', '2026-06-25', 19],
];

function anchored(lastPeriodStart: string, over: Partial<CycleSettings> = {}): CycleSettings {
  return { cycleLength: 28, periodLength: 5, lastPeriodStart, ...over };
}

function period(date: string, flow: FlowLevel = 'medium'): PeriodEntry {
  return { id: `period-${date}`, date, flow, notes: '', loggedAt: `${date}T10:00:00.000Z` };
}

function symptomEntry(over: Partial<CycleSymptomEntry> = {}): CycleSymptomEntry {
  return { ...createEmptySymptomEntry(over.date ?? TODAY), ...over };
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

/** Every host testID currently mounted that starts with `prefix`. */
function testIdsStartingWith(tree: ReactTestRenderer.ReactTestRenderer, prefix: string): string[] {
  return tree.root
    .findAll(
      (n) => typeof n.type === 'string' && typeof n.props?.testID === 'string' &&
        (n.props.testID as string).startsWith(prefix)
    )
    .map((n) => n.props.testID as string);
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

function notesInput(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.find(
    (n) =>
      (n.type as unknown as string) === 'TextInput' &&
      n.props?.testID === 'health-cycle-notes-input'
  );
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthCycleScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadCycleSettings.mockResolvedValue(NO_ANCHOR);
  mockLoadPeriods.mockResolvedValue([]);
  mockLoadSymptoms.mockResolvedValue([]);
  mockLoadSymptomsForDate.mockResolvedValue(null);
  mockLogPeriodDay.mockResolvedValue([]);
  mockRemovePeriodDay.mockResolvedValue([]);
  mockSaveCycleSettings.mockResolvedValue(NO_ANCHOR);
  mockSaveSymptomEntry.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* LOAD                                                                */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — load', () => {
  it('HEALTH-CYCLE-089: the tab shows the spinner until every read has landed', () => {
    // `hydrate` is one `Promise.all` of four reads and `setLoading(false)` runs
    // once. Rendering the cards against `DEFAULT_CYCLE_SETTINGS` while the reads
    // are still in flight would flash "log a period day" at somebody who has a
    // cycle logged — the one message this tab must never show wrongly.
    mockLoadCycleSettings.mockReturnValue(new Promise<CycleSettings>(() => {}));

    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <HealthCycleScreen />
        </ThemeProvider>
      );
    });

    expect(byTestId(tree, 'health-cycle-screen').length).toBe(1);
    expect(byTestId(tree, 'health-cycle-flow-medium').length).toBe(0);
    expect(byTestId(tree, 'health-cycle-no-anchor').length).toBe(0);
    expect(byTestId(tree, 'health-cycle-history-empty').length).toBe(0);
  });

  it('HEALTH-CYCLE-090: a virgin account shows every empty state at once', () => {
    // Three different cards each have their own "nothing yet" copy, and all
    // three have to be right on the very first launch.
    return render().then((tree) => {
      expect(byTestId(tree, 'health-cycle-no-anchor').length).toBe(1);
      expect(byTestId(tree, 'health-cycle-patterns-empty').length).toBe(1);
      expect(byTestId(tree, 'health-cycle-history-empty').length).toBe(1);
      // …and the prediction tiles say "—" rather than a date computed from a
      // default the person never entered.
      expect(allText(byTestId(tree, 'health-cycle-next-period')[0])).toContain('—');
      expect(allText(byTestId(tree, 'health-cycle-fertile-window')[0])).toContain('—');
      // The average tile falls back to the CONFIGURED length, which is honest:
      // it is a setting, not an observation.
      expect(allText(byTestId(tree, 'health-cycle-average')[0])).toContain('28d');
      expect(allText(tree.toJSON())).toContain('LOG A PERIOD DAY');
    });
  });
});

/* ------------------------------------------------------------------ */
/* Phase advice — four strings behind one lookup                       */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — phase advice', () => {
  it.each(PHASE_ANCHORS)(
    'HEALTH-CYCLE-091: the %s phase renders its own cycle day and advice',
    async (phase, anchor, expectedDay) => {
      // One lookup serves the label, the icon and the paragraph. A wrong key is
      // completely invisible until the phase changes — by which time the person
      // has read three cycles of the wrong copy.
      mockLoadCycleSettings.mockResolvedValue(anchored(anchor));
      const tree = await render();

      expect(allText(byTestId(tree, 'health-cycle-day')[0])).toBe(`Day ${expectedDay}`);
      const text = allText(tree.toJSON());
      expect(text).toContain(CYCLE_PHASE_DESCRIPTIONS[phase]);
      // …and ONLY its own: no other phase's paragraph may be on the card.
      for (const other of Object.keys(CYCLE_PHASE_DESCRIPTIONS) as CyclePhase[]) {
        if (other === phase) continue;
        expect(text).not.toContain(CYCLE_PHASE_DESCRIPTIONS[other]);
      }
    }
  );
});

/* ------------------------------------------------------------------ */
/* Period logging — all five levels                                    */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — flow levels', () => {
  it.each(FLOW_LEVELS)('HEALTH-CYCLE-092: the %s chip logs its OWN level', async (level) => {
    // Five chips share one closure over `level`. If it were captured wrong the
    // screen would still look correct — the chip highlights, the header flips —
    // while the stored flow was somebody else's. The date is explicit because
    // the card follows the SELECTED day, which opens on today.
    const tree = await render();

    await act(async () => press(tree, `health-cycle-flow-${level}`));

    expect(mockLogPeriodDay).toHaveBeenCalledTimes(1);
    expect(mockLogPeriodDay).toHaveBeenCalledWith(level, TODAY);
  });

  it('HEALTH-CYCLE-093: the chip for the level LOGGED today is the one marked selected', async () => {
    mockLoadPeriods.mockResolvedValue([period(TODAY, 'veryHeavy')]);
    const tree = await render();

    const selected = FLOW_LEVELS.filter(
      (level) =>
        byTestId(tree, `health-cycle-flow-${level}`)[0].props.accessibilityState?.selected === true
    );
    // Exactly one — the flow is a single value for the day, not a set of flags.
    expect(selected).toEqual(['veryHeavy']);
  });

  it('HEALTH-CYCLE-094: the card header and the remove affordance follow the SELECTED day', async () => {
    // The tab opens on today. A period logged YESTERDAY must still leave the
    // card asking for a log — otherwise "Remove this entry" would offer to
    // delete a day the person is not looking at.
    mockLoadPeriods.mockResolvedValue([period('2026-07-12', 'light')]);
    const yesterdayOnly = await render();

    expect(allText(yesterdayOnly.toJSON())).toContain('LOG A PERIOD DAY');
    expect(byTestId(yesterdayOnly, 'health-cycle-remove-selected').length).toBe(0);
    // The history row for yesterday is still there, with its own delete.
    expect(byTestId(yesterdayOnly, 'health-cycle-delete-2026-07-12').length).toBe(1);

    mockLoadPeriods.mockResolvedValue([period(TODAY, 'light')]);
    const loggedToday = await render();

    expect(allText(loggedToday.toJSON())).toContain('FLOW');
    expect(byTestId(loggedToday, 'health-cycle-remove-selected').length).toBe(1);
    // The card names the day it is pointed at, so "this entry" is never
    // ambiguous once the selection has moved.
    expect(allText(byTestId(loggedToday, 'health-cycle-selected-date')[0])).toBe('Today');
  });

  it('HEALTH-CYCLE-119: picking a past day re-points the log cards AND the writes', async () => {
    // Any day can be logged, not just today (the donor always stamped the
    // current date). The dangerous half is the write: once the cards move, the
    // flow chip, the symptom chips and the note must all follow — writing the
    // selected day's mood onto today would be a silent data corruption on the
    // most sensitive record in the app.
    mockLoadPeriods.mockResolvedValue([period(TODAY, 'medium'), period('2026-06-14', 'heavy')]);
    const tree = await render();

    await act(async () => press(tree, 'health-cycle-open-2026-06-14'));

    expect(allText(byTestId(tree, 'health-cycle-selected-date')[0])).toBe('2026-06-14');
    // The flow card now shows THAT day's level, not today's.
    expect(
      byTestId(tree, 'health-cycle-flow-heavy')[0].props.accessibilityState?.selected
    ).toBe(true);
    expect(
      byTestId(tree, 'health-cycle-flow-medium')[0].props.accessibilityState?.selected
    ).toBe(false);

    await act(async () => press(tree, 'health-cycle-flow-light'));
    expect(mockLogPeriodDay).toHaveBeenCalledWith('light', '2026-06-14');

    await act(async () => press(tree, 'health-cycle-craving-salty'));
    expect(mockSaveSymptomEntry).toHaveBeenCalledWith({ craving: 'salty' }, '2026-06-14');
  });

  it('HEALTH-CYCLE-095: the wheel is told about EVERY logged day, not just the six on screen', async () => {
    // The history list is capped at six rows; the wheel is not. Passing the
    // capped list would silently erase older bleeding days from the ring.
    const logged = ['2026-07-13', '2026-07-12', '2026-07-11', '2026-06-15', '2026-06-14'];
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-11'));
    mockLoadPeriods.mockResolvedValue(logged.map((date) => period(date)));
    const tree = await render();

    const wheel = tree.root.find(
      (n) => n.props?.testID === 'health-cycle-wheel' && Array.isArray(n.props?.loggedDays)
    );
    expect(wheel.props.loggedDays).toEqual(logged);
    expect(wheel.props.currentDay).toBe(3); // anchored 07-11, today 07-13
    expect(wheel.props.cycleLength).toBe(28);
    expect(wheel.props.periodLength).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/* PATTERNS                                                            */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — patterns card', () => {
  it('HEALTH-CYCLE-096: at most three patterns are shown, ordered by count then alphabetically', async () => {
    // Five symptoms logged; the card takes the store's default limit of three.
    // Two of them tie on two days, so the order is also the tie-break — the one
    // thing that stops the card reshuffling between reads for no visible reason.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, symptoms: { cramps: 2, headache: 1, bloating: 3, acne: 1 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { cramps: 3, headache: 2, nausea: 1 } }),
      symptomEntry({ date: '2026-07-11', symptoms: { cramps: 1 } }),
    ]);
    const tree = await render();

    expect(testIdsStartingWith(tree, 'health-cycle-pattern-')).toEqual([
      'health-cycle-pattern-cramps', // 3 days
      'health-cycle-pattern-headache', // 2 days
      // acne, bloating and nausea all sit on 1 day; the alphabetical tie-break
      // decides which one gets the third slot, and it must be stable.
      'health-cycle-pattern-acne',
    ]);
    expect(byTestId(tree, 'health-cycle-patterns-empty').length).toBe(0);
  });

  it('HEALTH-CYCLE-097: one day reads "1 day", two read "2 days"', async () => {
    // The count sits directly beside a number, so an ungrammatical "1 days" is
    // the most-read string on the card.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, symptoms: { cramps: 2, acne: 1 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { cramps: 1 } }),
    ]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-cycle-pattern-cramps')[0])).toContain('2 days');
    expect(allText(byTestId(tree, 'health-cycle-pattern-acne')[0])).toContain('1 day');
    expect(allText(byTestId(tree, 'health-cycle-pattern-acne')[0])).not.toContain('1 days');
  });

  it('HEALTH-CYCLE-098: a log of nothing-but-cleared symptoms still shows the empty state', async () => {
    // Severity 0 is what a cleared chip leaves on the wire. Counting it would
    // crown a symptom the person explicitly turned off, and the "log a few days"
    // prompt would disappear without a single symptom having been recorded.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, mood: 4, symptoms: { cramps: 0 as never } }),
      symptomEntry({ date: '2026-07-12', energy: 2, symptoms: {} }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-cycle-patterns-empty').length).toBe(1);
    expect(testIdsStartingWith(tree, 'health-cycle-pattern-')).toEqual([]);
  });

  it('HEALTH-CYCLE-174: a mood-family pattern is iconed as mood, a physical one as symptoms', async () => {
    // The list mixes body symptoms and emotional ones. The glyph is the only
    // thing separating them, and it is picked by category — so a wrong category
    // silently files "sadness" under physical symptoms.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, symptoms: { sadness: 2, cramps: 1 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { irritability: 3 } }),
    ]);
    const tree = await render();

    const iconNamesIn = (id: string) =>
      tree.root
        .find((n) => n.props?.testID === id)
        .findAll((n) => typeof n.props?.name === 'string')
        .map((n) => n.props.name);

    expect(iconNamesIn('health-cycle-pattern-sadness')).toContain('mood');
    expect(iconNamesIn('health-cycle-pattern-irritability')).toContain('mood');
    expect(iconNamesIn('health-cycle-pattern-cramps')).toContain('symptoms');
  });

  it('HEALTH-CYCLE-099: the observed period-length sentence only appears once a day is logged', async () => {
    const noPeriods = await render();
    expect(allText(noPeriods.toJSON())).not.toContain('Your periods average');

    mockLoadPeriods.mockResolvedValue([period('2026-07-10'), period('2026-07-11')]);
    const withRun = await render();
    expect(allText(withRun.toJSON())).toContain('Your periods average 2 days.');
  });
});

/* ------------------------------------------------------------------ */
/* RECENT PERIOD DAYS                                                  */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — recent period days', () => {
  it('HEALTH-CYCLE-100: the history is capped at six rows, newest first', async () => {
    // A year of logging is ~60 bleeding days. Rendering them all would turn the
    // bottom of the tab into an unbounded list nobody scrolls.
    const dates = [
      '2026-07-13',
      '2026-07-12',
      '2026-07-11',
      '2026-07-10',
      '2026-06-15',
      '2026-06-14',
      '2026-06-13',
      '2026-05-20',
      '2026-05-19',
    ];
    mockLoadPeriods.mockResolvedValue(dates.map((date) => period(date)));
    const tree = await render();

    expect(testIdsStartingWith(tree, 'health-cycle-delete-')).toEqual([
      'health-cycle-delete-2026-07-13',
      'health-cycle-delete-2026-07-12',
      'health-cycle-delete-2026-07-11',
      'health-cycle-delete-2026-07-10',
      'health-cycle-delete-2026-06-15',
      'health-cycle-delete-2026-06-14',
    ]);
    expect(byTestId(tree, 'health-cycle-history-empty').length).toBe(0);
  });

  it('HEALTH-CYCLE-111: each history row names its own flow and its own date', async () => {
    // One row per date, each with its own delete verb. A shared label would let
    // somebody delete Tuesday while reading Monday's flow.
    mockLoadPeriods.mockResolvedValue([period(TODAY, 'spotting'), period('2026-06-14', 'heavy')]);
    const tree = await render();

    const text = allText(tree.toJSON());
    expect(text).toContain('Spotting');
    expect(text).toContain('Heavy');
    // `formatDayKey` renders today as "Today" and an older key as the date.
    expect(text).toContain('Today');
    expect(text).toContain('2026-06-14');

    await act(async () => press(tree, 'health-cycle-delete-2026-06-14'));
    expect(mockRemovePeriodDay).toHaveBeenCalledWith('2026-06-14');
  });
});

/* ------------------------------------------------------------------ */
/* Daily log — symptoms, cravings, notes                               */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — daily log', () => {
  it('HEALTH-CYCLE-112: a symptom chip announces its severity by NAME to assistive tech', async () => {
    // The chip's visual state is a fill colour and a "· Moderate" suffix. For a
    // screen-reader user the accessibility label is the ONLY carrier of both the
    // symptom and how bad it is.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, symptoms: { cramps: 2, acne: 3 } }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-cycle-symptom-cramps')[0].props.accessibilityLabel).toBe(
      'Cramps: Moderate'
    );
    expect(byTestId(tree, 'health-cycle-symptom-acne')[0].props.accessibilityLabel).toBe(
      'Acne: Severe'
    );
    // An untouched chip says "None" rather than leaving the state unspoken.
    expect(byTestId(tree, 'health-cycle-symptom-nausea')[0].props.accessibilityLabel).toBe(
      'Nausea: None'
    );
  });

  it('HEALTH-CYCLE-166: a symptom chip walks none → mild → moderate → severe → none on the SELECTED day', async () => {
    // One control covers both "I have this" and "how bad", so the wrap is the
    // only way to clear it. The fourth tap must DELETE the key rather than
    // store 0 — "logged nothing" and "logged none" have to stay distinguishable
    // downstream, and `hasSymptomContent` reads exactly that difference.
    const tree = await render();

    for (const severity of [1, 2, 3] as const) {
      // The screen re-derives the day from the log the SAVE returns, so the
      // server's answer is what the next tap increments from.
      mockSaveSymptomEntry.mockResolvedValue([
        symptomEntry({ date: TODAY, symptoms: { cramps: severity } }),
      ]);
      await act(async () => press(tree, 'health-cycle-symptom-cramps'));
      expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith(
        { symptoms: { cramps: severity } },
        TODAY
      );
    }

    mockSaveSymptomEntry.mockResolvedValue([symptomEntry({ date: TODAY })]);
    await act(async () => press(tree, 'health-cycle-symptom-cramps'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ symptoms: {} }, TODAY);
  });

  it('HEALTH-CYCLE-167: mood and energy each write their own field on the selected day', async () => {
    // Three scale rows share one `persist()`; only the key in the closure tells
    // them apart. HEALTH-CYCLE-141 pins sleep; these are the other two.
    const tree = await render();

    await act(async () => press(tree, 'health-cycle-mood-5'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ mood: 5 }, TODAY);

    await act(async () => press(tree, 'health-cycle-energy-1'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ energy: 1 }, TODAY);
  });

  it('HEALTH-CYCLE-168: "Remove this entry" deletes the SELECTED day and re-reads the settings', async () => {
    // Deleting the anchor re-anchors the cycle server-side, so the screen has to
    // re-read or the card goes on rendering a day and a phase derived from the
    // period that was just removed.
    mockLoadCycleSettings.mockResolvedValue(anchored(TODAY));
    mockLoadPeriods.mockResolvedValue([period(TODAY, 'medium')]);
    const tree = await render();

    await act(async () => press(tree, 'health-cycle-remove-selected'));

    expect(mockRemovePeriodDay).toHaveBeenCalledWith(TODAY);
    expect(mockLoadCycleSettings).toHaveBeenCalledTimes(2);
  });

  it('HEALTH-CYCLE-169: end-editing commits the NATIVE text, not the controlled draft', async () => {
    // `onEndEditing` carries the text the field really holds, which is what
    // survives an autocorrect the controlled value has not caught up with.
    const tree = await render();

    act(() => notesInput(tree).props.onChangeText('cramping'));
    await act(async () =>
      notesInput(tree).props.onEndEditing({ nativeEvent: { text: 'cramping badly' } })
    );

    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ notes: 'cramping badly' }, TODAY);
  });

  it('HEALTH-CYCLE-113: a stored day opens with its mood, energy, sleep, craving and note in place', async () => {
    // Everything on this card is a controlled value read from the day's entry.
    // A missed field opens as blank and the next save writes the blank back.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({
        date: TODAY,
        mood: 4,
        energy: 2,
        sleepQuality: 5,
        craving: 'chocolate',
        notes: 'cramping in the evening',
      }),
    ]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-cycle-mood-value')[0])).toBe('4/5');
    expect(allText(byTestId(tree, 'health-cycle-energy-value')[0])).toBe('2/5');
    expect(allText(byTestId(tree, 'health-cycle-sleep-value')[0])).toBe('5/5');
    expect(notesInput(tree).props.value).toBe('cramping in the evening');
    expect(byTestId(tree, 'health-cycle-craving-chocolate')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(byTestId(tree, 'health-cycle-craving-none')[0].props.accessibilityState).toEqual({
      selected: false,
    });
    // The donor's caption bands render beside the numbers.
    const text = allText(tree.toJSON());
    expect(text).toContain('Good'); // mood 4
    expect(text).toContain('Tired'); // energy 2
    expect(text).toContain('Very good'); // sleep 5
  });

  it('HEALTH-CYCLE-141: the sleep scale writes `sleepQuality` and nothing else', async () => {
    // Three identical scale rows sharing one `persist()`. The only thing telling
    // "Sleep" from "Mood" is the key name in the closure, and `sleep_quality` is
    // a column that shipped in P1 with nothing writing it — so this row is the
    // FIRST client of it and there is no existing data to notice a mix-up.
    const tree = await render();

    await act(async () => press(tree, 'health-cycle-sleep-4'));

    expect(mockSaveSymptomEntry).toHaveBeenCalledTimes(1);
    expect(mockSaveSymptomEntry).toHaveBeenCalledWith({ sleepQuality: 4 }, TODAY);
  });

  it('HEALTH-CYCLE-114: typing in the note does NOT write until the field is left', async () => {
    // The field has no Save button, so every keystroke writing through would be
    // one request per character on the most sensitive record in the app.
    const tree = await render();

    act(() => notesInput(tree).props.onChangeText('half a thought'));
    expect(mockSaveSymptomEntry).not.toHaveBeenCalled();
    expect(notesInput(tree).props.value).toBe('half a thought');

    await act(async () => notesInput(tree).props.onBlur());
    expect(mockSaveSymptomEntry).toHaveBeenCalledWith({ notes: 'half a thought' }, TODAY);
  });

  it('HEALTH-CYCLE-115: clearing the note writes the empty string rather than skipping the save', async () => {
    // "I deleted what I wrote" has to reach the store, or the old note comes
    // straight back on the next read.
    mockLoadSymptoms.mockResolvedValue([symptomEntry({ date: TODAY, notes: 'old note' })]);
    const tree = await render();

    expect(notesInput(tree).props.value).toBe('old note');
    act(() => notesInput(tree).props.onChangeText(''));
    await act(async () => notesInput(tree).props.onBlur());

    expect(mockSaveSymptomEntry).toHaveBeenCalledWith({ notes: '' }, TODAY);
  });
});

/* ------------------------------------------------------------------ */
/* WHAT'S COMING — the donor's insights sheet, on the page             */
/* ------------------------------------------------------------------ */

describe("HealthCycleScreen — what's coming", () => {
  it('HEALTH-CYCLE-140: with no anchor the card says so instead of rendering three dashes', async () => {
    const tree = await render();

    expect(byTestId(tree, 'health-cycle-upcoming-empty').length).toBe(1);
    expect(byTestId(tree, 'health-cycle-upcoming-nextPeriod').length).toBe(0);
  });

  it('HEALTH-CYCLE-142: the three estimates are listed in DATE order with a relative caption', async () => {
    // Anchored 2026-07-10 on a 28-day cycle: fertile window opens 07-20,
    // ovulation 07-24, next period 08-07. Listing them by key rather than by
    // date would put "next period" above a fertile window that arrives first,
    // which reads as the period being sooner than it is.
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10'));
    const tree = await render();

    expect(testIdsStartingWith(tree, 'health-cycle-upcoming-')).toEqual([
      'health-cycle-upcoming-fertileWindow',
      'health-cycle-upcoming-ovulation',
      'health-cycle-upcoming-nextPeriod',
    ]);
    // Today is 2026-07-13 → 7, 11 and 25 days out.
    expect(allText(byTestId(tree, 'health-cycle-upcoming-fertileWindow')[0])).toContain(
      'in 7 days'
    );
    expect(allText(byTestId(tree, 'health-cycle-upcoming-ovulation')[0])).toContain('2026-07-24');
    expect(allText(byTestId(tree, 'health-cycle-upcoming-nextPeriod')[0])).toContain('in 25 days');
    expect(byTestId(tree, 'health-cycle-upcoming-empty').length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Per-phase pattern sentence                                          */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — per-phase patterns', () => {
  it('HEALTH-CYCLE-143: the phase sentence states its own denominator', async () => {
    // This is what stands in for the donor's phase TIP rows ("focus on iron-rich
    // foods"). It is a read of the person's own log, so it has to say how many
    // days it is reading — "cramps in your period phase" means nothing without
    // "across 2 logged days".
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10'));
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: '2026-07-11', symptoms: { cramps: 2 } }), // cycle day 2
      symptomEntry({ date: '2026-07-12', symptoms: { cramps: 1 } }), // cycle day 3
      symptomEntry({ date: '2026-07-20', symptoms: { acne: 2 } }), // day 11 — follicular
    ]);
    const tree = await render();

    const sentence = allText(byTestId(tree, 'health-cycle-phase-pattern')[0]);
    expect(sentence).toContain('In your period phase you have most often logged cramps');
    // Only the two menstrual-phase days count; the follicular one is excluded.
    expect(sentence).toContain('across 2 logged days');
    expect(sentence).not.toContain('acne');
  });

  it('HEALTH-CYCLE-175: a single logged day in the phase reads "1 logged day"', async () => {
    // The denominator sits directly after a number, so the singular has to be
    // right on the very first day the person logs anything in a phase — which
    // is when they are most likely to read the sentence closely.
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10'));
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: '2026-07-11', symptoms: { cramps: 2 } }),
    ]);
    const tree = await render();

    const sentence = allText(byTestId(tree, 'health-cycle-phase-pattern')[0]);
    expect(sentence).toContain('across 1 logged day.');
    expect(sentence).not.toContain('1 logged days');
  });

  it('HEALTH-CYCLE-144: an unlogged phase says nothing rather than advising', async () => {
    // The empty branch has to stay a statement of fact. Filling it with a tip
    // is exactly the donor behaviour this screen deliberately dropped.
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10'));
    const tree = await render();

    expect(allText(byTestId(tree, 'health-cycle-phase-pattern')[0])).toBe(
      'Nothing logged yet in your period phase.'
    );
  });

  it('HEALTH-CYCLE-145: with no anchor there is no phase sentence at all', async () => {
    // Every phase claim needs an anchor. Without one the card must fall silent
    // rather than defaulting to "your period phase".
    const tree = await render();
    expect(byTestId(tree, 'health-cycle-phase-pattern').length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The month calendar, driven through the screen                       */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — month calendar', () => {
  it('HEALTH-CYCLE-170: tapping a calendar day moves BOTH log cards onto it', async () => {
    // The calendar is the primary day picker (the history list is the shortcut).
    // If the selection did not reach the cards, a tap would move the highlight
    // and then write to yesterday's row anyway.
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10'));
    const tree = await render();

    await act(async () => press(tree, 'health-cycle-calendar-day-2026-07-05'));

    expect(allText(byTestId(tree, 'health-cycle-selected-date')[0])).toBe('2026-07-05');
    await act(async () => press(tree, 'health-cycle-flow-spotting'));
    expect(mockLogPeriodDay).toHaveBeenCalledWith('spotting', '2026-07-05');
  });

  it('HEALTH-CYCLE-171: a padding day from a neighbouring month cannot be selected', async () => {
    // The grid borrows days so a week reads as a week. Letting one be tapped
    // would silently move the log a month away from the grid being shown.
    const tree = await render();

    // 2026-07-01 is a Wednesday, so the first row borrows 29 and 30 June.
    const padding = tree.root.find(
      (n) =>
        n.props?.testID === 'health-cycle-calendar-day-2026-06-30' &&
        typeof n.props?.onPress === 'function'
    );
    expect(padding.props.disabled).toBe(true);
    expect(padding.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('HEALTH-CYCLE-172: the month can be walked back and returned to in one tap', async () => {
    // The return-to-today control is disabled while the current month is shown,
    // so it only becomes reachable once the person has navigated away — which
    // is exactly when it is needed.
    const tree = await render();

    expect(allText(byTestId(tree, 'health-cycle-calendar-title')[0])).toBe('July 2026');

    await act(async () => press(tree, 'health-cycle-calendar-prev'));
    expect(allText(byTestId(tree, 'health-cycle-calendar-title')[0])).toBe('June 2026');

    await act(async () => press(tree, 'health-cycle-calendar-next'));
    await act(async () => press(tree, 'health-cycle-calendar-next'));
    expect(allText(byTestId(tree, 'health-cycle-calendar-title')[0])).toBe('August 2026');

    // Back to this month, from a month that is not it.
    await act(async () => press(tree, 'health-cycle-calendar-title'));
    expect(allText(byTestId(tree, 'health-cycle-calendar-title')[0])).toBe('July 2026');
  });

  it('HEALTH-CYCLE-173: the grid summary names the estimates AS estimates', async () => {
    // People read the picture, not the caveat — so the caveat is in the sentence
    // directly under the grid, not only in the card footer.
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10'));
    mockLoadPeriods.mockResolvedValue([period('2026-07-10'), period('2026-07-11')]);
    const withData = await render();

    const summary = allText(byTestId(withData, 'health-cycle-calendar-summary')[0]);
    expect(summary).toContain('2 period days logged');
    expect(summary).toContain('estimated days');
    expect(summary).toContain('not a fertility test');

    // An empty month says so in words rather than leaving a bare grid to be
    // read as "nothing happened".
    mockLoadCycleSettings.mockResolvedValue(NO_ANCHOR);
    mockLoadPeriods.mockResolvedValue([]);
    const empty = await render();
    expect(allText(byTestId(empty, 'health-cycle-calendar-summary')[0])).toContain(
      'Nothing logged in July 2026'
    );

    // …and a month holding exactly ONE estimated day says "day", not "days".
    // Anchored on 2026-07-30 with a 1-day period, July's only mark is 07-30.
    mockLoadCycleSettings.mockResolvedValue({
      cycleLength: 28,
      periodLength: 1,
      lastPeriodStart: '2026-07-30',
    });
    const single = await render();
    expect(allText(byTestId(single, 'health-cycle-calendar-summary')[0])).toContain(
      '1 estimated day.'
    );
  });
});

/* ------------------------------------------------------------------ */
/* The cycle-length Alert                                              */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen — cycle length editor', () => {
  it('HEALTH-CYCLE-116: the Alert offers the four donor lengths plus Cancel, and Cancel writes nothing', async () => {
    // The picker is an Alert, so its options are the only validation there is —
    // and all four have to be inside the 20–45 range the store clamps to, or a
    // tap would silently be corrected to something else.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render();

    press(tree, 'health-cycle-length-button');

    const [title, message, buttons] = alertSpy.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ text: string; style?: string; onPress?: () => void }>,
    ];
    expect(title).toBe('Average cycle length');
    expect(message).toBe('How many days from one period to the next?');
    expect(buttons.map((b) => b.text)).toEqual([
      '26 days',
      '28 days',
      '30 days',
      '32 days',
      'Cancel',
    ]);
    expect(buttons[buttons.length - 1].style).toBe('cancel');

    // Cancel carries no handler at all — there is nothing that could write.
    expect(buttons[buttons.length - 1].onPress).toBeUndefined();
    expect(mockSaveCycleSettings).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('HEALTH-CYCLE-117: the button reads the STORED length back, not the option tapped', async () => {
    // `saveCycleSettings` clamps, so the label has to come from what the store
    // returned. Echoing the tapped option would hide a clamp from the user.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSaveCycleSettings.mockResolvedValue(anchored('2026-07-10', { cycleLength: 32 }));
    const tree = await render();

    press(tree, 'health-cycle-length-button');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === '32 days')?.onPress?.());

    expect(mockSaveCycleSettings).toHaveBeenCalledWith({ cycleLength: 32 });
    expect(allText(tree.toJSON())).toContain('Cycle 32 days');
    alertSpy.mockRestore();
  });

  it('HEALTH-CYCLE-118: the average tile prefers the OBSERVED length, the button always shows the setting', async () => {
    // The two numbers mean different things and are allowed to disagree: the
    // button is the setting the person chose, the tile is what their own log
    // says. Showing the same number in both would hide the disagreement that
    // makes the tile worth having.
    mockLoadCycleSettings.mockResolvedValue(anchored('2026-07-10', { cycleLength: 28 }));
    mockLoadPeriods.mockResolvedValue([
      period('2026-07-10'),
      period('2026-06-10'),
      period('2026-06-11'),
    ]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-cycle-average')[0])).toContain('30d'); // observed
    expect(allText(tree.toJSON())).toContain('Cycle 28 days'); // configured
  });
});
