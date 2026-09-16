/**
 * Unit tests for the pure helpers behind the previous-years history + compare
 * screens. These drive the year pickers, the net color, the delta labels and
 * the compare-chart series colors — kept pure so they can be tested without
 * rendering the React Native screens.
 */
import type { AppColors } from '@theme';

import {
  MONTH_ABBR,
  buildYearOptions,
  formatDeltaPct,
  netColor,
  pickSeriesColors,
} from '../historyShared';

const colors = { success: '#22c55e', error: '#ef4444' } as unknown as AppColors;

describe('MONTH_ABBR', () => {
  it('has 12 three-letter month labels in order', () => {
    expect(MONTH_ABBR).toHaveLength(12);
    expect(MONTH_ABBR[0]).toBe('Jan');
    expect(MONTH_ABBR[11]).toBe('Dec');
  });
});

describe('buildYearOptions', () => {
  it('unions available years with the selected year, descending', () => {
    expect(buildYearOptions([2024, 2022], 2023)).toEqual([2024, 2023, 2022]);
  });

  it('keeps the selected year even with no data', () => {
    expect(buildYearOptions([], 2026)).toEqual([2026]);
  });

  it('dedupes when the selected year already has data', () => {
    expect(buildYearOptions([2025, 2024], 2025)).toEqual([2025, 2024]);
  });
});

describe('netColor', () => {
  it('is success for zero or positive net', () => {
    expect(netColor(0, colors)).toBe(colors.success);
    expect(netColor(1500, colors)).toBe(colors.success);
  });

  it('is error for negative net', () => {
    expect(netColor(-1, colors)).toBe(colors.error);
  });
});

describe('formatDeltaPct', () => {
  it('renders null as an em dash', () => {
    expect(formatDeltaPct(null)).toBe('—');
  });

  it('leads positive changes with a plus sign', () => {
    expect(formatDeltaPct(12)).toBe('+12%');
  });

  it('keeps the minus sign for negative changes and no sign for zero', () => {
    expect(formatDeltaPct(-8)).toBe('-8%');
    expect(formatDeltaPct(0)).toBe('0%');
  });
});

describe('pickSeriesColors', () => {
  it('cycles the palette to the requested length', () => {
    expect(pickSeriesColors(4, ['a', 'b'])).toEqual(['a', 'b', 'a', 'b']);
  });

  it('returns [] for an empty palette or non-positive count', () => {
    expect(pickSeriesColors(3, [])).toEqual([]);
    expect(pickSeriesColors(0, ['a'])).toEqual([]);
    expect(pickSeriesColors(-2, ['a'])).toEqual([]);
  });
});
