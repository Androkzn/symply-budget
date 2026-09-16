/**
 * Body tab — the entry surfaces migration 0131 added, driven through the REAL
 * screen.
 *
 * `screens/__tests__/HealthSectionScreens.test.tsx` owns the tab's original
 * shape (a tile per site, quick add, per-metric history, the two trend cards).
 * This file owns everything the comprehensive-sites rebuild put in front of the
 * member, none of which had a screen-level test:
 *
 *   · the DETAILED-SITES switch. Forty-one fields in front of someone who came
 *     to log a waist is a worse app, so most sit behind it — but a detailed site
 *     that already HAS a reading must stay visible, because hiding a number the
 *     member took the trouble to measure reads as data loss;
 *   · DATE NAVIGATION. A reading taken yesterday has to be logged against
 *     yesterday or the trend line and the compare card mean nothing; forward is
 *     blocked at today, because a tape cannot be run in the future;
 *   · the SESSION sheet — many sites saved as ONE row, which is what makes a
 *     later per-site delete leave the rest of the morning alone;
 *   · the per-day "recorded on" list, which is how a session is checked and
 *     corrected after it is saved.
 *
 * Only the storage-backed async functions are mocked. Every pure helper
 * (`parseMeasurementInput`, `bodyEntriesForDay`, `groupBodyMetrics`,
 * `bodyMetricTier`, `formatDayKey`) stays real, so what is asserted is what the
 * shipped screen would actually put on the glass.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  addBodyEntry,
  addBodySession,
  BODY_METRIC_HINTS,
  BODY_METRIC_LABELS,
  BODY_METRICS,
  bodyMetricTier,
  deleteBodyEntry,
  loadBodyEntries,
  PRIMARY_BODY_METRICS,
  type BodyEntry,
} from '../../healthBodyStorage';
import { loadWeightLog } from '../../healthLocalStorage';
import { EMPTY_WEIGHT_GOAL, loadWeightGoal } from '../../healthWeightStorage';
import { HealthBodyScreen } from '../../screens/HealthBodyScreen';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const TODAY = '2026-07-13';
const YESTERDAY = '2026-07-12';
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

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
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

// gifted-charts renders through SVG + measurement; the tab only has to prove it
// handed the right series over.
jest.mock('@components/ui/AppLineChart', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppLineChart: ({ data }: { data: Array<{ value: number }> }) =>
      ReactMock.createElement(View, {
        testID: 'app-line-chart',
        accessibilityValue: { text: data.map((p) => p.value).join(',') },
      }),
  };
});

jest.mock('../../healthBodyStorage', () => {
  const actual = jest.requireActual('../../healthBodyStorage');
  return {
    ...actual,
    loadBodyEntries: jest.fn(),
    addBodyEntry: jest.fn(),
    addBodySession: jest.fn(),
    deleteBodyEntry: jest.fn(),
  };
});

jest.mock('../../healthLocalStorage', () => {
  const actual = jest.requireActual('../../healthLocalStorage');
  return { ...actual, loadWeightLog: jest.fn() };
});

jest.mock('../../healthWeightStorage', () => {
  const actual = jest.requireActual('../../healthWeightStorage');
  return { ...actual, loadWeightGoal: jest.fn() };
});

const mockLoadBodyEntries = loadBodyEntries as jest.Mock;
const mockAddBodyEntry = addBodyEntry as jest.Mock;
const mockAddBodySession = addBodySession as jest.Mock;
const mockDeleteBodyEntry = deleteBodyEntry as jest.Mock;
const mockLoadWeightLog = loadWeightLog as jest.Mock;
const mockLoadWeightGoal = loadWeightGoal as jest.Mock;

function entry(over: Partial<BodyEntry> = {}): BodyEntry {
  const date = over.date ?? TODAY;
  return {
    id: over.id ?? `${over.metric ?? 'waist'}-${date}`,
    date,
    metric: over.metric ?? 'waist',
    value: over.value ?? 80,
    unit: over.unit ?? 'cm',
    loggedAt: over.loggedAt ?? `${date}T10:00:00.000Z`,
  };
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: Rendered, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

/** Fire onChange on a composite row (the toggle exposes `onChange`, not `onPress`). */
function toggle(tree: Rendered, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function',
  );
  act(() => node.props.onPress());
}

function input(tree: Rendered, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID,
  );
}

function type(tree: Rendered, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

async function render() {
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthBodyScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** A detailed site — behind the switch — and a primary one, for contrast. */
const DETAILED = BODY_METRICS.find((m) => bodyMetricTier(m) === 'detailed') as 'waistNavel';

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadBodyEntries.mockResolvedValue([]);
  mockAddBodyEntry.mockResolvedValue([]);
  mockAddBodySession.mockResolvedValue([]);
  mockDeleteBodyEntry.mockResolvedValue([]);
  mockLoadWeightLog.mockResolvedValue([]);
  mockLoadWeightGoal.mockResolvedValue(EMPTY_WEIGHT_GOAL);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Which sites are offered                                             */
/* ------------------------------------------------------------------ */

describe('HealthBodyScreen — detailed sites', () => {
  it('HEALTH-BODY-200: offers the donor’s own sheet up front and counts what is hidden', async () => {
    const tree = await render();

    // Every PRIMARY site has a tile and a chip…
    for (const metric of PRIMARY_BODY_METRICS) {
      expect(byTestId(tree, `health-body-summary-${metric}`)).toHaveLength(1);
      expect(byTestId(tree, `health-body-metric-${metric}`)).toHaveLength(1);
    }
    // …and every detailed one has neither, until asked for.
    expect(byTestId(tree, `health-body-summary-${DETAILED}`)).toHaveLength(0);

    // The switch says HOW MANY are behind it, so "detailed sites" is not a
    // door with an unknown number of rooms.
    const hidden = BODY_METRICS.length - PRIMARY_BODY_METRICS.length;
    expect(byTestId(tree, 'health-body-detailed-toggle')[0].props.accessibilityLabel).toBe(
      `Show detailed sites (${hidden} more)`,
    );
    expect(byTestId(tree, 'health-body-detailed-toggle')[0].props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('HEALTH-BODY-201: the switch reveals every remaining site, and puts them back', async () => {
    const tree = await render();

    toggle(tree, 'health-body-detailed-toggle');
    for (const metric of BODY_METRICS) {
      expect(byTestId(tree, `health-body-summary-${metric}`)).toHaveLength(1);
    }
    // Nothing is left to reveal, so the count drops out of the label rather
    // than reading "(0 more)".
    expect(byTestId(tree, 'health-body-detailed-toggle')[0].props.accessibilityLabel).toBe(
      'Show detailed sites',
    );

    toggle(tree, 'health-body-detailed-toggle');
    expect(byTestId(tree, `health-body-summary-${DETAILED}`)).toHaveLength(0);
  });

  it('HEALTH-BODY-202: a detailed site with a READING is never hidden', async () => {
    // Hiding a number the member measured would read as data loss — they would
    // have no way of knowing the switch was what took it away.
    mockLoadBodyEntries.mockResolvedValue([entry({ id: 'd1', metric: DETAILED, value: 88 })]);
    const tree = await render();

    expect(byTestId(tree, `health-body-summary-${DETAILED}`)[0].props.accessibilityLabel).toBe(
      `${BODY_METRIC_LABELS[DETAILED]}: 88 cm`,
    );
    // …and it is one fewer than the switch now offers.
    const hidden = BODY_METRICS.length - PRIMARY_BODY_METRICS.length - 1;
    expect(byTestId(tree, 'health-body-detailed-toggle')[0].props.accessibilityLabel).toBe(
      `Show detailed sites (${hidden} more)`,
    );
  });

  it('HEALTH-BODY-203: the compare card is offered only the sites on screen', async () => {
    // Otherwise the compare would list forty-one rows, most of them "— to —",
    // for a member who only ever taped a waist.
    mockLoadBodyEntries.mockResolvedValue([
      entry({ id: 'w1', date: TODAY, value: 78 }),
      entry({ id: 'w0', date: '2026-05-01', value: 84 }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-body-compare-row-waist')).toHaveLength(1);
    expect(byTestId(tree, `health-body-compare-row-${DETAILED}`)).toHaveLength(0);

    toggle(tree, 'health-body-detailed-toggle');
    expect(byTestId(tree, `health-body-compare-row-${DETAILED}`)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Date navigation                                                     */
/* ------------------------------------------------------------------ */

describe('HealthBodyScreen — the measurement date', () => {
  it('HEALTH-BODY-210: walks back a day at a time and says which day it is on', async () => {
    const tree = await render();

    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('Today');
    // "Back to today" is only offered when there is somewhere to go back FROM.
    expect(byTestId(tree, 'health-body-today-button')).toHaveLength(0);

    press(tree, 'health-body-prev-day');
    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('Yesterday');
    press(tree, 'health-body-prev-day');
    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('2026-07-11');

    press(tree, 'health-body-today-button');
    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('Today');
  });

  it('HEALTH-BODY-211: cannot be moved into the future', async () => {
    // A measurement cannot be taken later than now; the donor's own `nextDay()`
    // refuses the same move. Proven BEHAVIOURALLY — the tap is fired and the
    // label does not move — rather than by reading the disabled flag alone.
    const tree = await render();

    expect(byTestId(tree, 'health-body-next-day')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    press(tree, 'health-body-next-day');
    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('Today');

    press(tree, 'health-body-prev-day');
    expect(byTestId(tree, 'health-body-next-day')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
    press(tree, 'health-body-next-day');
    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('Today');
  });

  it('HEALTH-BODY-212: a quick add is stamped with the SELECTED day', async () => {
    // The whole point of the picker: a reading taken yesterday and typed today
    // belongs to yesterday, or the trend line is drawn on the wrong day.
    const tree = await render();

    press(tree, 'health-body-prev-day');
    press(tree, 'health-body-metric-chest');
    type(tree, 'health-body-value-input', '100');
    await act(async () => press(tree, 'health-body-add-button'));

    expect(mockAddBodyEntry).toHaveBeenCalledWith('chest', 100, 'cm', YESTERDAY);
    expect(input(tree, 'health-body-value-input').props.value).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* Quick add — unit, hint, validation                                  */
/* ------------------------------------------------------------------ */

describe('HealthBodyScreen — quick add', () => {
  it('HEALTH-BODY-220: the unit toggle is a real control, and it is remembered', async () => {
    // The field's accessibility label is derived from the ACTIVE unit, so it is
    // the proof the tap changed the screen and not just a highlight.
    const tree = await render();
    expect(input(tree, 'health-body-value-input').props.accessibilityLabel).toBe(
      'Waist value in cm',
    );

    press(tree, 'health-body-unit-in');
    expect(input(tree, 'health-body-value-input').props.accessibilityLabel).toBe(
      'Waist value in in',
    );
    expect(byTestId(tree, 'health-body-unit-cm')[0].props.accessibilityState).toEqual({
      selected: false,
    });

    // Body fat replaces the toggle with a badge — and does NOT forget the
    // length unit, which is still what the next circumference will use.
    press(tree, 'health-body-metric-bodyFat');
    expect(byTestId(tree, 'health-body-unit-cm')).toHaveLength(0);
    expect(byTestId(tree, 'health-body-percent-badge')[0].props.accessibilityLabel).toBe(
      'Measured in percent',
    );
    expect(input(tree, 'health-body-value-input').props.accessibilityLabel).toBe(
      'Body fat value in %',
    );

    press(tree, 'health-body-metric-hips');
    expect(input(tree, 'health-body-value-input').props.accessibilityLabel).toBe('Hips value in in');
    press(tree, 'health-body-unit-cm');
    expect(input(tree, 'health-body-value-input').props.accessibilityLabel).toBe('Hips value in cm');
  });

  it('HEALTH-BODY-221: the tape-placement hint follows the chosen site', async () => {
    // A trend only means something if the same point is measured each time, and
    // half these sites are defined by a landmark rather than "the widest bit".
    const tree = await render();

    expect(allText(byTestId(tree, 'health-body-metric-hint')[0])).toBe(BODY_METRIC_HINTS.waist);
    press(tree, 'health-body-metric-neck');
    expect(allText(byTestId(tree, 'health-body-metric-hint')[0])).toBe(BODY_METRIC_HINTS.neck);
    // And the placeholder names the site too, so the field is never ambiguous.
    expect(input(tree, 'health-body-value-input').props.placeholder).toBe('Enter neck');
  });

  it('HEALTH-BODY-222: nothing out of range or out of shape can be logged', async () => {
    const tree = await render();

    // Letters never even reach the draft — the field sanitises as it is typed,
    // because `decimal-pad` only picks a keyboard, it does not constrain paste.
    type(tree, 'health-body-value-input', '8o0');
    expect(input(tree, 'health-body-value-input').props.value).toBe('80');

    for (const refused of ['', '0', '401', '.']) {
      type(tree, 'health-body-value-input', refused);
      expect(byTestId(tree, 'health-body-add-button')[0].props.accessibilityState).toEqual({
        disabled: true,
      });
      await act(async () => press(tree, 'health-body-add-button'));
      // Also via the keyboard's "done", which is how most people commit.
      await act(async () => input(tree, 'health-body-value-input').props.onSubmitEditing());
    }
    expect(mockAddBodyEntry).not.toHaveBeenCalled();

    type(tree, 'health-body-value-input', '400');
    expect(byTestId(tree, 'health-body-add-button')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  it('HEALTH-BODY-223: the bound follows the SITE, not the field', async () => {
    // 150 is a plausible waist and an impossible body-fat percentage. The draft
    // survives the switch, so the same characters have to be re-judged against
    // the new site rather than staying accepted.
    const tree = await render();

    type(tree, 'health-body-value-input', '150');
    expect(byTestId(tree, 'health-body-add-button')[0].props.accessibilityState).toMatchObject({
      disabled: false,
    });

    press(tree, 'health-body-metric-bodyFat');
    expect(input(tree, 'health-body-value-input').props.value).toBe('150');
    expect(byTestId(tree, 'health-body-add-button')[0].props.accessibilityState).toMatchObject({
      disabled: true,
    });

    await act(async () => press(tree, 'health-body-add-button'));
    expect(mockAddBodyEntry).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* The session sheet                                                   */
/* ------------------------------------------------------------------ */

describe('HealthBodyScreen — the session sheet', () => {
  it('HEALTH-BODY-230: opens and closes, and is closed on arrival', async () => {
    const tree = await render();

    expect(byTestId(tree, 'health-body-session')).toHaveLength(0);
    // `toContain`, not `toBe`: the row also carries a chevron glyph, and the
    // word is what the member reads.
    expect(allText(byTestId(tree, 'health-body-session-toggle')[0])).toContain(
      'Log a full session',
    );

    press(tree, 'health-body-session-toggle');
    expect(byTestId(tree, 'health-body-session')).toHaveLength(1);
    expect(allText(byTestId(tree, 'health-body-session-toggle')[0])).toContain(
      'Close session form',
    );
    expect(byTestId(tree, 'health-body-session-toggle')[0].props.accessibilityState).toEqual({
      expanded: true,
    });

    press(tree, 'health-body-session-toggle');
    expect(byTestId(tree, 'health-body-session')).toHaveLength(0);
  });

  it('HEALTH-BODY-231: saves every filled site as ONE session, then empties the sheet', async () => {
    const tree = await render();
    press(tree, 'health-body-session-toggle');

    type(tree, 'health-body-session-field-waist', '80');
    type(tree, 'health-body-session-field-chest', '100.5');
    type(tree, 'health-body-session-field-bodyFat', '18');

    // The button counts what will actually be written, so nobody saves a sheet
    // believing more of it landed than did.
    expect(allText(byTestId(tree, 'health-body-session-save')[0])).toBe('Save 3 sites');
    await act(async () => press(tree, 'health-body-session-save'));

    expect(mockAddBodySession).toHaveBeenCalledTimes(1);
    expect(mockAddBodySession).toHaveBeenCalledWith(
      { waist: 80, chest: 100.5, bodyFat: 18 },
      'cm',
      TODAY,
    );
    // Emptied, so re-opening does not offer to save the same session twice.
    expect(input(tree, 'health-body-session-field-waist').props.value).toBe('');
    expect(allText(byTestId(tree, 'health-body-session-save')[0])).toBe('Fill in at least one site');
  });

  it('HEALTH-BODY-232: an empty sheet cannot be saved, and says what it needs', async () => {
    const tree = await render();
    press(tree, 'health-body-session-toggle');

    expect(byTestId(tree, 'health-body-session-save')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    await act(async () => press(tree, 'health-body-session-save'));
    // A row whose only content is a date would show up as a measurement day
    // with no measurement on it, and the compare card would offer it.
    expect(mockAddBodySession).not.toHaveBeenCalled();
  });

  it('HEALTH-BODY-233: a field that does not parse is neither counted nor sent', async () => {
    const tree = await render();
    press(tree, 'health-body-session-toggle');

    type(tree, 'health-body-session-field-waist', '80');
    type(tree, 'health-body-session-field-chest', '.'); // mid-decimal, not a number yet
    type(tree, 'health-body-session-field-hips', '999'); // past the sanity bound

    expect(allText(byTestId(tree, 'health-body-session-save')[0])).toBe('Save 1 site');
    await act(async () => press(tree, 'health-body-session-save'));
    expect(mockAddBodySession).toHaveBeenCalledWith({ waist: 80 }, 'cm', TODAY);
  });

  it('HEALTH-BODY-234: one unit governs the whole session, shared with quick add', async () => {
    // A tape does not change mid-body, and the donor's sheet has a single unit
    // picker for the same reason. Body fat keeps its own `%` regardless.
    const tree = await render();
    press(tree, 'health-body-session-toggle');

    press(tree, 'health-body-session-unit-in');
    expect(input(tree, 'health-body-session-field-waist').props.accessibilityLabel).toBe(
      'Waist in in',
    );
    expect(input(tree, 'health-body-session-field-bodyFat').props.accessibilityLabel).toBe(
      'Body fat in %',
    );
    // The quick-add field below follows it — one unit for the tab, not two that
    // can disagree.
    expect(input(tree, 'health-body-value-input').props.accessibilityLabel).toBe(
      'Waist value in in',
    );

    type(tree, 'health-body-session-field-waist', '31');
    await act(async () => press(tree, 'health-body-session-save'));
    expect(mockAddBodySession).toHaveBeenCalledWith({ waist: 31 }, 'in', TODAY);
  });

  it('HEALTH-BODY-235: a session is written against the SELECTED day', async () => {
    const tree = await render();

    press(tree, 'health-body-prev-day');
    press(tree, 'health-body-session-toggle');
    type(tree, 'health-body-session-field-waist', '80');

    // The button names the day, so a back-dated session cannot be saved by
    // someone who thinks they are logging today.
    expect(byTestId(tree, 'health-body-session-save')[0].props.accessibilityLabel).toBe(
      'Save 1 measurements for yesterday',
    );
    await act(async () => press(tree, 'health-body-session-save'));
    expect(mockAddBodySession).toHaveBeenCalledWith({ waist: 80 }, 'cm', YESTERDAY);
  });

  it('HEALTH-BODY-236: closing the sheet does not throw away what was typed', async () => {
    // Collapsing the form to check a figure on the card above is not a cancel.
    // Losing eight taped sites to a stray tap would be unrecoverable — the tape
    // is already back in the drawer.
    const tree = await render();
    press(tree, 'health-body-session-toggle');
    type(tree, 'health-body-session-field-waist', '80');

    press(tree, 'health-body-session-toggle');
    press(tree, 'health-body-session-toggle');

    expect(input(tree, 'health-body-session-field-waist').props.value).toBe('80');
    expect(allText(byTestId(tree, 'health-body-session-save')[0])).toBe('Save 1 site');
  });
});

/* ------------------------------------------------------------------ */
/* What is already on the day                                          */
/* ------------------------------------------------------------------ */

describe('HealthBodyScreen — the day’s readings', () => {
  const twoDays = () => [
    entry({ id: 'w-today', metric: 'waist', date: TODAY, value: 78 }),
    entry({ id: 'c-today', metric: 'chest', date: TODAY, value: 101 }),
    entry({ id: 'w-old', metric: 'waist', date: YESTERDAY, value: 80 }),
  ];

  it('HEALTH-BODY-240: lists the selected day’s sites, and only those', async () => {
    mockLoadBodyEntries.mockResolvedValue(twoDays());
    const tree = await render();

    expect(byTestId(tree, 'health-body-day-row-waist')).toHaveLength(1);
    expect(byTestId(tree, 'health-body-day-row-chest')).toHaveLength(1);
    expect(allText(byTestId(tree, 'health-body-day-row-waist')[0])).toContain('78 cm');

    press(tree, 'health-body-prev-day');
    // Yesterday held the waist only — chest must not leak across the day.
    expect(byTestId(tree, 'health-body-day-row-chest')).toHaveLength(0);
    expect(allText(byTestId(tree, 'health-body-day-row-waist')[0])).toContain('80 cm');
  });

  it('HEALTH-BODY-241: an untouched day says so, naming the day', async () => {
    mockLoadBodyEntries.mockResolvedValue(twoDays());
    const tree = await render();

    press(tree, 'health-body-prev-day');
    press(tree, 'health-body-prev-day');
    expect(allText(byTestId(tree, 'health-body-day-empty')[0])).toBe(
      'Nothing recorded for 2026-07-11 yet.',
    );
  });

  it('HEALTH-BODY-242: a site can be removed from the day it was recorded on', async () => {
    mockLoadBodyEntries.mockResolvedValue(twoDays());
    // Removing the waist leaves the rest of the session alone — the promise the
    // per-site clear exists to keep.
    mockDeleteBodyEntry.mockResolvedValue([
      entry({ id: 'c-today', metric: 'chest', date: TODAY, value: 101 }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-body-day-remove-waist')[0].props.accessibilityLabel).toBe(
      'Remove waist from today',
    );
    await act(async () => press(tree, 'health-body-day-remove-waist'));

    expect(mockDeleteBodyEntry).toHaveBeenCalledWith('w-today');
    expect(byTestId(tree, 'health-body-day-row-waist')).toHaveLength(0);
    expect(byTestId(tree, 'health-body-day-row-chest')).toHaveLength(1);
  });

  it('HEALTH-BODY-243: history is labelled by the day a reading was TAKEN', async () => {
    // Not the day it was typed. As soon as anything is back-dated those are
    // different, and a history that showed the typing date would report every
    // catch-up session as having happened on one day.
    mockLoadBodyEntries.mockResolvedValue([
      entry({ id: 'w1', date: TODAY, value: 78 }),
      entry({ id: 'w0', date: YESTERDAY, value: 80, loggedAt: `${TODAY}T09:00:00.000Z` }),
    ]);
    const tree = await render();

    // Both rows are on screen…
    expect(byTestId(tree, 'health-body-delete-w0')).toHaveLength(1);
    expect(byTestId(tree, 'health-body-delete-w1')).toHaveLength(1);
    // …and "Yesterday" appears exactly once in the whole tab. Nothing else on
    // the screen can produce it: the day picker and the per-day card are both
    // on TODAY, and the charts label by `12 Jul`. So the one occurrence is the
    // history stamp for `w0` — which was TYPED today and TAKEN yesterday. A
    // history built on `loggedAt` would read "Today" for both rows.
    const text = allText(tree.toJSON());
    expect(text.split('Yesterday')).toHaveLength(2);
    expect(allText(byTestId(tree, 'health-body-day-label')[0])).toBe('Today');
  });

  it('HEALTH-BODY-250: the composition card is fed from the WEIGHT tab, not re-collected', async () => {
    // Height, sex, birth year and activity level live on the weight goal (0125)
    // and the weight itself on the weight log. The Body tab READS both — asking
    // for a height twice is how two tabs come to disagree about one BMI.
    mockLoadWeightLog.mockResolvedValue([
      {
        id: 'wt1',
        value: 80,
        unit: 'kg',
        date: TODAY,
        note: '',
        source: 'manual',
        loggedAt: `${TODAY}T08:00:00.000Z`,
      },
    ]);
    mockLoadWeightGoal.mockResolvedValue({
      ...EMPTY_WEIGHT_GOAL,
      heightCm: 180,
      gender: 'male',
      birthYear: 1990,
      activityLevel: 'moderatelyActive',
    });
    mockLoadBodyEntries.mockResolvedValue([
      entry({ id: 'bf', metric: 'bodyFat', unit: '%', value: 18 }),
    ]);
    const tree = await render();

    expect(allText(byTestId(tree, 'health-body-dashboard-bmi')[0])).toContain('24.7');
    expect(allText(byTestId(tree, 'health-body-dashboard-bmr')[0])).toContain('1750 kcal');
    expect(allText(byTestId(tree, 'health-body-dashboard-lean-mass')[0])).toContain('65.6 kg');
    // Nothing outstanding, so the card does not nag.
    expect(byTestId(tree, 'health-body-dashboard-composition-missing')).toHaveLength(0);
  });

  it('HEALTH-BODY-251: a site that GREW points the arrow the other way', async () => {
    // The arrow reports direction and nothing else — it is not a verdict. Both
    // directions have to be drawn, or a gaining site would read as a losing one.
    mockLoadBodyEntries.mockResolvedValue([
      entry({ id: 'c1', metric: 'chest', date: TODAY, value: 102 }),
      entry({ id: 'c0', metric: 'chest', date: '2026-07-06', value: 100 }),
      entry({ id: 'w1', metric: 'waist', date: TODAY, value: 78 }),
      entry({ id: 'w0', metric: 'waist', date: '2026-07-06', value: 80 }),
    ]);
    const tree = await render();

    // `Icon` forwards `name` down its own tree, so the assertion is on which
    // glyph is present rather than on how many nodes carry it.
    const arrows = (testID: string) => {
      const tile = tree.root.find((n) => n.props?.testID === testID);
      return {
        up: tile.findAll((n) => n.props?.name === 'arrow-up').length,
        down: tile.findAll((n) => n.props?.name === 'arrow-down').length,
        text: allText(tile),
      };
    };

    expect(arrows('health-body-summary-chest')).toMatchObject({ down: 0 });
    expect(arrows('health-body-summary-chest').up).toBeGreaterThan(0);
    expect(arrows('health-body-summary-chest').text).toContain('2 cm');

    expect(arrows('health-body-summary-waist')).toMatchObject({ up: 0 });
    expect(arrows('health-body-summary-waist').down).toBeGreaterThan(0);
  });

  it('HEALTH-BODY-245: a reading can also be deleted from the site’s own history', async () => {
    // Two delete controls reach the same reading — the per-day list and the
    // per-site history — because "undo what I just typed" and "that March
    // figure was wrong" are found in different places. Both must work.
    mockLoadBodyEntries.mockResolvedValue([
      entry({ id: 'w1', date: TODAY, value: 78 }),
      entry({ id: 'w0', date: '2026-05-01', value: 84 }),
    ]);
    mockDeleteBodyEntry.mockResolvedValue([entry({ id: 'w1', date: TODAY, value: 78 })]);
    const tree = await render();

    expect(byTestId(tree, 'health-body-delete-w0')[0].props.accessibilityLabel).toBe(
      'Delete measurement',
    );
    await act(async () => press(tree, 'health-body-delete-w0'));

    expect(mockDeleteBodyEntry).toHaveBeenCalledWith('w0');
    expect(byTestId(tree, 'health-body-delete-w0')).toHaveLength(0);
    expect(byTestId(tree, 'health-body-delete-w1')).toHaveLength(1);
  });

  it('HEALTH-BODY-244: the history card shows the most recent eight readings', async () => {
    // The cap exists so a long-running site does not push the rest of the tab
    // off the screen. It has to keep the NEWEST eight — an oldest-eight cap
    // would freeze the card on the first week the member ever measured.
    mockLoadBodyEntries.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) =>
        entry({ id: `w${i}`, date: `2026-07-${String(12 - i).padStart(2, '0')}`, value: 80 + i }),
      ),
    );
    const tree = await render();

    expect(byTestId(tree, 'health-body-delete-w0')).toHaveLength(1);
    expect(byTestId(tree, 'health-body-delete-w7')).toHaveLength(1);
    expect(byTestId(tree, 'health-body-delete-w8')).toHaveLength(0);
  });
});
