/**
 * Body tab — the ratio, composition and left/right cards (0131).
 *
 * These three shipped with the comprehensive-sites rebuild and had no component
 * test of their own. They matter more than their size suggests, because they
 * are the only place on the tab where a number is DERIVED from other numbers:
 *
 *   · the donor grades three of its four ratios in traffic-light colours. That
 *     is a clinical judgement and it is deliberately NOT ported — so what must
 *     be asserted is that the card states the figure, its date and its
 *     direction, and nothing else;
 *   · a ratio belongs to the day BOTH its sites were taped, which is routinely
 *     not the newest day in the log. The date beside it is what makes that
 *     honest, so it is asserted next to the figure;
 *   · left minus right is a difference, never a score, and two sides logged in
 *     different units have no difference at all;
 *   · every composition figure is null until its own inputs are real, and the
 *     card names what is still needed in words a person can read.
 *
 * The arithmetic itself is pinned in `areas/body.storage.test.ts`; what is
 * pinned here is what reaches the glass.
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthBodyDashboard } from '../../components/HealthBodyDashboard';
import { compareBodyEntriesDesc, type BodyEntry } from '../../healthBodyStorage';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const TODAY = '2026-07-13';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

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

function log(...items: BodyEntry[]): BodyEntry[] {
  return [...items].sort(compareBodyEntriesDesc);
}

/** No weight, no biometrics — the state a fresh account is in. */
const NO_PROFILE = {
  weightKg: null,
  heightCm: null,
  gender: null,
  birthYear: null,
  activityLevel: null,
} as const;

const FULL_PROFILE = {
  weightKg: 80,
  heightCm: 180,
  gender: 'male',
  birthYear: 1990,
  activityLevel: 'moderatelyActive',
} as const;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 13, 12, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Ratios                                                              */
/* ------------------------------------------------------------------ */

describe('HealthBodyDashboard — ratios', () => {
  it('HEALTH-BODY-260: an untaped account is told exactly what a ratio needs', () => {
    const tree = render(<HealthBodyDashboard entries={[]} {...NO_PROFILE} />);

    expect(allText(byTestId(tree, 'health-body-dashboard-ratios-empty')[0])).toContain(
      'both of its sites measured on the same day',
    );
    // Every ratio is listed as outstanding, each naming its own missing input.
    const missing = allText(byTestId(tree, 'health-body-dashboard-ratios-missing')[0]);
    expect(missing).toContain('Waist to hip needs waist and hips');
    expect(missing).toContain('Waist to height needs waist and height');
  });

  it('HEALTH-BODY-261: states the figure, the DAY it belongs to and which way it moved', () => {
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'w2', metric: 'waist', date: TODAY, value: 78 }),
          entry({ id: 'h2', metric: 'hips', date: TODAY, value: 99 }),
          entry({ id: 'w1', metric: 'waist', date: '2026-05-01', value: 80 }),
          entry({ id: 'h1', metric: 'hips', date: '2026-05-01', value: 100 }),
        )}
        {...NO_PROFILE}
      />,
    );

    const row = byTestId(tree, 'health-body-dashboard-ratio-waistToHip')[0];
    // The whole claim in one sentence: number, date, change, comparison date.
    // No band, no colour word, no verdict.
    expect(row.props.accessibilityLabel).toBe(
      'Waist to hip: 0.79 on 2026-07-13, −0.01 against 2026-05-01',
    );
    expect(allText(row)).toContain('0.79');
    expect(allText(row)).toContain('13 Jul');
    // The donor's own grading vocabulary must not have come across with it.
    expect(allText(tree.toJSON())).not.toMatch(/healthy range|above average|at risk/i);
  });

  it('HEALTH-BODY-262: a first ratio has no earlier day, and says so rather than showing zero', () => {
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'w', metric: 'waist', date: TODAY, value: 78 }),
          entry({ id: 'h', metric: 'hips', date: TODAY, value: 99 }),
        )}
        {...NO_PROFILE}
      />,
    );

    expect(
      byTestId(tree, 'health-body-dashboard-ratio-waistToHip')[0].props.accessibilityLabel,
    ).toBe('Waist to hip: 0.79 on 2026-07-13, no earlier day to compare with');
  });

  it('HEALTH-BODY-263: a ratio that did not move is not given an arrow', () => {
    // An arrow reports a direction. There is no direction to report.
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'w2', metric: 'waist', date: TODAY, value: 80 }),
          entry({ id: 'h2', metric: 'hips', date: TODAY, value: 100 }),
          entry({ id: 'w1', metric: 'waist', date: '2026-05-01', value: 80 }),
          entry({ id: 'h1', metric: 'hips', date: '2026-05-01', value: 100 }),
        )}
        {...NO_PROFILE}
      />,
    );

    const row = tree.root.find(
      (n) => n.props?.testID === 'health-body-dashboard-ratio-waistToHip',
    );
    expect(row.props.accessibilityLabel).toContain('−0.00 against 2026-05-01');
    expect(row.findAll((n) => n.props?.name === 'arrow-up')).toHaveLength(0);
    expect(row.findAll((n) => n.props?.name === 'arrow-down')).toHaveLength(0);
  });

  it('HEALTH-BODY-264: a ratio that GREW points its arrow the other way', () => {
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'w2', metric: 'waist', date: TODAY, value: 82 }),
          entry({ id: 'h2', metric: 'hips', date: TODAY, value: 100 }),
          entry({ id: 'w1', metric: 'waist', date: '2026-05-01', value: 78 }),
          entry({ id: 'h1', metric: 'hips', date: '2026-05-01', value: 100 }),
        )}
        {...NO_PROFILE}
      />,
    );

    const row = tree.root.find(
      (n) => n.props?.testID === 'health-body-dashboard-ratio-waistToHip',
    );
    expect(row.props.accessibilityLabel).toContain('+0.04 against 2026-05-01');
    expect(row.findAll((n) => n.props?.name === 'arrow-up').length).toBeGreaterThan(0);
    expect(row.findAll((n) => n.props?.name === 'arrow-down')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

describe('HealthBodyDashboard — body composition', () => {
  it('HEALTH-BODY-270: every tile is a dash until its inputs exist, and the gap is named', () => {
    const tree = render(<HealthBodyDashboard entries={[]} {...NO_PROFILE} />);

    for (const tile of ['bmi', 'bmr', 'lean-mass', 'fat-mass', 'body-fat', 'tdee']) {
      expect(allText(byTestId(tree, `health-body-dashboard-${tile}`)[0])).toContain('—');
    }
    // A readable list, not six bullet points or a JSON array.
    const missing = allText(byTestId(tree, 'health-body-dashboard-composition-missing')[0]);
    expect(missing).toContain(
      'A weight reading, Height, Sex, Birth year, Activity level and A body-fat reading are still needed',
    );
    // …and it says WHERE each one lives, because none of them is collected here.
    expect(missing).toContain('live on your weight goal');
  });

  it('HEALTH-BODY-271: a complete profile fills every tile', () => {
    const tree = render(
      <HealthBodyDashboard
        entries={log(entry({ id: 'f', metric: 'bodyFat', value: 18, unit: '%' }))}
        {...FULL_PROFILE}
      />,
    );

    expect(allText(byTestId(tree, 'health-body-dashboard-bmi')[0])).toContain('24.7');
    expect(allText(byTestId(tree, 'health-body-dashboard-bmr')[0])).toContain('1750 kcal');
    expect(allText(byTestId(tree, 'health-body-dashboard-tdee')[0])).toContain('2713 kcal');
    expect(allText(byTestId(tree, 'health-body-dashboard-fat-mass')[0])).toContain('14.4 kg');
    expect(allText(byTestId(tree, 'health-body-dashboard-lean-mass')[0])).toContain('65.6 kg');
    expect(byTestId(tree, 'health-body-dashboard-composition-missing')).toHaveLength(0);
    // The activity level is named in the explanation, so "daily burn" is not a
    // number out of nowhere.
    expect(allText(tree.toJSON())).toContain('moderately active');
  });

  it('HEALTH-BODY-272: fat and lean mass come from the LATEST body-fat reading', () => {
    // The card says the figure is one the member measured, not one a scale
    // produced — so it has to be the most recent one they measured.
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'new', metric: 'bodyFat', date: TODAY, value: 18, unit: '%' }),
          entry({ id: 'old', metric: 'bodyFat', date: '2026-05-01', value: 25, unit: '%' }),
        )}
        {...FULL_PROFILE}
      />,
    );

    expect(allText(byTestId(tree, 'health-body-dashboard-body-fat')[0])).toContain('18 %');
    expect(allText(byTestId(tree, 'health-body-dashboard-fat-mass')[0])).toContain('14.4 kg');
    expect(allText(tree.toJSON())).toContain('not from a scale');
  });

  it('HEALTH-BODY-273: one missing input reads as a singular sentence', () => {
    const tree = render(
      <HealthBodyDashboard entries={[]} {...FULL_PROFILE} />,
    );

    expect(allText(byTestId(tree, 'health-body-dashboard-composition-missing')[0])).toContain(
      'A body-fat reading is still needed',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Left and right                                                      */
/* ------------------------------------------------------------------ */

describe('HealthBodyDashboard — left and right', () => {
  it('HEALTH-BODY-280: the card is absent until a PAIR has both sides', () => {
    // A card headed "Left and right" with nothing in it invites the reading
    // that the sides are equal.
    const oneSide = render(
      <HealthBodyDashboard
        entries={log(entry({ id: 'la', metric: 'leftArm', value: 34 }))}
        {...NO_PROFILE}
      />,
    );
    expect(allText(oneSide.toJSON())).not.toContain('LEFT AND RIGHT');

    const bothSides = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'la', metric: 'leftArm', value: 34 }),
          entry({ id: 'ra', metric: 'rightArm', value: 33.5 }),
        )}
        {...NO_PROFILE}
      />,
    );
    expect(allText(bothSides.toJSON())).toContain('LEFT AND RIGHT');
  });

  it('HEALTH-BODY-281: states both sides and the signed gap, and grades neither', () => {
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'la', metric: 'leftArm', value: 34 }),
          entry({ id: 'ra', metric: 'rightArm', value: 33.5 }),
        )}
        {...NO_PROFILE}
      />,
    );

    const row = byTestId(tree, 'health-body-dashboard-side-Arm')[0];
    expect(row.props.accessibilityLabel).toBe(
      'Arm: left 34 cm, right 33.5 cm, +0.5 cm on the left',
    );
    // The donor stores `min ÷ max` as a percentage and colours it. No
    // percentage, no symmetry SCORE, no colour word.
    expect(allText(tree.toJSON())).not.toMatch(/symmetry score|%\s*symmetr/i);
    expect(allText(tree.toJSON())).toContain('rather than judge it');
  });

  it('HEALTH-BODY-282: two even sides read as "even", not as a zero', () => {
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'lt', metric: 'leftThigh', value: 56 }),
          entry({ id: 'rt', metric: 'rightThigh', value: 56 }),
        )}
        {...NO_PROFILE}
      />,
    );

    const row = byTestId(tree, 'health-body-dashboard-side-Thigh')[0];
    expect(row.props.accessibilityLabel).toBe('Thigh: left 56 cm, right 56 cm, the same');
    expect(allText(row)).toContain('even');
  });

  it('HEALTH-BODY-283: two sides in different units have no difference to show', () => {
    // 34 − 13 = 21 would be a spectacular, entirely fictional asymmetry.
    const tree = render(
      <HealthBodyDashboard
        entries={log(
          entry({ id: 'lc', metric: 'leftCalf', value: 38, unit: 'cm' }),
          entry({ id: 'rc', metric: 'rightCalf', value: 15, unit: 'in' }),
        )}
        {...NO_PROFILE}
      />,
    );

    const row = byTestId(tree, 'health-body-dashboard-side-Calf')[0];
    expect(row.props.accessibilityLabel).toBe(
      'Calf: left 38 cm, right 15 in, logged in different units so there is no difference to show',
    );
    expect(allText(row)).toContain('unit changed');
  });
});
