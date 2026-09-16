/**
 * Sales-tax attribution for scanned receipts.
 *
 * Splits a receipt's sales tax back onto each individual line item so a budget
 * "expense" can be stored TAX-INCLUSIVE (item price + its share of tax) and the
 * per-item totals reconcile to the grand total actually charged.
 *
 * Source-of-truth order (most trustworthy first):
 *   1. PRINTED tax amounts + per-item flag letters (primary) — distribute each
 *      printed tax component (e.g. GST 4.75) across the items that carry its
 *      flag, proportional to price. Sums to the printed amount to the cent.
 *   2. PRINTED single/unlabelled tax total, items without flags (secondary) —
 *      spread the total across all items proportional to price.
 *   3. Per-item flags but NO printed amounts (tertiary) — compute from the
 *      household's province/state rate table.
 *   4. Nothing to go on — zero tax (unchanged behaviour).
 *
 * All amounts are integer CENTS.
 */

/** A per-code sales-tax rate map for a region, e.g. BC = { G: 0.05, P: 0.07 }. */
export interface TaxProfile {
  region: string;
  /** Flag letter (as printed on receipts) -> rate fraction. */
  rates: Record<string, { label: string; rate: number }>;
}

/** Minimal line shape the attributor needs. */
export interface TaxableLine {
  /** Pre-tax price paid for the line, in cents (>= 0). */
  amount: number;
  /**
   * Amount used for rate/weight (defaults to `amount`). CA refundable
   * deposits are excluded here; environmental levies and US CRV stay in.
   */
  tax_base?: number;
  /** Raw tax flag letters on the line, e.g. ["G","P"]; [] = exempt. */
  tax_codes: string[];
}

/** One tax line read from the receipt summary/legend. */
export interface TaxComponentInput {
  code: string | null;
  label: string;
  rate_percent: number | null;
  amount: number;
}

export interface TaxAttributionResult {
  /** Per-line tax in cents; same order & length as the input lines. */
  lineTaxes: number[];
  /** Sum of lineTaxes. */
  totalTax: number;
  /** Tax grouped by label for display, e.g. [{label:"GST",amount:475}, ...]. */
  breakdown: Array<{ label: string; amount: number }>;
  /** Which strategy produced the numbers (diagnostics/tests). */
  source: 'printed-coded' | 'printed-spread' | 'profile-rates' | 'none';
}

const norm = (code: string): string => code.trim().toUpperCase();

/**
 * Distribute an integer `total` across `weights` so the parts are integers that
 * sum EXACTLY to `total` (largest-remainder method). Zero/blank weights split
 * the total evenly.
 */
function distributeCents(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (total <= 0) return new Array(n).fill(0);

  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sumW <= 0) {
    // No price signal — split evenly, remainder to the earliest lines.
    const base = Math.floor(total / n);
    const rem = total - base * n;
    return weights.map((_, i) => base + (i < rem ? 1 : 0));
  }

  const raw = weights.map((w) => (total * Math.max(0, w)) / sumW);
  const floors = raw.map((v) => Math.floor(v));
  const assigned = floors.reduce((s, v) => s + v, 0);
  let remainder = total - assigned;
  // Hand out the leftover cents to the largest fractional parts.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remainder > 0; k++) {
    floors[order[k].i] += 1;
    remainder -= 1;
  }
  return floors;
}

/**
 * Attribute a receipt's sales tax onto each line item.
 *
 * @param lines       pre-tax line items (amount + flag letters)
 * @param taxSummary  tax lines read from the receipt (may be empty)
 * @param profile     province/state rate table for the tertiary fallback (or null)
 */
export function attributeItemTaxes(
  lines: TaxableLine[],
  taxSummary: TaxComponentInput[],
  profile: TaxProfile | null
): TaxAttributionResult {
  const lineTaxes = new Array(lines.length).fill(0);
  const breakdownByLabel = new Map<string, number>();
  const addBreakdown = (label: string, amount: number): void => {
    if (amount <= 0) return;
    breakdownByLabel.set(label, (breakdownByLabel.get(label) ?? 0) + amount);
  };

  const lineCodes = lines.map((l) => new Set((l.tax_codes ?? []).map(norm)));

  // Keep only tax lines that give us something to work with.
  const components = (taxSummary ?? []).filter(
    (t) => (Number.isFinite(t.amount) && t.amount > 0) || (t.rate_percent != null && t.rate_percent > 0)
  );

  let usedPrintedAmount = false;
  let anyCodedTarget = false;

  if (components.length > 0) {
    for (const comp of components) {
      const code = comp.code ? norm(comp.code) : null;

      // Which lines does this tax component apply to?
      let targetIdx: number[];
      if (code) {
        targetIdx = lines.map((_, i) => i).filter((i) => lineCodes[i].has(code));
        if (targetIdx.length > 0) anyCodedTarget = true;
      } else {
        targetIdx = lines.map((_, i) => i);
      }
      // A printed tax with no matching flagged item still has to land somewhere
      // (so totals reconcile) — spread it across all lines.
      if (targetIdx.length === 0) targetIdx = lines.map((_, i) => i);
      if (targetIdx.length === 0) continue;

      // Resolve the dollar amount for this component.
      let amount = 0;
      if (Number.isFinite(comp.amount) && comp.amount > 0) {
        amount = Math.round(comp.amount);
        usedPrintedAmount = true;
      } else if (comp.rate_percent != null && comp.rate_percent > 0) {
        const base = targetIdx.reduce((s, i) => s + Math.max(0, lines[i].tax_base ?? lines[i].amount), 0);
        amount = Math.round((base * comp.rate_percent) / 100);
      }
      if (amount <= 0) continue;

      const weights = targetIdx.map((i) => lines[i].tax_base ?? lines[i].amount);
      const parts = distributeCents(amount, weights);
      targetIdx.forEach((i, k) => {
        lineTaxes[i] += parts[k];
      });
      addBreakdown(comp.label || 'Tax', amount);
    }

    const totalTax = lineTaxes.reduce((s, v) => s + v, 0);
    if (totalTax > 0) {
      return {
        lineTaxes,
        totalTax,
        breakdown: sortBreakdown(breakdownByLabel),
        source: usedPrintedAmount
          ? anyCodedTarget
            ? 'printed-coded'
            : 'printed-spread'
          : 'profile-rates',
      };
    }
  }

  // Tertiary: no usable printed tax — derive from the region rate table using
  // whatever flag letters the items carry.
  if (profile) {
    let any = false;
    lines.forEach((line, i) => {
      const codes = lineCodes[i];
      if (codes.size === 0) return;
      let lineTax = 0;
      for (const code of codes) {
        const rule = profile.rates[code];
        if (!rule) continue;
        const t = Math.round((line.tax_base ?? line.amount) * rule.rate);
        if (t > 0) {
          lineTax += t;
          addBreakdown(rule.label, t);
          any = true;
        }
      }
      lineTaxes[i] += lineTax;
    });
    if (any) {
      const totalTax = lineTaxes.reduce((s, v) => s + v, 0);
      return {
        lineTaxes,
        totalTax,
        breakdown: sortBreakdown(breakdownByLabel),
        source: 'profile-rates',
      };
    }
  }

  return { lineTaxes, totalTax: 0, breakdown: [], source: 'none' };
}

function sortBreakdown(map: Map<string, number>): Array<{ label: string; amount: number }> {
  return Array.from(map.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Province / state rate tables (tertiary fallback only — a PRINTED tax amount
// on the receipt always wins over these). Keyed by receipt flag letter.
// ---------------------------------------------------------------------------

const GST = { label: 'GST', rate: 0.05 };

const CA_PROFILES: Record<string, TaxProfile['rates']> = {
  AB: { G: GST },
  BC: {
    G: GST,
    P: { label: 'PST', rate: 0.07 },
    L: { label: 'PST Liquor', rate: 0.10 },
  },
  MB: { G: GST, P: { label: 'PST', rate: 0.07 } },
  NB: { H: { label: 'HST', rate: 0.15 } },
  NL: { H: { label: 'HST', rate: 0.15 } },
  NS: { H: { label: 'HST', rate: 0.14 } },
  NT: { G: GST },
  NU: { G: GST },
  ON: { H: { label: 'HST', rate: 0.13 } },
  PE: { H: { label: 'HST', rate: 0.15 } },
  QC: { G: GST, P: { label: 'QST', rate: 0.09975 } },
  SK: { G: GST, P: { label: 'PST', rate: 0.06 } },
  YT: { G: GST },
};

const CA_NAME_TO_CODE: Record<string, string> = {
  ALBERTA: 'AB',
  'BRITISH COLUMBIA': 'BC',
  MANITOBA: 'MB',
  'NEW BRUNSWICK': 'NB',
  'NEWFOUNDLAND AND LABRADOR': 'NL',
  NEWFOUNDLAND: 'NL',
  'NOVA SCOTIA': 'NS',
  'NORTHWEST TERRITORIES': 'NT',
  NUNAVUT: 'NU',
  ONTARIO: 'ON',
  'PRINCE EDWARD ISLAND': 'PE',
  QUEBEC: 'QC',
  SASKATCHEWAN: 'SK',
  YUKON: 'YT',
};

/** Approx. US state base sales-tax rate (combined local taxes vary and a printed
 * amount always overrides this). Keyed to the generic single flag letters. */
const US_STATE_RATE: Record<string, number> = {
  AL: 0.04, AK: 0.0, AZ: 0.056, AR: 0.065, CA: 0.0725, CO: 0.029, CT: 0.0635,
  DE: 0.0, FL: 0.06, GA: 0.04, HI: 0.04, ID: 0.06, IL: 0.0625, IN: 0.07,
  IA: 0.06, KS: 0.065, KY: 0.06, LA: 0.0445, ME: 0.055, MD: 0.06, MA: 0.0625,
  MI: 0.06, MN: 0.0688, MS: 0.07, MO: 0.0423, MT: 0.0, NE: 0.055, NV: 0.0685,
  NH: 0.0, NJ: 0.0663, NM: 0.0513, NY: 0.04, NC: 0.0475, ND: 0.05, OH: 0.0575,
  OK: 0.045, OR: 0.0, PA: 0.06, RI: 0.07, SC: 0.06, SD: 0.045, TN: 0.07,
  TX: 0.0625, UT: 0.061, VT: 0.06, VA: 0.053, WA: 0.065, WV: 0.06, WI: 0.05,
  WY: 0.04, DC: 0.06,
};

const US_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI',
  WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
};

/**
 * Build a province/state tax profile from a household's location. Returns null
 * when the region is unknown. Accepts either a two-letter code or a full name.
 */
export function getTaxProfile(
  country: string | null | undefined,
  stateProvince: string | null | undefined
): TaxProfile | null {
  if (!stateProvince) return null;
  const raw = stateProvince.trim().toUpperCase();
  const ctry = (country ?? '').trim().toUpperCase();

  if (ctry === 'CA' || ctry === 'CANADA' || (!ctry && CA_PROFILES[raw])) {
    const code = CA_PROFILES[raw] ? raw : CA_NAME_TO_CODE[raw];
    const rates = code ? CA_PROFILES[code] : undefined;
    if (rates) return { region: code, rates };
  }

  if (ctry === 'US' || ctry === 'USA' || ctry === 'UNITED STATES') {
    const code = US_STATE_RATE[raw] != null ? raw : US_NAME_TO_CODE[raw];
    const rate = code != null ? US_STATE_RATE[code] : undefined;
    if (rate != null && rate > 0) {
      // US receipts print a single combined tax; map every common single flag
      // letter (S/T/A/B/1) to that rate so a flagged line resolves.
      const rule = { label: 'Sales Tax', rate };
      return {
        region: code,
        rates: { S: rule, T: rule, A: rule, B: rule, X: rule, '1': rule },
      };
    }
  }

  return null;
}
