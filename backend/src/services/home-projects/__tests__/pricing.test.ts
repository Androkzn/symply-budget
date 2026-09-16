/**
 * Material option pricing — the Worker half of the shared truth table.
 *
 * The cases live in `pricing-fixtures.json`, not here, because the local-first
 * mirror in `src/features/house/local/logic/homeProjects.ts` has to produce the
 * identical numbers and the only way to prove that is to run both against ONE
 * table. See `src/features/house/local/logic/__tests__/materialPricing.test.ts`
 * for the other reader.
 */
import { describe, it, expect } from 'vitest';

import fixtures from '../pricing-fixtures.json';
import {
  budgetEstimateCents,
  fromSquareMeters,
  priceOption,
  toSquareMeters,
  type OptionPricing,
  type PricingGroupInput,
  type PricingOptionInput,
} from '../pricing';

type Fixture = {
  name: string;
  group: PricingGroupInput;
  option: PricingOptionInput;
  expected: OptionPricing;
};

const CASES = fixtures.cases as unknown as Fixture[];

describe('priceOption — shared fixture table', () => {
  it('ships a table with cases in it', () => {
    // A silently empty fixture file would make every it.each below vacuous and
    // the suite would pass green having asserted nothing at all.
    expect(CASES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    expect(priceOption(testCase.group, testCase.option)).toEqual(testCase.expected);
  });
});

describe('the rounding that makes the number buyable', () => {
  const group: PricingGroupInput = { area_value: 24, area_unit: 'm2', waste_factor_pct: 10 };
  const option: PricingOptionInput = {
    qty: 1,
    unit_price_cents: 4599,
    coverage_per_unit: 2.2,
    coverage_unit: 'm2',
  };

  it('never quotes a fractional box', () => {
    const { units_needed } = priceOption(group, option);
    expect(Number.isInteger(units_needed)).toBe(true);
  });

  it('quotes MORE than the smooth area × unit-price product, never less', () => {
    // The smooth product is the number a naive card would show. It is always an
    // under-quote once rounding is applied, and under-quoting a renovation is
    // the specific failure this feature must not have.
    const pricing = priceOption(group, option);
    const smooth = (24 * 1.1 * 4599) / 2.2;
    expect(pricing.area_total_cents!).toBeGreaterThanOrEqual(Math.floor(smooth));
  });

  it('buys at least enough to cover the area with its waste allowance', () => {
    const pricing = priceOption(group, option);
    expect(pricing.units_needed! * 2.2).toBeGreaterThanOrEqual(24 * 1.1);
  });
});

describe('unit conversion', () => {
  it('round-trips through m²', () => {
    expect(fromSquareMeters(toSquareMeters(250, 'sqft'), 'sqft')).toBeCloseTo(250, 9);
  });

  it('agrees with the international foot', () => {
    expect(toSquareMeters(1, 'sqft')).toBeCloseTo(0.09290304, 12);
  });

  it('leaves m² alone', () => {
    expect(toSquareMeters(42, 'm2')).toBe(42);
  });
});

describe('budgetEstimateCents', () => {
  it('takes the area total when the group has an area', () => {
    expect(
      budgetEstimateCents(
        { area_value: 24, area_unit: 'm2', waste_factor_pct: 10 },
        { qty: 1, unit_price_cents: 4599, coverage_per_unit: 2.2, coverage_unit: 'm2' }
      )
    ).toBe(55188);
  });

  it('falls back to qty × price for a per-piece group', () => {
    expect(
      budgetEstimateCents(
        { area_value: null, area_unit: null, waste_factor_pct: 10 },
        { qty: 2, unit_price_cents: 18900, coverage_per_unit: null, coverage_unit: null }
      )
    ).toBe(37800);
  });

  it('is zero — not NaN — for a chosen option with no price', () => {
    // A chosen-but-unpriced option belongs in the budget as a visible zero. NaN
    // would propagate through the rollup and blank the whole estimate.
    const estimate = budgetEstimateCents(
      { area_value: 24, area_unit: 'm2', waste_factor_pct: 10 },
      { qty: 1, unit_price_cents: null, coverage_per_unit: 2.2, coverage_unit: 'm2' }
    );
    expect(estimate).toBe(0);
    expect(Number.isNaN(estimate)).toBe(false);
  });
});
