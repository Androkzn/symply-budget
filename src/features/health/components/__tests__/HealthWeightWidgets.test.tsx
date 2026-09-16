/**
 * Symply Health — the fourteen Weight-dashboard widgets.
 *
 * The donor's `WeightDashboardWidgetType` declares fourteen cases and its
 * `widgetView(for:)` switches over all of them, so the first thing asserted here
 * is that all fourteen exist and every one renders. Five of the donor's are
 * "coming soon" placeholders; four of those are built for real here, so this
 * suite also pins that they show REAL figures rather than a promise.
 *
 * The second theme is the refusals. Every widget that cannot honestly answer
 * says so in words and names what would fill it — a zero, an em-dash grid or a
 * blank card would each read as data loss on a health screen.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { DatedValue } from '../../healthDashboards';
import {
  bodyCompositionFor,
  calorieWeightCorrelation,
  monthOverMonth,
  monthlyWeightProgress,
  periodComparison,
  weekOverWeek,
  weightGoalProgress,
  weightHistoryStats,
  weightLoggingStreak,
  weightProjection,
} from '../../healthWeightAnalytics';
import {
  HealthWeightWidget,
  WEIGHT_WIDGETS,
  WEIGHT_WIDGET_KEYS,
  strengthLabel,
  type WeightWidgetKey,
  type WeightWidgetModel,
} from '../HealthWeightWidgets';

const TODAY = '2026-07-13';

function day(date: string, value: number): DatedValue {
  return { date, value };
}

/** A log dense enough that every widget has something real to say. */
const DENSE: DatedValue[] = [
  day('2026-05-04', 90),
  day('2026-05-18', 88),
  day('2026-06-01', 86),
  day('2026-06-15', 85),
  day('2026-07-06', 82),
  day('2026-07-07', 81.5),
  day('2026-07-11', 81),
  day('2026-07-12', 80.5),
  day('2026-07-13', 80),
];

function buildModel(over: Partial<WeightWidgetModel> = {}): WeightWidgetModel {
  const allDaily = over.allDaily ?? DENSE;
  const history = weightHistoryStats(allDaily);
  const target = over.target === undefined ? 75 : over.target;
  return {
    unit: 'kg',
    windowLabel: '14 Jun – 13 Jul',
    daily: allDaily.filter((d) => d.date >= '2026-06-14'),
    allDaily,
    target,
    progress: weightGoalProgress({
      current: history.current?.value ?? null,
      target,
      baseline: history.starting?.value ?? null,
    }),
    streak: weightLoggingStreak(
      allDaily.map((d) => d.date),
      TODAY
    ),
    history,
    projection: weightProjection(allDaily),
    monthly: monthlyWeightProgress(allDaily),
    windowCompare: periodComparison(
      allDaily,
      { label: 'This window', start: '2026-06-14', end: TODAY },
      { label: 'Previous', start: '2026-05-15', end: '2026-06-13' }
    ),
    week: weekOverWeek(allDaily, TODAY),
    month: monthOverMonth(allDaily, TODAY),
    bmi: 25.3,
    bmr: 1718,
    tdee: 2663,
    activityLevel: 'moderatelyActive',
    composition: bodyCompositionFor(80, 20),
    correlation: calorieWeightCorrelation(
      ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'].map(
        (weekStart, i) => ({ weekStart, average: 2000 + i * 150 })
      ),
      // Deliberately UNEVEN weekly losses: a constant −1 kg every week has zero
      // variance, so Pearson's r is undefined and the widget quotes nothing.
      [85, 84, 82.5, 82, 80].map((average, i) => ({
        weekStart: ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'][i],
        average,
      }))
    ),
    chart: null,
    ...over,
  };
}

/** A brand-new account: nothing logged, no goal, no biometrics. */
function emptyModel(): WeightWidgetModel {
  return buildModel({
    allDaily: [],
    daily: [],
    target: null,
    bmi: null,
    bmr: null,
    tdee: null,
    activityLevel: null,
    composition: null,
    correlation: { r: null, samples: 0, averageCalories: null, averageChange: null },
  });
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

async function render(widget: WeightWidgetKey, model: WeightWidgetModel) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthWeightWidget widget={widget} model={model} />
      </ThemeProvider>
    );
  });
  return tree;
}

type Json = { props?: Record<string, unknown>; children?: unknown } | string | number | null;

/** Depth-first search of the RENDERED json for a node carrying `testID`. */
function findJson(json: unknown, testID: string): Json {
  if (json == null || typeof json !== 'object') return null;
  if (Array.isArray(json)) {
    for (const child of json) {
      const hit = findJson(child, testID);
      if (hit) return hit;
    }
    return null;
  }
  const node = json as { props?: Record<string, unknown>; children?: unknown };
  if (node.props?.testID === testID) return node;
  return findJson(node.children, testID);
}

function text(tree: ReactTestRenderer.ReactTestRenderer, testID: string): string {
  const node = findJson(tree.toJSON(), testID);
  if (node === null) throw new Error(`no node with testID "${testID}"`);
  return allText(node);
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return (
    tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0
  );
}

describe('the fourteen widgets', () => {
  it('HEALTH-WEIGHT-240: all fourteen donor cases exist, with no duplicates', () => {
    expect(WEIGHT_WIDGET_KEYS).toHaveLength(14);
    expect(new Set(WEIGHT_WIDGET_KEYS).size).toBe(14);
    expect(WEIGHT_WIDGETS.map((w) => w.key)).toEqual([...WEIGHT_WIDGET_KEYS]);
    for (const meta of WEIGHT_WIDGETS) {
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it('HEALTH-WEIGHT-241: every widget renders with real data', async () => {
    const model = buildModel();
    for (const key of WEIGHT_WIDGET_KEYS) {
      const tree = await render(key, model);
      expect(has(tree, `health-weight-widget-${key}`)).toBe(true);
    }
  });

  it('HEALTH-WEIGHT-242: every widget renders on an EMPTY account without throwing', async () => {
    const model = emptyModel();
    for (const key of WEIGHT_WIDGET_KEYS) {
      const tree = await render(key, model);
      expect(has(tree, `health-weight-widget-${key}`)).toBe(true);
    }
  });

  it('HEALTH-WEIGHT-269: a widget key this build no longer ships renders nothing at all', async () => {
    // The saved layout is a list of plain strings kept on the device, so a
    // handset upgrading past a removed widget still asks for it by name. That
    // has to draw nothing rather than take the whole Weight tab down.
    const tree = await render('mealPlanner' as WeightWidgetKey, buildModel());
    expect(tree.root.findAll((n) => typeof n.type === 'string')).toHaveLength(0);
  });
});

describe('goal progress', () => {
  it('HEALTH-WEIGHT-250: shows current, target and the distance left', async () => {
    const tree = await render('goalProgress', buildModel());
    expect(text(tree, 'health-weight-goal-current')).toContain('80');
    expect(text(tree, 'health-weight-goal-target')).toContain('75');
    expect(text(tree, 'health-weight-goal-remaining')).toContain('5');
  });

  it('HEALTH-WEIGHT-251: with no target it asks for one instead of showing an empty ring', async () => {
    const tree = await render('goalProgress', buildModel({ target: null }));
    expect(has(tree, 'health-weight-goal-ring')).toBe(false);
    expect(text(tree, 'health-weight-goal-empty')).toMatch(/set one/i);
  });

  it('HEALTH-WEIGHT-243: a target already met reads "Reached · Yes", not "-1 kg to go"', async () => {
    // Passing the target keeps `remaining` positive for a losing goal, and
    // printing that raw would tell someone who is a kilo under their target
    // that they still have a kilo to lose.
    const met = buildModel({
      allDaily: [day('2026-05-01', 90), day('2026-06-01', 82), day('2026-07-13', 74)],
      target: 75,
    });

    const tree = await render('goalProgress', met);
    expect(text(tree, 'health-weight-goal-remaining')).toBe('ReachedYes');
    expect(text(tree, 'health-weight-goal-current')).toContain('74');

    const insights = await render('aiInsights', met);
    expect(allText(insights.toJSON())).toMatch(/at or past your target weight/i);
  });

  it('HEALTH-WEIGHT-244: a maintain goal says it is measured against holding today’s weight', async () => {
    // Baseline == target, so there is no distance to be a fraction of; claiming
    // progress "from your starting weight" would be measuring against itself.
    const holding = buildModel({ allDaily: [day('2026-07-13', 80)], target: 80 });
    const tree = await render('goalProgress', holding);

    expect(allText(tree.toJSON())).toMatch(/holding your current weight/i);
    expect(allText(tree.toJSON())).not.toMatch(/where you started/i);
  });
});

describe('averages + weekly change', () => {
  it('HEALTH-WEIGHT-252: the data stack names both periods and discloses the day counts', async () => {
    const tree = await render('dataStack', buildModel());
    expect(text(tree, 'health-weight-dataStack-current')).toContain('This window');
    expect(text(tree, 'health-weight-dataStack-previous')).toContain('Previous');
    expect(allText(tree.toJSON())).toMatch(/days you logged/i);
  });

  it('HEALTH-WEIGHT-253: with nothing in either window it says so rather than showing 0.0 kg', async () => {
    const tree = await render('dataStack', emptyModel());
    expect(text(tree, 'health-weight-dataStack-empty')).toMatch(/nothing logged/i);
  });

  it('HEALTH-WEIGHT-273: a first window shows — for the one before it, never 0.0 kg', async () => {
    // A member in their first month has nothing to compare against. Printing a
    // zero average there would read as "you weighed nothing last month" and make
    // the change beside it a −80 kg cliff.
    const first = buildModel({ allDaily: [day('2026-07-13', 80)] });
    const tree = await render('dataStack', first);

    expect(text(tree, 'health-weight-dataStack-current')).toContain('80 kg');
    expect(text(tree, 'health-weight-dataStack-previous')).toBe('Previous—');
    expect(text(tree, 'health-weight-dataStack-change')).toBe('Change—');
  });

  it('HEALTH-WEIGHT-254: the weekly change carries a sign and a percentage', async () => {
    const tree = await render('weeklyChange', buildModel());
    expect(text(tree, 'health-weight-weekly-change')).toMatch(/[-+]/);
    expect(text(tree, 'health-weight-weekly-percent')).toContain('%');
  });

  it('HEALTH-WEIGHT-248: a rise carries an explicit +, and an unworkable percent shows —', async () => {
    // 8 Jul is last week, 13 Jul (a Monday) opens this one.
    const rising = await render(
      'weeklyChange',
      buildModel({ allDaily: [day('2026-07-08', 80), day('2026-07-13', 82)] })
    );
    // Without the sign "2 kg" is read as a loss on a weight screen.
    expect(text(rising, 'health-weight-weekly-change')).toContain('+2 kg');
    expect(text(rising, 'health-weight-weekly-percent')).toContain('+2.5%');

    // A previous week averaging zero has no percentage to be a share OF, and
    // "Infinity%" or "NaN%" beside a real kilo figure destroys trust in both.
    const undividable = await render(
      'weeklyChange',
      buildModel({ allDaily: [day('2026-07-08', 0), day('2026-07-13', 2)] })
    );
    expect(text(undividable, 'health-weight-weekly-change')).toContain('+2 kg');
    expect(text(undividable, 'health-weight-weekly-percent')).toBe('Percent—');
  });
});

describe('body metrics', () => {
  it('HEALTH-WEIGHT-255: BMI shows its band and explains what it cannot see', async () => {
    const tree = await render('bmiTracker', buildModel());
    expect(text(tree, 'health-weight-bmi-value')).toBe('25.3');
    expect(text(tree, 'health-weight-bmi-band')).toContain('Overweight');
    expect(text(tree, 'health-weight-bmi-bmr')).toContain('1718');
    expect(allText(tree.toJSON())).toMatch(/muscle and fat/i);
  });

  it('HEALTH-WEIGHT-256: without a height it asks for one rather than printing a BMI of 0', async () => {
    const tree = await render('bmiTracker', buildModel({ bmi: null, bmr: null, tdee: null }));
    expect(text(tree, 'health-weight-bmi-empty')).toMatch(/height/i);
  });

  it('HEALTH-WEIGHT-245: a BMI without a birth year shows the band and no BMR block at all', async () => {
    // Height alone yields a BMI; Mifflin–St Jeor also needs an age and a sex, so
    // the burn row is absent rather than showing three em-dashes.
    const tree = await render(
      'bmiTracker',
      buildModel({ bmi: 25.3, bmr: null, tdee: null, activityLevel: null })
    );
    expect(text(tree, 'health-weight-bmi-value')).toBe('25.3');
    expect(has(tree, 'health-weight-bmi-bmr')).toBe(false);
    expect(has(tree, 'health-weight-bmi-empty')).toBe(false);
  });

  it('HEALTH-WEIGHT-246: a BMR with no activity level shows — rather than assuming sedentary', async () => {
    // A defaulted multiplier turns into a daily calorie figure the member is
    // shown as fact, so both the burn and the level stay blank until chosen.
    const tree = await render(
      'bmiTracker',
      buildModel({ bmi: 25.3, bmr: 1718, tdee: null, activityLevel: null })
    );
    expect(text(tree, 'health-weight-bmi-bmr')).toContain('1718 kcal');
    expect(text(tree, 'health-weight-bmi-tdee')).toBe('Daily burn—');
    expect(text(tree, 'health-weight-bmi-activity')).toBe('Activity—');
  });

  it('HEALTH-WEIGHT-257: composition splits weight and names where the percentage came from', async () => {
    const tree = await render('bodyComposition', buildModel());
    expect(text(tree, 'health-weight-composition-fat-mass')).toContain('16');
    expect(text(tree, 'health-weight-composition-lean-mass')).toContain('64');
    expect(allText(tree.toJSON())).toMatch(/Body tab/);
  });

  it('HEALTH-WEIGHT-258: lean mass without a body-fat reading points at the Body tab', async () => {
    const tree = await render('leanMass', buildModel({ composition: null }));
    expect(text(tree, 'health-weight-lean-empty')).toMatch(/Body tab/);
  });
});

describe('the four donor placeholders that are built for real', () => {
  it('HEALTH-WEIGHT-260: monthly progress lists months with their day counts', async () => {
    const tree = await render('monthlyProgress', buildModel());
    expect(has(tree, 'health-weight-monthly-2026-07')).toBe(true);
    expect(has(tree, 'health-weight-monthly-2026-05')).toBe(true);
    expect(allText(tree.toJSON())).toMatch(/mean of the days you logged/i);
  });

  it('HEALTH-WEIGHT-267: every month row carries its day count, and a broken key still reads', async () => {
    // The caption promises "the day count is on the right", so it has to be on
    // EVERY row — a −4 kg month built from two readings must be readable as
    // such. The second row's key lost its month, and a bare `new Date` on that
    // renders "Invalid Date" straight onto the card.
    const tree = await render(
      'monthlyProgress',
      buildModel({
        monthly: monthlyWeightProgress([
          day('2026', 80),
          day('2026-06-01', 86),
          day('2026-06-20', 84),
          day('2026-07-13', 81),
        ]),
      })
    );

    expect(text(tree, 'health-weight-monthly-2026-06')).toContain('2 d');
    // June → July is a fall of 4 kg over a single July reading: both figures.
    expect(text(tree, 'health-weight-monthly-2026-07')).toContain('-4 kg · 1 d');
    const broken = text(tree, 'health-weight-monthly-2026');
    expect(broken).toContain('2026');
    expect(broken).not.toMatch(/Invalid|NaN/);
  });

  it('HEALTH-WEIGHT-261: the streak reports current and best, and explains the grace day', async () => {
    const tree = await render('streaks', buildModel());
    expect(text(tree, 'health-weight-streak-current')).toContain('3 d');
    expect(allText(tree.toJSON())).toMatch(/end of the following day/i);
  });

  it('HEALTH-WEIGHT-262: the projection states its sample size and its assumption', async () => {
    const tree = await render('predictions', buildModel());
    expect(text(tree, 'health-weight-projection-rate')).toMatch(/[-+]/);
    expect(allText(tree.toJSON())).toMatch(/fitted through 9 readings/i);
    expect(allText(tree.toJSON())).toMatch(/assumes nothing changes/i);
  });

  it('HEALTH-WEIGHT-263: too few readings refuses to project, and says why', async () => {
    const tree = await render(
      'predictions',
      buildModel({ allDaily: [day('2026-07-12', 80), day('2026-07-13', 79)] })
    );
    expect(text(tree, 'health-weight-projection-empty')).toMatch(/water weight/i);
  });

  it('HEALTH-WEIGHT-274: a projection with no target shows no arrival date, and says why', async () => {
    // The rate and the 30-day figure stand on their own; an arrival date needs
    // somewhere to arrive, so the tile is an em-dash and the note asks for one.
    const tree = await render('predictions', buildModel({ target: null }));

    expect(text(tree, 'health-weight-projection-eta')).toBe('Target in—');
    expect(text(tree, 'health-weight-projection-rate')).toMatch(/kg/);
    expect(allText(tree.toJSON())).toMatch(/set a target to see an arrival date/i);
  });

  it('HEALTH-WEIGHT-264: the correlation is weekly, names its sample and denies causation', async () => {
    const tree = await render('calorieCorrelation', buildModel());
    expect(has(tree, 'health-weight-correlation-strength')).toBe(true);
    const body = allText(tree.toJSON());
    expect(body).toMatch(/Weekly, not daily/i);
    expect(body).toMatch(/not one causing the other/i);
  });

  it('HEALTH-WEIGHT-265: too few weeks quotes no coefficient at all', async () => {
    const tree = await render(
      'calorieCorrelation',
      buildModel({
        correlation: { r: 0.99, samples: 2, averageCalories: 2000, averageChange: -0.5 },
      })
    );
    expect(text(tree, 'health-weight-correlation-empty')).toMatch(/at least 4 weeks/i);
  });

  it('HEALTH-WEIGHT-266: measurements sends the member to the Body tab that owns them', async () => {
    const onOpenBody = jest.fn();
    const tree = await render('measurements', buildModel({ onOpenBody }));
    const link = tree.root.find(
      (n) => n.props?.testID === 'health-weight-measurements-open' && n.props?.onPress
    );
    act(() => link.props.onPress());
    expect(onOpenBody).toHaveBeenCalled();
  });
});

describe('history + insights', () => {
  it('HEALTH-WEIGHT-270: history carries a DATE for every extreme', async () => {
    const tree = await render('weightHistory', buildModel());
    expect(text(tree, 'health-weight-history-starting')).toContain('90');
    expect(text(tree, 'health-weight-history-lowest')).toContain('80');
    // The donor prints four bare numbers; a "lowest 68.2" with no date cannot
    // be acted on.
    expect(allText(tree.toJSON())).toMatch(/4 May/);
  });

  it('HEALTH-WEIGHT-271: insights read the member’s own numbers and say nothing leaves the device', async () => {
    const tree = await render('aiInsights', buildModel());
    const body = allText(tree.toJSON());
    expect(body).toMatch(/Nothing is sent anywhere/i);
    expect(body).toMatch(/a week/i);
  });

  it('HEALTH-WEIGHT-272: with nothing to say, insights invite more logging', async () => {
    const tree = await render('aiInsights', emptyModel());
    expect(text(tree, 'health-weight-insights-empty')).toMatch(/log a few more/i);
  });

  it('HEALTH-WEIGHT-259: a fall is stated as a magnitude, never as "fell -5.3 kg"', async () => {
    // The direction is already in the verb, so a signed figure after it is a
    // double negative that reads as a gain.
    const body = allText((await render('aiInsights', buildModel())).toJSON());
    expect(body).toContain('Your average fell 5.3 kg against the previous window.');
    expect(body).not.toMatch(/fell -/);
  });

  it('HEALTH-WEIGHT-247: a rising log reads as gaining, and one day is not "1 days"', async () => {
    const gaining = buildModel({
      allDaily: [
        day('2026-06-01', 78),
        day('2026-07-01', 80),
        day('2026-07-02', 80.5),
        day('2026-07-03', 81),
        day('2026-07-04', 81.5),
        // Yesterday is missing, so today stands alone as a one-day streak.
        day('2026-07-13', 83),
      ],
      target: 75,
    });
    const body = allText((await render('aiInsights', gaining)).toJSON());

    expect(body).toContain('Your average rose 3.2 kg against the previous window.');
    expect(body).toMatch(/you are gaining about/i);
    expect(body).toContain('1 day running');
    expect(body).not.toContain('1 days running');
  });

  it('HEALTH-WEIGHT-249: an unchanged average says it held steady rather than "+0 kg"', async () => {
    const flat = buildModel({
      allDaily: [day('2026-06-01', 80), day('2026-07-13', 80)],
      target: 75,
    });
    const body = allText((await render('aiInsights', flat)).toJSON());

    expect(body).toContain('held steady against the previous window');
    expect(body).not.toMatch(/rose|fell/);
  });

  it('HEALTH-WEIGHT-268: a record with gaps prints — rather than a broken figure', async () => {
    // History and streak are handed over as whole records; a field that never
    // arrived must not surface as "null kg" or "Invalid Date" beside real ones.
    const history = await render(
      'weightHistory',
      buildModel({
        history: { starting: null, current: day(TODAY, 80), lowest: null, highest: null },
      })
    );
    expect(text(history, 'health-weight-history-current')).toContain('80 kg');
    expect(text(history, 'health-weight-history-starting')).toBe('Starting—');
    expect(text(history, 'health-weight-history-highest')).toBe('Highest—');
    expect(allText(history.toJSON())).not.toMatch(/Invalid|NaN|null/);

    const streak = await render(
      'streaks',
      buildModel({ streak: { current: 0, best: 3, lastLogged: null } })
    );
    expect(text(streak, 'health-weight-streak-best')).toContain('3 d');
    expect(text(streak, 'health-weight-streak-last')).toBe('Last—');
  });
});

describe('strengthLabel', () => {
  it('HEALTH-WEIGHT-280: turns a coefficient into words, with its direction', () => {
    expect(strengthLabel(0.05)).toBe('Barely');
    expect(strengthLabel(0.3)).toMatch(/same way/);
    expect(strengthLabel(-0.5)).toMatch(/opposite ways/);
    expect(strengthLabel(-0.9)).toMatch(/^Strongly/);
  });
});
