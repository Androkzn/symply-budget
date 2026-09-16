/**
 * `HealthCycleCalendar.tsx` — the pure copy helpers, exercised directly.
 *
 * The component itself renders through `HealthCycleScreen` in
 * `areas/cycle.screen.test.tsx` (every legitimate month/day the UI can reach
 * is a well-formed `YYYY-MM` / `YYYY-MM-DD` string). Two branches only show up
 * off an input the UI can never actually produce — a malformed month key, and
 * a period day logged with no flow level — so they are pinned here as direct
 * unit tests of the exported pure functions instead.
 */

import type { CycleCalendarDay } from '../../healthCycleStorage';
import { dayDescription, monthTitle, summarySentence } from '../HealthCycleCalendar';

function day(over: Partial<CycleCalendarDay> = {}): CycleCalendarDay {
  return {
    date: '2026-07-08',
    day: 8,
    inMonth: true,
    mark: null,
    flow: null,
    hasSymptomLog: false,
    ...over,
  };
}

describe('monthTitle', () => {
  it('HEALTH-CYCAL-001: a normal YYYY-MM key renders "Month YYYY"', () => {
    expect(monthTitle('2026-07')).toBe('July 2026');
    expect(monthTitle('2026-01')).toBe('January 2026');
    expect(monthTitle('2026-12')).toBe('December 2026');
  });

  it('HEALTH-CYCAL-002: a month with no index (missing "-NN") falls back to index 1', () => {
    expect(monthTitle('2026')).toBe('January 2026');
  });

  it('HEALTH-CYCAL-003: an out-of-range month index falls back to the raw key rather than "undefined"', () => {
    expect(monthTitle('2026-13')).toBe('2026-13 2026');
    expect(monthTitle('2026-13')).not.toContain('undefined');
  });
});

describe('summarySentence', () => {
  it('HEALTH-CYCAL-010: names logged period days and estimated days separately', () => {
    const text = summarySentence(
      { period: 3, predictedPeriod: 1, fertile: 5, ovulation: 1 },
      'July 2026'
    );
    expect(text).toContain('3 period days logged');
    expect(text).toContain('7 estimated days'); // 1 + 5 + 1
    expect(text).toContain('not a fertility test');
  });

  it('HEALTH-CYCAL-011: singular "1 period day" and "1 estimated day"', () => {
    const text = summarySentence({ period: 1, predictedPeriod: 0, fertile: 1, ovulation: 0 }, 'July 2026');
    expect(text).toContain('1 period day logged');
    expect(text).toContain('1 estimated day');
    expect(text).not.toContain('1 period days');
  });

  it('HEALTH-CYCAL-012: an entirely empty month says so honestly, not a bare grid', () => {
    const text = summarySentence({ period: 0, predictedPeriod: 0, fertile: 0, ovulation: 0 }, 'July 2026');
    expect(text).toBe(
      'Nothing logged in July 2026, and no estimates yet — log a period day to start the calendar.'
    );
  });
});

describe('dayDescription', () => {
  it('HEALTH-CYCAL-020: a padding day (outside the month) is described as such and nothing else', () => {
    expect(dayDescription(day({ inMonth: false, day: 30 }), false, false)).toBe('30, outside this month');
  });

  it('HEALTH-CYCAL-021: a period day WITH a flow level names the flow, lowercased', () => {
    expect(dayDescription(day({ mark: 'period', flow: 'heavy' }), false, false)).toBe(
      '8, period logged, heavy flow'
    );
  });

  it('HEALTH-CYCAL-022: a period day with NO flow (flow: null) still reads as logged, without a flow clause', () => {
    // This is the state a period entry with no chosen flow level leaves a cell
    // in — `cell.flow` falsy but `cell.mark === 'period'`. The label must not
    // print "period logged, undefined flow" or silently drop the day.
    expect(dayDescription(day({ mark: 'period', flow: null }), false, false)).toBe('8, period logged');
  });

  it('HEALTH-CYCAL-023: a non-period mark (fertile/ovulation/predicted) uses its own label, not the flow branch', () => {
    expect(dayDescription(day({ mark: 'fertile' }), false, false)).toBe('8, fertile window estimate');
    expect(dayDescription(day({ mark: 'ovulation' }), false, false)).toBe('8, ovulation estimate');
    expect(dayDescription(day({ mark: 'predictedPeriod' }), false, false)).toBe('8, period expected');
  });

  it('HEALTH-CYCAL-024: today + a symptom log + selected all append, in order', () => {
    expect(dayDescription(day({ hasSymptomLog: true }), true, true)).toBe(
      '8, today, symptoms logged, selected'
    );
  });
});
