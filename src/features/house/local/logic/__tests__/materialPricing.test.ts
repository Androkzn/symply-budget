/**
 * Material option pricing — the LOCAL-FIRST half of the shared truth table.
 *
 * The Worker prices an option in `backend/src/services/home-projects/pricing.ts`
 * and this device prices it in `logic/homeProjects.ts`. Two implementations, and
 * the member must not be able to tell which one answered: a household that turns
 * local-first on mid-renovation would watch its floor change price.
 *
 * **The cases are not written here.** Both suites read
 * `backend/src/services/home-projects/pricing-fixtures.json` off disk, because a
 * parity test where each side asserts its own expected values proves only that
 * each side agrees with itself — if the mirror rounded 10.9 boxes down while the
 * Worker rounded up, two green suites would certify the divergence. The file is
 * read rather than imported so that a rename breaks this test loudly instead of
 * silently reverting it to nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  budgetEstimateCents,
  fromSquareMeters,
  priceOption,
  toSquareMeters,
  type OptionPricing,
  type PricingGroupInput,
  type PricingOptionInput,
} from '../homeProjects';

type Fixture = {
  name: string;
  group: PricingGroupInput;
  option: PricingOptionInput;
  expected: OptionPricing;
};

const FIXTURE_PATH = join(
  __dirname,
  '../../../../../../backend/src/services/home-projects/pricing-fixtures.json'
);

function loadFixtures(): Fixture[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { cases: Fixture[] };
  return parsed.cases;
}

const CASES = loadFixtures();

describe('priceOption — shared fixture table (local mirror)', () => {
  it('reads the same file the Worker suite reads', () => {
    // If this ever passes with an empty table, every it.each below is vacuous
    // and the parity guarantee is gone while the suite still reports green.
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
    expect(Number.isInteger(priceOption(group, option).units_needed)).toBe(true);
  });

  it('buys at least enough to cover the area with its waste allowance', () => {
    const pricing = priceOption(group, option);
    expect((pricing.units_needed as number) * 2.2).toBeGreaterThanOrEqual(24 * 1.1);
  });

  it('quotes at least the smooth product, never less', () => {
    // Under-quoting a renovation is the one failure this feature must not have.
    const pricing = priceOption(group, option);
    expect(pricing.area_total_cents as number).toBeGreaterThanOrEqual(
      Math.floor((24 * 1.1 * 4599) / 2.2)
    );
  });
});

describe('unit conversion', () => {
  it('round-trips through m²', () => {
    expect(fromSquareMeters(toSquareMeters(250, 'sqft'), 'sqft')).toBeCloseTo(250, 9);
  });

  it('agrees with the international foot', () => {
    expect(toSquareMeters(1, 'sqft')).toBeCloseTo(0.09290304, 12);
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
    const estimate = budgetEstimateCents(
      { area_value: 24, area_unit: 'm2', waste_factor_pct: 10 },
      { qty: 1, unit_price_cents: null, coverage_per_unit: 2.2, coverage_unit: 'm2' }
    );
    expect(estimate).toBe(0);
    expect(Number.isNaN(estimate)).toBe(false);
  });
});
