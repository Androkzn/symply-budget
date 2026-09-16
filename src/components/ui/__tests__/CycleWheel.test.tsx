/**
 * CycleWheel — the pure wheel maths (phase rule, arc geometry, logged-day
 * mapping, spoken description) plus a real render through <ThemeProvider>.
 *
 * The headline test is the CROSS-CHECK: `cycleWheelPhaseForDay` and the arcs it
 * produces are compared against the health store's `phaseForCycleDay` for every
 * day of every valid (cycleLength, periodLength) pair. A wheel that disagrees
 * with the phase label printed beneath it is worse than no wheel, so the two
 * implementations are pinned together rather than merely "written the same".
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import { phaseForCycleDay, type CycleSettings } from '@features/health/healthCycleStorage';

import {
  clampWheelCycleLength,
  clampWheelPeriodLength,
  CycleWheel,
  cycleDayPoint,
  cycleWheelDescription,
  cycleWheelGeometry,
  cycleWheelPhaseColors,
  cycleWheelPhaseForDay,
  loggedCycleDays,
  normaliseCycleDay,
  CYCLE_WHEEL_LIMITS,
  CYCLE_WHEEL_PHASES,
  type CycleWheelGeometry,
} from '../CycleWheel';
import { Typography } from '../Typography';

jest.mock('@api/health');

const { minCycleLength, maxCycleLength, minPeriodLength, maxPeriodLength } = CYCLE_WHEEL_LIMITS;

function settingsFor(cycleLength: number, periodLength: number): CycleSettings {
  return { cycleLength, periodLength, lastPeriodStart: null };
}

/** Every day covered by the arcs, in draw order. */
function coveredDays(geometry: CycleWheelGeometry): number[] {
  const days: number[] = [];
  for (const arc of geometry.arcs) {
    for (let day = arc.startDay; day <= arc.endDay; day += 1) days.push(day);
  }
  return days;
}

function render(el: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{el}</ThemeProvider>);
  });
  return tree;
}

function findAllByTestID(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props?.testID === testID, { deep: true });
}

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

describe('cycleWheelPhaseForDay — cross-checked against the health store', () => {
  it('agrees with phaseForCycleDay on every day of every valid configuration', () => {
    const mismatches: string[] = [];
    for (let length = minCycleLength; length <= maxCycleLength; length += 1) {
      for (let period = minPeriodLength; period <= maxPeriodLength; period += 1) {
        const settings = settingsFor(length, period);
        for (let day = 1; day <= length; day += 1) {
          const wheel = cycleWheelPhaseForDay(day, length, period);
          const store = phaseForCycleDay(day, settings);
          if (wheel !== store) {
            mismatches.push(`L=${length} P=${period} day=${day}: wheel=${wheel} store=${store}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees with phaseForCycleDay after clamping out-of-range inputs', () => {
    const cases: Array<[number, number]> = [
      [10, 5], // cycle below the floor
      [200, 5], // cycle above the ceiling
      [28, 0], // period below the floor
      [28, 99], // period above the ceiling
      [Number.NaN, Number.NaN],
    ];
    for (const [length, period] of cases) {
      const drawn = clampWheelCycleLength(length);
      for (let day = 1; day <= drawn; day += 1) {
        expect(cycleWheelPhaseForDay(day, length, period)).toBe(
          phaseForCycleDay(day, settingsFor(length, period))
        );
      }
    }
  });

  it('renders arcs whose phase matches the store for every day of every configuration', () => {
    const mismatches: string[] = [];
    for (let length = minCycleLength; length <= maxCycleLength; length += 1) {
      for (let period = minPeriodLength; period <= maxPeriodLength; period += 1) {
        const geometry = cycleWheelGeometry(length, period);
        const settings = settingsFor(length, period);
        for (const arc of geometry.arcs) {
          for (let day = arc.startDay; day <= arc.endDay; day += 1) {
            if (arc.phase !== phaseForCycleDay(day, settings)) {
              mismatches.push(`L=${length} P=${period} day=${day} drawn as ${arc.phase}`);
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('clampWheelCycleLength / clampWheelPeriodLength', () => {
  it('clamps the cycle length to the storage bounds', () => {
    expect(clampWheelCycleLength(10)).toBe(minCycleLength);
    expect(clampWheelCycleLength(200)).toBe(maxCycleLength);
    expect(clampWheelCycleLength(27.6)).toBe(28);
    expect(clampWheelCycleLength(minCycleLength)).toBe(minCycleLength);
    expect(clampWheelCycleLength(maxCycleLength)).toBe(maxCycleLength);
  });

  it('falls back to the defaults for non-finite input', () => {
    expect(clampWheelCycleLength(Number.NaN)).toBe(CYCLE_WHEEL_LIMITS.defaultCycleLength);
    expect(clampWheelCycleLength(Infinity)).toBe(CYCLE_WHEEL_LIMITS.defaultCycleLength);
    expect(clampWheelPeriodLength(Number.NaN)).toBe(CYCLE_WHEEL_LIMITS.defaultPeriodLength);
  });

  it('clamps the period length to the storage bounds', () => {
    expect(clampWheelPeriodLength(0)).toBe(minPeriodLength);
    expect(clampWheelPeriodLength(99)).toBe(maxPeriodLength);
    expect(clampWheelPeriodLength(4.5)).toBe(5);
  });
});

describe('cycleWheelGeometry', () => {
  it('splits a textbook 28-day cycle into the four donor phases', () => {
    const g = cycleWheelGeometry(28, 5);
    expect(g.cycleLength).toBe(28);
    expect(g.periodLength).toBe(5);
    expect(g.arcs.map((a) => a.phase)).toEqual([
      'menstrual',
      'follicular',
      'ovulation',
      'luteal',
    ]);
    expect(g.byPhase.menstrual).toMatchObject({ startDay: 1, endDay: 5, days: 5 });
    expect(g.byPhase.follicular).toMatchObject({ startDay: 6, endDay: 12, days: 7 });
    // 3-day window centred on 28 − 14 = 14.
    expect(g.byPhase.ovulation).toMatchObject({ startDay: 13, endDay: 15, days: 3 });
    expect(g.byPhase.luteal).toMatchObject({ startDay: 16, endDay: 28, days: 13 });
  });

  it('covers every cycle day exactly once, in order', () => {
    const g = cycleWheelGeometry(28, 5);
    expect(coveredDays(g)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it('never lists a phase twice, at any configuration', () => {
    for (let length = minCycleLength; length <= maxCycleLength; length += 1) {
      for (let period = minPeriodLength; period <= maxPeriodLength; period += 1) {
        const phases = cycleWheelGeometry(length, period).arcs.map((a) => a.phase);
        expect(new Set(phases).size).toBe(phases.length);
      }
    }
  });

  it('computes the ring box from size and stroke', () => {
    const g = cycleWheelGeometry(28, 5, 200, 18);
    expect(g.radius).toBe(91); // (200 − 18) / 2
    expect(g.center).toBe(100);
    expect(g.degreesPerDay).toBeCloseTo(360 / 28, 3);
  });

  it('insets every arc by half the 2pt surface gap on each end', () => {
    const g = cycleWheelGeometry(28, 5, 200, 18);
    const gapDeg = (2 / g.radius) * (180 / Math.PI);
    for (const arc of g.arcs) {
      const rawStart = (arc.startDay - 1) * (360 / 28);
      expect(arc.startAngle - rawStart).toBeCloseTo(gapDeg / 2, 3);
      expect(arc.sweepAngle).toBeCloseTo(arc.days * (360 / 28) - gapDeg, 3);
    }
  });

  it('closes the ring — the last arc ends where the first one started', () => {
    const g = cycleWheelGeometry(28, 5, 200, 18);
    const gapDeg = (2 / g.radius) * (180 / Math.PI);
    const last = g.arcs[g.arcs.length - 1];
    // Angles are reported rounded to 3dp, so summing two of them can drift by
    // up to 1e-3 — compare at 2dp rather than chasing the reporting precision.
    expect(last.startAngle + last.sweepAngle + gapDeg / 2).toBeCloseTo(360, 2);
  });

  it('emits a single SVG arc command per phase, starting at the top of the ring', () => {
    const g = cycleWheelGeometry(28, 5, 200, 18);
    const menstrual = g.byPhase.menstrual!;
    expect(menstrual.path).toMatch(/^M [\d.]+ [\d.]+ A 91 91 0 0 1 [\d.]+ [\d.]+$/);
    // Day 1 starts just clockwise of the top of the circle.
    const [, x, y] = menstrual.path.match(/^M ([\d.]+) ([\d.]+)/)!;
    expect(Number(x)).toBeGreaterThan(g.center);
    expect(Number(y)).toBeLessThan(g.center - g.radius + 1);
  });

  it('sets the large-arc flag once a phase passes a half turn', () => {
    // 45-day cycle with a 1-day period: follicular runs days 2–29 (224°).
    const g = cycleWheelGeometry(45, 1, 200, 18);
    const follicular = g.byPhase.follicular!;
    expect(follicular).toMatchObject({ startDay: 2, endDay: 29, days: 28 });
    expect(follicular.sweepAngle).toBeGreaterThan(180);
    expect(follicular.path).toContain('A 91 91 0 1 1');
    expect(g.byPhase.luteal!.path).toContain('A 91 91 0 0 1');
  });

  describe('bounds and degenerate configurations', () => {
    it('handles the shortest cycle (20 days)', () => {
      // Ovulation day is 20 − 14 = 6, so the window is days 5–7 — but day 5 is
      // still bleeding, so the period wins it and the follicular phase vanishes.
      const g = cycleWheelGeometry(20, 5);
      expect(g.byPhase.menstrual).toMatchObject({ startDay: 1, endDay: 5 });
      expect(g.byPhase.follicular).toBeNull();
      expect(g.byPhase.ovulation).toMatchObject({ startDay: 6, endDay: 7 });
      expect(g.byPhase.luteal).toMatchObject({ startDay: 8, endDay: 20 });
      expect(coveredDays(g)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('handles the longest cycle (45 days)', () => {
      const g = cycleWheelGeometry(45, 5);
      expect(g.byPhase.follicular).toMatchObject({ startDay: 6, endDay: 29 });
      expect(g.byPhase.ovulation).toMatchObject({ startDay: 30, endDay: 32 });
      expect(g.byPhase.luteal).toMatchObject({ startDay: 33, endDay: 45 });
      expect(coveredDays(g)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    });

    it('lets a long period clip the ovulation window rather than overlap it', () => {
      // 24-day cycle → ovulation day 10, window 9–11; a 9-day period owns day 9.
      const g = cycleWheelGeometry(24, 9);
      expect(g.byPhase.menstrual).toMatchObject({ startDay: 1, endDay: 9 });
      expect(g.byPhase.follicular).toBeNull();
      expect(g.byPhase.ovulation).toMatchObject({ startDay: 10, endDay: 11, days: 2 });
      expect(g.byPhase.luteal).toMatchObject({ startDay: 12, endDay: 24 });
    });

    it('drops the ovulation window entirely when the period swallows it', () => {
      // 20-day cycle, 14-day period: every ovulation day is a bleeding day.
      const g = cycleWheelGeometry(20, 14);
      expect(g.arcs.map((a) => a.phase)).toEqual(['menstrual', 'luteal']);
      expect(g.byPhase.ovulation).toBeNull();
      expect(g.byPhase.follicular).toBeNull();
      expect(coveredDays(g)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('never has both a clipped ovulation window and a follicular phase', () => {
      for (let length = minCycleLength; length <= maxCycleLength; length += 1) {
        for (let period = minPeriodLength; period <= maxPeriodLength; period += 1) {
          const g = cycleWheelGeometry(length, period);
          const clipped = g.byPhase.ovulation !== null && g.byPhase.ovulation.days < 3;
          if (clipped) expect(g.byPhase.follicular).toBeNull();
        }
      }
    });

    it('degrades to a zero radius when the stroke swamps the box', () => {
      const g = cycleWheelGeometry(28, 5, 10, 40);
      expect(g.radius).toBe(0);
      expect(g.arcs.every((a) => a.path === '')).toBe(true);
      // The day spans are still correct — only the drawing collapses.
      expect(coveredDays(g)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    });
  });
});

describe('normaliseCycleDay', () => {
  it('accepts days inside the cycle and rounds fractions', () => {
    expect(normaliseCycleDay(1, 28)).toBe(1);
    expect(normaliseCycleDay(28, 28)).toBe(28);
    expect(normaliseCycleDay(14.4, 28)).toBe(14);
  });

  it('rejects a missing, non-finite or out-of-range day rather than clamping it', () => {
    expect(normaliseCycleDay(null, 28)).toBeNull();
    expect(normaliseCycleDay(undefined, 28)).toBeNull();
    expect(normaliseCycleDay(Number.NaN, 28)).toBeNull();
    expect(normaliseCycleDay(0, 28)).toBeNull();
    expect(normaliseCycleDay(29, 28)).toBeNull();
    expect(normaliseCycleDay(-3, 28)).toBeNull();
  });
});

describe('cycleDayPoint', () => {
  it('places a day at its mid-angle on the ring', () => {
    const g = cycleWheelGeometry(28, 5, 200, 18);
    const day1 = cycleDayPoint(1, g)!;
    expect(day1.angle).toBeCloseTo(0.5 * (360 / 28), 3);
    // Just clockwise of 12 o'clock: right of centre, near the top.
    expect(day1.x).toBeGreaterThan(g.center);
    expect(day1.y).toBeLessThan(g.center);
    const half = cycleDayPoint(15, g)!;
    expect(half.angle).toBeGreaterThan(180);
  });

  it('returns null for a day the wheel cannot place', () => {
    const g = cycleWheelGeometry(28, 5);
    expect(cycleDayPoint(null, g)).toBeNull();
    expect(cycleDayPoint(0, g)).toBeNull();
    expect(cycleDayPoint(29, g)).toBeNull();
  });

  it('collapses onto the centre when the radius is zero', () => {
    const g = cycleWheelGeometry(28, 5, 10, 40);
    expect(cycleDayPoint(3, g)).toMatchObject({ x: 5, y: 5 });
  });
});

describe('loggedCycleDays', () => {
  const today = '2026-07-25';

  it('maps today onto the current cycle day', () => {
    expect(loggedCycleDays([today], 14, today, 28)).toEqual([14]);
  });

  it('walks backwards a day at a time', () => {
    expect(loggedCycleDays(['2026-07-23', '2026-07-24'], 14, today, 28)).toEqual([12, 13]);
  });

  it('wraps a date from the previous cycle onto the same position', () => {
    // Exactly one 28-day cycle earlier.
    expect(loggedCycleDays(['2026-06-27'], 14, today, 28)).toEqual([14]);
    // 20 days back from day 14 lands on day 22 of the previous cycle.
    expect(loggedCycleDays(['2026-07-05'], 14, today, 28)).toEqual([22]);
  });

  it('wraps forward past the end of the cycle', () => {
    expect(loggedCycleDays(['2026-08-10'], 14, today, 28)).toEqual([2]);
  });

  it('de-duplicates and sorts', () => {
    expect(loggedCycleDays([today, today, '2026-07-24'], 14, today, 28)).toEqual([13, 14]);
  });

  it('returns nothing without an anchor day', () => {
    expect(loggedCycleDays([today], null, today, 28)).toEqual([]);
    expect(loggedCycleDays([today], 99, today, 28)).toEqual([]);
  });

  it('returns nothing for empty or missing input', () => {
    expect(loggedCycleDays([], 14, today, 28)).toEqual([]);
    expect(loggedCycleDays(undefined, 14, today, 28)).toEqual([]);
  });

  it('skips malformed keys instead of drawing them at day 1', () => {
    expect(loggedCycleDays(['not-a-date', '2026-13-01', '2026-02-30', ''], 14, today, 28)).toEqual(
      []
    );
    expect(loggedCycleDays(['nope', today], 14, today, 28)).toEqual([14]);
  });

  it('returns nothing when the anchor date itself is unusable', () => {
    expect(loggedCycleDays([today], 14, 'yesterday', 28)).toEqual([]);
  });

  it('uses the clamped cycle length when wrapping', () => {
    // cycleLength 10 clamps to 20, so 20 days back is a full turn.
    expect(loggedCycleDays(['2026-07-05'], 14, today, 10)).toEqual([14]);
  });
});

describe('cycleWheelDescription', () => {
  it('states the current day, its phase and every phase span', () => {
    const label = cycleWheelDescription(cycleWheelGeometry(28, 5), 14);
    expect(label).toContain('28-day cycle.');
    expect(label).toContain('Day 14 of 28, ovulation.');
    expect(label).toContain('Period days 1 to 5.');
    expect(label).toContain('Follicular days 6 to 12.');
    expect(label).toContain('Ovulation days 13 to 15.');
    expect(label).toContain('Luteal days 16 to 28.');
  });

  it('says so when there is no current day', () => {
    const label = cycleWheelDescription(cycleWheelGeometry(28, 5), null);
    expect(label).toContain('Current cycle day unknown.');
    expect(label).not.toContain('Day 14');
  });

  it('reads a single-day phase in the singular', () => {
    const label = cycleWheelDescription(cycleWheelGeometry(45, 1), 1);
    expect(label).toContain('Period day 1.');
    expect(label).not.toContain('days 1 to 1');
  });

  it('omits phases this configuration does not have', () => {
    const label = cycleWheelDescription(cycleWheelGeometry(20, 14), 3);
    expect(label).toContain('Period days 1 to 14.');
    expect(label).toContain('Luteal days 15 to 20.');
    expect(label).not.toContain('Ovulation');
    expect(label).not.toContain('Follicular');
  });
});

describe('cycleWheelPhaseColors', () => {
  it('returns one distinct step per phase, strongest at the period', () => {
    const ramp = cycleWheelPhaseColors('#4ECDC4', '#000000', '#F7FAFA', false);
    const steps = CYCLE_WHEEL_PHASES.map((p) => ramp[p]);
    expect(new Set(steps).size).toBe(4);
    expect(steps.every((s) => /^#[0-9a-f]{6}$/i.test(s))).toBe(true);
    // Monotone lightness: each later phase is lighter than the one before.
    const luminance = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(luminance(ramp.menstrual)).toBeLessThan(luminance(ramp.follicular));
    expect(luminance(ramp.follicular)).toBeLessThan(luminance(ramp.ovulation));
    expect(luminance(ramp.ovulation)).toBeLessThan(luminance(ramp.luteal));
  });

  it('selects its own dark-mode steps rather than flipping the light ones', () => {
    const light = cycleWheelPhaseColors('#4ECDC4', '#000000', '#F7FAFA', false);
    const dark = cycleWheelPhaseColors('#4ECDC4', '#FFFFFF', '#202632', true);
    expect(dark.menstrual).not.toBe(light.menstrual);
    // Dark mode keeps the base hue at full strength for the leading phase.
    expect(dark.menstrual.toLowerCase()).toBe('#4ecdc4');
  });
});

describe('CycleWheel render', () => {
  it('draws one arc per phase and marks the current day', () => {
    const tree = render(
      <CycleWheel cycleLength={28} periodLength={5} currentDay={14} testID="wheel" />
    );
    expect(findAllByTestID(tree, 'wheel').length).toBeGreaterThan(0);
    for (const phase of CYCLE_WHEEL_PHASES) {
      expect(findAllByTestID(tree, `wheel-arc-${phase}`).length).toBeGreaterThan(0);
    }
    expect(findAllByTestID(tree, 'wheel-marker').length).toBeGreaterThan(0);
    expect(collectText(tree.toJSON()).join('')).toContain('Day 14');
  });

  it('carries an accessibility label that states the data in words', () => {
    const tree = render(
      <CycleWheel cycleLength={28} periodLength={5} currentDay={14} testID="wheel" />
    );
    const labelled = tree.root.findAll(
      (node) => typeof node.props?.accessibilityLabel === 'string'
    );
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled[0].props.accessibilityLabel).toBe(
      cycleWheelDescription(cycleWheelGeometry(28, 5, 200, 18), 14)
    );
  });

  it('omits the marker and the day label when there is no current day', () => {
    const tree = render(
      <CycleWheel cycleLength={28} periodLength={5} currentDay={null} testID="wheel" />
    );
    expect(findAllByTestID(tree, 'wheel-marker')).toHaveLength(0);
    expect(collectText(tree.toJSON()).join('')).not.toContain('Day');
    expect(findAllByTestID(tree, 'wheel-arc-menstrual').length).toBeGreaterThan(0);
  });

  it('skips arcs a configuration does not produce', () => {
    const tree = render(
      <CycleWheel cycleLength={20} periodLength={14} currentDay={3} testID="wheel" />
    );
    expect(findAllByTestID(tree, 'wheel-arc-menstrual').length).toBeGreaterThan(0);
    expect(findAllByTestID(tree, 'wheel-arc-luteal').length).toBeGreaterThan(0);
    expect(findAllByTestID(tree, 'wheel-arc-ovulation')).toHaveLength(0);
    expect(findAllByTestID(tree, 'wheel-arc-follicular')).toHaveLength(0);
  });

  it('ticks logged days once anchored, and skips them without an anchor', () => {
    const withAnchor = render(
      <CycleWheel
        cycleLength={28}
        periodLength={5}
        currentDay={14}
        today="2026-07-25"
        loggedDays={['2026-07-25', '2026-07-24']}
        testID="wheel"
      />
    );
    expect(findAllByTestID(withAnchor, 'wheel-tick-14').length).toBeGreaterThan(0);
    expect(findAllByTestID(withAnchor, 'wheel-tick-13').length).toBeGreaterThan(0);

    const noAnchor = render(
      <CycleWheel
        cycleLength={28}
        periodLength={5}
        currentDay={null}
        today="2026-07-25"
        loggedDays={['2026-07-25']}
        testID="wheel"
      />
    );
    expect(findAllByTestID(noAnchor, 'wheel-tick-14')).toHaveLength(0);
  });

  it('renders custom center content instead of the day label', () => {
    const tree = render(
      <CycleWheel cycleLength={28} periodLength={5} currentDay={14} color="#123456">
        <Typography>Ovulation</Typography>
      </CycleWheel>
    );
    const text = collectText(tree.toJSON()).join('');
    expect(text).toContain('Ovulation');
    expect(text).not.toContain('Day 14');
  });
});
