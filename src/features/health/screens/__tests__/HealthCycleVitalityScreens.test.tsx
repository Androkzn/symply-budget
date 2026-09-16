/**
 * Symply Health — Women's Health (Cycle) and Men's Health (Vitality) screens.
 *
 * These two tabs are the donor's `WomensHealthView` / `MensHealthView` rebuilt
 * on the new UI, and they carry the most sensitive data in the app. They also
 * carry the donor's VERBATIM vitality-score formula, which nothing else guards
 * — a silent drift there changes a number the user reads as meaningful, so the
 * arithmetic is pinned here against hand-computed expectations rather than
 * against whatever the implementation happens to return.
 *
 * Only the storage-backed async fns are mocked; the pure helpers (cycle phase
 * maths, predictions, score formulas) stay real.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createEmptySymptomEntry,
  loadCycleSettings,
  loadCycleSymptoms,
  loadCycleSymptomsForDate,
  loadPeriodEntries,
  logPeriodDay,
  removePeriodDay,
  saveCycleSettings,
  saveCycleSymptomEntry,
  type CycleSettings,
  type CycleSymptomEntry,
  type PeriodEntry,
} from '../../healthCycleStorage';
import {
  createEmptyVitalityEntry,
  energyScore,
  erectionScore,
  loadVitalityEntries,
  loadVitalityForDate,
  mentalScore,
  saveVitalityEntry,
  sexualHealthScore,
  vitalityScore,
  vitalityStatus,
  type VitalityEntry,
} from '../../healthVitalityStorage';
import { HealthCycleScreen } from '../HealthCycleScreen';
import { HealthVitalityScreen } from '../HealthVitalityScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// This suite renders screens standalone, with no real NavigationContainer,
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

jest.mock('../../healthVitalityStorage', () => {
  const actual = jest.requireActual('../../healthVitalityStorage');
  return {
    ...actual,
    loadVitalityEntries: jest.fn(),
    loadVitalityForDate: jest.fn(),
    saveVitalityEntry: jest.fn(),
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

const mockLoadVitality = loadVitalityEntries as jest.Mock;
const mockLoadVitalityForDate = loadVitalityForDate as jest.Mock;
const mockSaveVitality = saveVitalityEntry as jest.Mock;

// Fixed local noon so `todayDateKey()` === '2026-07-13' in every timezone.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

const NO_ANCHOR: CycleSettings = { cycleLength: 28, periodLength: 5, lastPeriodStart: null };
/** Anchored 3 days ago → cycle day 4, still inside a 5-day period. */
const ANCHORED: CycleSettings = { cycleLength: 28, periodLength: 5, lastPeriodStart: '2026-07-10' };

function period(date: string, flow: PeriodEntry['flow'] = 'medium'): PeriodEntry {
  return { id: `period-${date}`, date, flow, notes: '', loggedAt: `${date}T10:00:00.000Z` };
}

function symptomEntry(over: Partial<CycleSymptomEntry> = {}): CycleSymptomEntry {
  return { ...createEmptySymptomEntry(TODAY), ...over };
}

function vitality(over: Partial<VitalityEntry> = {}): VitalityEntry {
  return { ...createEmptyVitalityEntry(TODAY), loggedAt: `${TODAY}T10:00:00.000Z`, ...over };
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

  mockLoadCycleSettings.mockResolvedValue(NO_ANCHOR);
  mockLoadPeriods.mockResolvedValue([]);
  mockLoadSymptoms.mockResolvedValue([]);
  mockLoadSymptomsForDate.mockResolvedValue(null);
  mockLogPeriodDay.mockResolvedValue([]);
  mockRemovePeriodDay.mockResolvedValue([]);
  mockSaveCycleSettings.mockResolvedValue(NO_ANCHOR);
  mockSaveSymptomEntry.mockResolvedValue([]);

  mockLoadVitality.mockResolvedValue([]);
  mockLoadVitalityForDate.mockResolvedValue(null);
  mockSaveVitality.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Women's Health (Cycle)                                              */
/* ------------------------------------------------------------------ */

describe('HealthCycleScreen', () => {
  it('HEALTH-CYCLE-050: renders the shell and asks for a first period day', async () => {
    const tree = await render(<HealthCycleScreen />);

    expect(byTestId(tree, 'health-cycle-screen').length).toBe(1);
    // With no anchor there is no honest cycle day to show, so the card must ask
    // rather than invent day 1.
    expect(byTestId(tree, 'health-cycle-no-anchor').length).toBe(1);
    expect(byTestId(tree, 'health-cycle-day').length).toBe(0);
    expect(allText(byTestId(tree, 'health-cycle-next-period')[0])).toContain('—');
  });

  it('HEALTH-CYCLE-051: shows the cycle day and phase once anchored', async () => {
    mockLoadCycleSettings.mockResolvedValue(ANCHORED);
    const tree = await render(<HealthCycleScreen />);

    // Anchored 2026-07-10, today 2026-07-13 → day 4, still within a 5-day period.
    expect(allText(byTestId(tree, 'health-cycle-day')[0])).toBe('Day 4');
    expect(allText(byTestId(tree, 'health-cycle-phase')[0])).toBe('Period');
    expect(byTestId(tree, 'health-cycle-no-anchor').length).toBe(0);
  });

  it('HEALTH-CYCLE-052: predicts the next period and fertile window from the anchor', async () => {
    mockLoadCycleSettings.mockResolvedValue(ANCHORED);
    const tree = await render(<HealthCycleScreen />);

    // Anchor + 28 days = 2026-08-07; today is 2026-07-13 → 25 days out.
    expect(allText(byTestId(tree, 'health-cycle-next-period')[0])).toContain('in 25d');
    // Ovulation = anchor + (28 - 14) = 07-24; window opens 4 days earlier.
    expect(allText(byTestId(tree, 'health-cycle-fertile-window')[0])).toContain('2026-07-20');
  });

  it('HEALTH-CYCLE-053: logging a flow level writes it and re-reads the settings', async () => {
    const tree = await render(<HealthCycleScreen />);

    await act(async () => press(tree, 'health-cycle-flow-heavy'));

    expect(mockLogPeriodDay).toHaveBeenCalledWith('heavy', TODAY);
    // The server re-anchors on a run start, so the screen must re-read settings
    // or it would keep rendering the pre-log empty state.
    expect(mockLoadCycleSettings).toHaveBeenCalledTimes(2);
  });

  it('HEALTH-CYCLE-054: removing the anchor day re-reads settings so the phase cannot go stale', async () => {
    mockLoadCycleSettings.mockResolvedValue(ANCHORED);
    mockLoadPeriods.mockResolvedValue([period(TODAY)]);
    const tree = await render(<HealthCycleScreen />);

    await act(async () => press(tree, 'health-cycle-remove-selected'));

    expect(mockRemovePeriodDay).toHaveBeenCalledWith(TODAY);
    // Regression guard: deleting the anchor used to leave the card rendering a
    // day and phase derived from the period that had just been removed.
    expect(mockLoadCycleSettings).toHaveBeenCalledTimes(2);
  });

  it('HEALTH-CYCLE-055: a symptom tap cycles none → mild → moderate → severe → none', async () => {
    const tree = await render(<HealthCycleScreen />);

    // The screen re-derives `selectedEntry` from whatever this save resolves
    // to (a real server round-trip), so the mock has to echo the patch back
    // like the server would — a flat `mockResolvedValue([])` would reset the
    // entry to empty after every tap and the cycle could never advance past 1.
    let entry = symptomEntry({ symptoms: {} });
    mockSaveSymptomEntry.mockImplementation(async (patch: Partial<CycleSymptomEntry>) => {
      entry = { ...entry, ...patch };
      return [entry];
    });

    await act(async () => press(tree, 'health-cycle-symptom-cramps'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ symptoms: { cramps: 1 } }, TODAY);

    await act(async () => press(tree, 'health-cycle-symptom-cramps'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ symptoms: { cramps: 2 } }, TODAY);

    await act(async () => press(tree, 'health-cycle-symptom-cramps'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ symptoms: { cramps: 3 } }, TODAY);

    // Fourth tap clears it — the key is REMOVED, not stored as 0, so "logged
    // nothing" and "logged none" cannot be confused downstream.
    await act(async () => press(tree, 'health-cycle-symptom-cramps'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ symptoms: {} }, TODAY);
  });

  it('HEALTH-CYCLE-056: mood and energy persist with their donor captions', async () => {
    const tree = await render(<HealthCycleScreen />);

    await act(async () => press(tree, 'health-cycle-mood-4'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ mood: 4 }, TODAY);

    await act(async () => press(tree, 'health-cycle-energy-2'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ energy: 2 }, TODAY);
  });

  it('HEALTH-CYCLE-057: cravings are single-select', async () => {
    const tree = await render(<HealthCycleScreen />);

    // Same round-trip echo as HEALTH-CYCLE-055 — the "selected" check below
    // reads `selectedEntry`, which is re-derived from this mock's return.
    let entry = symptomEntry({ craving: 'none' });
    mockSaveSymptomEntry.mockImplementation(async (patch: Partial<CycleSymptomEntry>) => {
      entry = { ...entry, ...patch };
      return [entry];
    });

    await act(async () => press(tree, 'health-cycle-craving-chocolate'));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ craving: 'chocolate' }, TODAY);
    expect(byTestId(tree, 'health-cycle-craving-chocolate')[0].props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('HEALTH-CYCLE-058: surfaces the most-logged symptoms as patterns', async () => {
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, symptoms: { cramps: 2, headache: 1 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { cramps: 3 } }),
    ]);
    const tree = await render(<HealthCycleScreen />);

    expect(byTestId(tree, 'health-cycle-pattern-cramps').length).toBe(1);
    expect(allText(byTestId(tree, 'health-cycle-pattern-cramps')[0])).toContain('2 days');
    expect(byTestId(tree, 'health-cycle-patterns-empty').length).toBe(0);
  });

  it('HEALTH-CYCLE-059: the cycle-length picker writes the chosen value', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<HealthCycleScreen />);

    press(tree, 'health-cycle-length-button');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === '30 days')?.onPress?.());

    expect(mockSaveCycleSettings).toHaveBeenCalledWith({ cycleLength: 30 });
    alertSpy.mockRestore();
  });

  it('HEALTH-CYCLE-060: states the non-clinical positioning and the on-device promise', async () => {
    const tree = await render(<HealthCycleScreen />);
    const text = allText(tree.toJSON());

    // Wellness, not medical — the BRD forbids clinical claims, and a cycle
    // prediction is the single most likely place to imply one.
    expect(text).toContain('not medical or contraceptive');
    expect(text).toContain('never shared with other Symply apps');
  });

  it('HEALTH-CYCLE-062: the average card prefers the OBSERVED cycle over the setting', async () => {
    // Two logged runs 30 days apart. Showing the configured 28 while the user's
    // own history says 30 would make the "next period" figure look wrong for a
    // reason the screen never explains.
    mockLoadCycleSettings.mockResolvedValue(ANCHORED);
    mockLoadPeriods.mockResolvedValue([
      period('2026-07-10'),
      period('2026-07-11'),
      period('2026-06-10'),
      period('2026-06-11'),
      period('2026-06-12'),
    ]);
    const tree = await render(<HealthCycleScreen />);

    expect(allText(byTestId(tree, 'health-cycle-average')[0])).toContain('30d');
    // …and the observed period length (runs of 2 and 3 days) is stated in the
    // plural it earned.
    expect(allText(tree.toJSON())).toContain('Your periods average 3 days.');
  });

  it('HEALTH-CYCLE-063: a single-day run is described in the singular', async () => {
    mockLoadCycleSettings.mockResolvedValue(ANCHORED);
    mockLoadPeriods.mockResolvedValue([period('2026-07-10'), period('2026-06-10')]);
    const tree = await render(<HealthCycleScreen />);

    expect(allText(tree.toJSON())).toContain('Your periods average 1 day.');
    expect(allText(tree.toJSON())).not.toContain('average 1 days');
  });

  it('HEALTH-CYCLE-064: a mood-family pattern is iconed as mood, not as a physical symptom', async () => {
    // The patterns list mixes physical symptoms and mood ones; the glyph is the
    // only thing that distinguishes them, and it is chosen by category.
    mockLoadSymptoms.mockResolvedValue([
      symptomEntry({ date: TODAY, symptoms: { anxiety: 2 } }),
      symptomEntry({ date: '2026-07-12', symptoms: { cramps: 3 } }),
    ]);
    const tree = await render(<HealthCycleScreen />);

    const iconNameIn = (id: string) =>
      tree.root
        .find((n) => n.props?.testID === id)
        .findAll((n) => typeof n.props?.name === 'string')
        .map((n) => n.props.name);

    expect(iconNameIn('health-cycle-pattern-anxiety')).toContain('mood');
    expect(iconNameIn('health-cycle-pattern-cramps')).toContain('symptoms');
  });

  it('HEALTH-CYCLE-065: a note is persisted on blur and on end-editing, never lost on the way out', async () => {
    // The notes field has no Save button — leaving the field IS the commit, so
    // both exit paths have to write or the note is silently dropped.
    const tree = await render(<HealthCycleScreen />);
    const input = tree.root.find(
      (n) =>
        (n.type as unknown as string) === 'TextInput' &&
        n.props?.testID === 'health-cycle-notes-input'
    );

    act(() => input.props.onChangeText('cramping in the evening'));
    await act(async () => input.props.onBlur());
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith(
      {
        notes: 'cramping in the evening',
      },
      TODAY
    );

    // `onEndEditing` carries the native text, which is what survives an
    // autocorrect the controlled value has not caught up with yet.
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: 'corrected' } }));
    expect(mockSaveSymptomEntry).toHaveBeenLastCalledWith({ notes: 'corrected' }, TODAY);
  });

  it('HEALTH-CYCLE-066: a past period day can be deleted from the recent list', async () => {
    // Deleting an OLD day is a different control from "remove today", and it is
    // the one that can re-anchor the cycle backwards.
    mockLoadCycleSettings.mockResolvedValue(ANCHORED);
    mockLoadPeriods.mockResolvedValue([period(TODAY), period('2026-07-10')]);
    const tree = await render(<HealthCycleScreen />);

    await act(async () => press(tree, 'health-cycle-delete-2026-07-10'));

    expect(mockRemovePeriodDay).toHaveBeenCalledWith('2026-07-10');
    // The anchor may have moved, so the settings are re-read (cf. HEALTH-CYCLE-054).
    expect(mockLoadCycleSettings).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------ */
/* Men's Health (Vitality)                                             */
/* ------------------------------------------------------------------ */

describe('HealthVitalityScreen', () => {
  it('HEALTH-VITALITY-050: an unlogged day shows the neutral baseline, not a zero', async () => {
    const tree = await render(<HealthVitalityScreen />);

    expect(byTestId(tree, 'health-vitality-screen').length).toBe(1);
    // 50 is the donor's neutral baseline. Rendering 0 would read as "you scored
    // badly" when the user simply has not logged anything yet.
    expect(allText(byTestId(tree, 'health-vitality-score')[0])).toBe('50');
    expect(allText(byTestId(tree, 'health-vitality-status')[0])).toBe('Room for improvement');
    expect(allText(tree.toJSON())).toContain('Not logged today');
  });

  it('HEALTH-VITALITY-051: renders the donor score for a logged day, sub-scores included', async () => {
    // Hand-computed against the donor formulas so a drift in the arithmetic
    // fails here rather than silently changing a number the user trusts:
    //   sexual = 50 + (8-5)*5 + 10 + (7-5)*3 = 81
    //   erection = 50 + 20 + (7-5)*2 + (8-5)*3 = 83
    //   energy = 7*10 = 70
    //   mental = 6*5 + 7*5 - (4-5)*3 = 68
    //   vitality = floor((81+83+70+68)/4) = 75
    const entry = vitality({
      libido: 8,
      hadPartnerSex: true,
      overallSatisfaction: 7,
      hadMorningErection: true,
      morningErectionQuality: 7,
      erectionQuality: 8,
      energyLevel: 7,
      mentalClarity: 6,
      mood: 7,
      stressLevel: 4,
    });
    expect(sexualHealthScore(entry)).toBe(81);
    expect(erectionScore(entry)).toBe(83);
    expect(energyScore(entry)).toBe(70);
    expect(mentalScore(entry)).toBe(68);
    expect(vitalityScore(entry)).toBe(75);
    expect(vitalityStatus(75)).toBe('Good condition');

    mockLoadVitalityForDate.mockResolvedValue(entry);
    const tree = await render(<HealthVitalityScreen />);

    expect(allText(byTestId(tree, 'health-vitality-score')[0])).toBe('75');
    expect(allText(byTestId(tree, 'health-vitality-status')[0])).toBe('Good condition');
    expect(allText(byTestId(tree, 'health-vitality-sub-sexual')[0])).toContain('81');
    expect(allText(byTestId(tree, 'health-vitality-sub-erection')[0])).toContain('83');
    expect(allText(byTestId(tree, 'health-vitality-sub-energy')[0])).toContain('70');
    expect(allText(byTestId(tree, 'health-vitality-sub-mental')[0])).toContain('68');
  });

  it('HEALTH-VITALITY-052: issues subtract from the score exactly as the donor did', async () => {
    // A day with issues must score BELOW the same day without them, by the
    // donor's exact deductions: −10 anxiety, −15 low desire on the sexual
    // sub-score; −20 / −15 on the erection sub-score.
    const clean = vitality({ libido: 6 });
    const troubled = vitality({
      libido: 6,
      hadPerformanceAnxiety: true,
      hadLowDesire: true,
      hadErectionDifficulty: true,
      hadMaintenanceDifficulty: true,
    });
    expect(sexualHealthScore(troubled)).toBe(sexualHealthScore(clean) - 25);
    expect(erectionScore(troubled)).toBe(erectionScore(clean) - 35);
    expect(vitalityScore(troubled)).toBeLessThan(vitalityScore(clean));
  });

  it('HEALTH-VITALITY-053: setting libido persists it', async () => {
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => press(tree, 'health-vitality-libido-8'));
    expect(mockSaveVitality).toHaveBeenCalledWith({ libido: 8 });
  });

  it('HEALTH-VITALITY-054: satisfaction only appears once there was activity', async () => {
    const tree = await render(<HealthVitalityScreen />);
    // Rating satisfaction with nothing to rate is meaningless, so the row is
    // conditional — and it feeds the score, so it must not be silently absent
    // once it IS relevant.
    expect(byTestId(tree, 'health-vitality-satisfaction').length).toBe(0);

    mockLoadVitalityForDate.mockResolvedValue(vitality({ hadPartnerSex: true }));
    const withActivity = await render(<HealthVitalityScreen />);
    expect(byTestId(withActivity, 'health-vitality-satisfaction').length).toBe(1);
  });

  it('HEALTH-VITALITY-055: morning-erection quality only appears once one is recorded', async () => {
    const tree = await render(<HealthVitalityScreen />);
    expect(byTestId(tree, 'health-vitality-morning-quality').length).toBe(0);

    mockLoadVitalityForDate.mockResolvedValue(vitality({ hadMorningErection: true }));
    const withMorning = await render(<HealthVitalityScreen />);
    expect(byTestId(withMorning, 'health-vitality-morning-quality').length).toBe(1);
  });

  it('HEALTH-VITALITY-056: toggling an issue persists it and updates the counter', async () => {
    mockLoadVitalityForDate.mockResolvedValue(
      vitality({ hadPerformanceAnxiety: true, hadLowDesire: true })
    );
    const tree = await render(<HealthVitalityScreen />);

    expect(allText(byTestId(tree, 'health-vitality-issue-count')[0])).toBe('2 noted');

    await act(async () => press(tree, 'health-vitality-issue-hadPainOrDiscomfort'));
    expect(mockSaveVitality).toHaveBeenCalledWith({ hadPainOrDiscomfort: true });
  });

  it('HEALTH-VITALITY-057: kegel sets are clamped, not stored raw', async () => {
    const tree = await render(<HealthVitalityScreen />);

    const input = tree.root.find(
      (n) =>
        (n.type as unknown as string) === 'TextInput' &&
        n.props?.testID === 'health-vitality-kegel-input'
    );
    act(() => input.props.onChangeText('999'));
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: '999' } }));

    // 50 is the sanity bound — an absurd count must not reach the store.
    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 50 });
  });

  it('HEALTH-VITALITY-058: the week summary counts only logged days', async () => {
    mockLoadVitality.mockResolvedValue([
      vitality({ date: TODAY, kegelSets: 3 }),
      vitality({ date: '2026-07-11', kegelSets: 2 }),
      // Outside the 7-day window — must not be counted.
      vitality({ date: '2026-01-01', kegelSets: 99 }),
    ]);
    const tree = await render(<HealthVitalityScreen />);

    expect(allText(byTestId(tree, 'health-vitality-week-days')[0])).toContain('2/7');
    expect(allText(byTestId(tree, 'health-vitality-week-kegels')[0])).toContain('5');
  });

  it('HEALTH-VITALITY-059: carries the donor disclaimer and the on-device promise', async () => {
    const tree = await render(<HealthVitalityScreen />);
    const text = allText(byTestId(tree, 'health-vitality-disclaimer')[0]);

    // Wellness log, not a diagnosis — the donor shipped this card and the BRD
    // forbids clinical claims.
    expect(text).toContain('not a medical assessment');
    expect(text).toContain('talk to a doctor');
    expect(text).toContain('never shared with other Symply apps');
  });

  /* ---------------------------------------------------------------- */
  /* Every control writes the field it is labelled with                */
  /* ---------------------------------------------------------------- */

  /**
   * Twenty-odd rows on this tab share three components and one `persist()`
   * call, so the ONLY thing separating "Mood" from "Sleep quality" is the key
   * name in the closure. A copy-paste there logs one intimate fact under
   * another's name, changes the vitality score, and looks completely correct on
   * screen. Only HEALTH-VITALITY-053 (libido) and 056 (one issue) were pinned;
   * the rest are below.
   */
  const DRIVE_AND_ENERGY: Array<[testID: string, field: keyof VitalityEntry]> = [
    ['health-vitality-desire', 'sexualDesireLevel'],
    ['health-vitality-energy', 'energyLevel'],
    ['health-vitality-clarity', 'mentalClarity'],
    ['health-vitality-mood', 'mood'],
    ['health-vitality-sleep', 'sleepQuality'],
    ['health-vitality-stress', 'stressLevel'],
  ];

  it.each(DRIVE_AND_ENERGY)(
    'HEALTH-VITALITY-060: the %s scale writes `%s` and nothing else',
    async (testID, field) => {
      const tree = await render(<HealthVitalityScreen />);

      await act(async () => press(tree, `${testID}-7`));

      expect(mockSaveVitality).toHaveBeenCalledTimes(1);
      expect(mockSaveVitality).toHaveBeenCalledWith({ [field]: 7 });
    }
  );

  const TOGGLES: Array<[testID: string, field: keyof VitalityEntry]> = [
    ['health-vitality-partner-sex', 'hadPartnerSex'],
    ['health-vitality-solo', 'hadMasturbation'],
    ['health-vitality-orgasm', 'hadOrgasm'],
    ['health-vitality-morning', 'hadMorningErection'],
    ['health-vitality-erotic-dream', 'hadEroticDream'],
  ];

  it.each(TOGGLES)(
    'HEALTH-VITALITY-061: the %s toggle writes `%s` and nothing else',
    async (testID, field) => {
      const tree = await render(<HealthVitalityScreen />);

      await act(async () => press(tree, testID));

      expect(mockSaveVitality).toHaveBeenCalledTimes(1);
      expect(mockSaveVitality).toHaveBeenCalledWith({ [field]: true });
    }
  );

  it('HEALTH-VITALITY-062: the conditional erection rows write their own fields', async () => {
    // These two only exist once their gate is on, so they cannot be covered by
    // the table above — and they both feed the erection sub-score.
    mockLoadVitalityForDate.mockResolvedValue(
      vitality({ hadPartnerSex: true, hadMorningErection: true })
    );
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => press(tree, 'health-vitality-satisfaction-6'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ overallSatisfaction: 6 });

    await act(async () => press(tree, 'health-vitality-morning-quality-9'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ morningErectionQuality: 9 });

    await act(async () => press(tree, 'health-vitality-quality-4'));
    expect(mockSaveVitality).toHaveBeenLastCalledWith({ erectionQuality: 4 });
  });

  it('HEALTH-VITALITY-063: the SERVER row replaces the optimistic one after a save', async () => {
    // `persist` paints the tap immediately, then reconciles with the row the
    // store returns. Without the reconcile a value the server clamped would keep
    // rendering as the number the user typed, and the score below it would be
    // computed from a value that was never stored.
    mockSaveVitality.mockResolvedValue([
      vitality({ date: TODAY, libido: 10, kegelSets: 4, loggedAt: `${TODAY}T11:00:00.000Z` }),
    ]);
    const tree = await render(<HealthVitalityScreen />);

    await act(async () => press(tree, 'health-vitality-libido-3'));

    // The screen now shows the SERVER's day, not the optimistic `libido: 3`.
    expect(allText(byTestId(tree, 'health-vitality-week-kegels')[0])).toContain('4');
    expect(allText(byTestId(tree, 'health-vitality-history-2026-07-13')[0])).toContain('0 issues');
  });

  it('HEALTH-VITALITY-064: a stored kegel count opens the field pre-filled', async () => {
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 6 }));
    const tree = await render(<HealthVitalityScreen />);

    expect(kegelInput(tree).props.value).toBe('6');
  });

  it('HEALTH-VITALITY-065: submitting, blurring or tapping Save all commit the same draft', async () => {
    // Three affordances, one commit path. If they disagreed, a user who typed a
    // count and tapped away would silently lose it.
    for (const commit of ['onSubmitEditing', 'onBlur'] as const) {
      jest.clearAllMocks();
      mockLoadVitality.mockResolvedValue([]);
      mockLoadVitalityForDate.mockResolvedValue(null);
      mockSaveVitality.mockResolvedValue([]);

      const tree = await render(<HealthVitalityScreen />);
      const input = kegelInput(tree);
      act(() => input.props.onChangeText('12'));
      await act(async () => input.props[commit]());

      expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 12 });
    }

    jest.clearAllMocks();
    mockLoadVitality.mockResolvedValue([]);
    mockLoadVitalityForDate.mockResolvedValue(null);
    mockSaveVitality.mockResolvedValue([]);

    const tapped = await render(<HealthVitalityScreen />);
    act(() => kegelInput(tapped).props.onChangeText('12'));
    await act(async () => press(tapped, 'health-vitality-kegel-save'));

    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 12 });
  });

  it('HEALTH-VITALITY-066: clearing the field logs zero sets and empties it, not "0"', async () => {
    // A literal "0" left in the box reads as "I did zero sets" every time the
    // tab is opened; the placeholder is the honest state for an unlogged count.
    mockLoadVitalityForDate.mockResolvedValue(vitality({ kegelSets: 6 }));
    const tree = await render(<HealthVitalityScreen />);

    const input = kegelInput(tree);
    act(() => input.props.onChangeText(''));
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: '' } }));

    expect(mockSaveVitality).toHaveBeenCalledWith({ kegelSets: 0 });
    expect(kegelInput(tree).props.value).toBe('');
  });
});
