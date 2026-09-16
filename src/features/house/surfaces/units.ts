/**
 * Display units for the surface editor.
 *
 * The model is metres, always and everywhere — `home_project_geometry` has
 * carried `units: 'm'` since the feature shipped and a document whose numbers
 * mean different things on different devices is unmergeable. What the member
 * *sees* is a presentation choice, defaulted from `households.unit_system`
 * (migration 0142) and overridable per member, the same canonical-value /
 * display-unit split `src/utils/areaUnits.ts` established for spaces.
 *
 * ## Four units, not two
 *
 * `unit_system` is a binary (metric / imperial) and it is the right default, but
 * it is the wrong *only* answer for this screen. Someone measuring a splashback
 * works in centimetres even though their house is in metres; a US tiler quotes a
 * niche in inches even though the room is in feet. Both were forced to convert
 * in their head, and a conversion done in the head of someone entering
 * measurements is where wrong quantities come from. So the picker offers m, cm,
 * ft and in, and the household setting only decides which one is selected first.
 *
 * ## Three details that are easy to get wrong
 *
 *  - **Feet and inches, not decimal feet.** A member measuring a wainscot says
 *    "three foot six", never "3.5 ft", and a tape measure has no decimal
 *    markings. Typing has to accept both.
 *  - **A suffix always wins.** Typing `2.4m` while the picker says `ft` means
 *    2.4 metres, not 2.4 feet. Someone reading a spec sheet should never have to
 *    change a picker to enter the number in front of them, and honouring what
 *    they wrote is the only reading that cannot silently be wrong.
 *  - **Millimetres stay millimetres for materials.** Tile faces and grout are
 *    specified in mm worldwide — a US spec sheet says "12 × 24 in (300 × 600
 *    mm)" — so `MaterialEditorSheet` does not use this module at all. Inches
 *    with sixteenths would make the pattern arithmetic unreadable for no gain.
 */

import type { HouseUnitSystem } from '@api/households';

export type LengthUnit = 'm' | 'cm' | 'ft' | 'in';

export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;
export const SQFT_PER_SQM = 10.7639104167;

/** Everything the picker needs, in the order it is offered. */
export const LENGTH_UNIT_OPTIONS: ReadonlyArray<{
  unit: LengthUnit;
  /** The chip label. */
  label: string;
  /** Read out by a screen reader, where "in" and "m" are ambiguous. */
  accessibilityLabel: string;
}> = [
  { unit: 'ft', label: 'ft / in', accessibilityLabel: 'feet and inches' },
  { unit: 'in', label: 'in', accessibilityLabel: 'inches' },
  { unit: 'm', label: 'm', accessibilityLabel: 'metres' },
  { unit: 'cm', label: 'cm', accessibilityLabel: 'centimetres' },
];

/** Is this unit part of the metric family? Drives area units and keyboards. */
export function isMetricUnit(unit: LengthUnit): boolean {
  return unit === 'm' || unit === 'cm';
}

/**
 * The unit a household starts on.
 *
 * `ft` rather than `in` for imperial, and `m` rather than `cm` for metric,
 * because those are the units rooms are described in. The other two are there
 * for the member who is measuring something small.
 */
export function lengthUnitFor(system: HouseUnitSystem | undefined): LengthUnit {
  return system === 'metric' ? 'm' : 'ft';
}

export function metresToFeet(m: number): number {
  return m / M_PER_FT;
}

export function feetToMetres(ft: number): number {
  return ft * M_PER_FT;
}

export function metresToInches(m: number): number {
  return m / M_PER_IN;
}

export function inchesToMetres(inches: number): number {
  return inches * M_PER_IN;
}

/** `2.35` → `7' 8"`. Rounds to the nearest inch, and carries 12" up to a foot. */
export function formatFeetInches(metres: number): string {
  const totalInches = Math.round(metresToFeet(metres) * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet === 0) return `${inches}"`;
  return inches === 0 ? `${feet}'` : `${feet}' ${inches}"`;
}

/**
 * A length for a dimension label — `2.35 m`, `235 cm`, `7' 8"` or `92"`.
 *
 * Centimetres and inches are whole numbers: a room measured to a tenth of a
 * centimetre is precision nobody has, and the decimal point costs width on a
 * label that has to sit beside a drawn edge.
 */
export function formatLength(metres: number, unit: LengthUnit): string {
  switch (unit) {
    case 'm':
      return `${metres.toFixed(2)} m`;
    case 'cm':
      return `${Math.round(metres * 100)} cm`;
    case 'in':
      return `${Math.round(metresToInches(metres))}"`;
    case 'ft':
    default:
      return formatFeetInches(metres);
  }
}

/**
 * An area — `8.64 m²` or `93 sq ft`.
 *
 * Deliberately only two answers for four units. A wall in square centimetres is
 * 96,000 of them and a floor in square inches is worse; neither is a number
 * anyone can hold, and no supplier quotes in either. So the metric units both
 * report m² and the imperial ones both report sq ft, which is what the member
 * would have converted to anyway.
 */
export function formatSurfaceArea(
  squareMetres: number,
  unit: LengthUnit,
): string {
  return isMetricUnit(unit)
    ? `${squareMetres.toFixed(2)} m²`
    : `${Math.round(squareMetres * SQFT_PER_SQM).toLocaleString()} sq ft`;
}

/**
 * Parse what a member typed into metres.
 *
 * An explicit suffix always wins over the selected unit — `2.4m` is metres even
 * in feet mode, `18"` is inches even in metric mode. Only a bare number is read
 * as the selected unit, and in `ft` a bare pair (`7 8`, `7' 8"`) is feet and
 * inches.
 *
 * Returns null for anything it cannot read, so the caller can leave the field
 * alone rather than replace the member's half-typed value with `NaN` — the
 * single most irritating bug class in a numeric form.
 */
export function parseLength(input: string, unit: LengthUnit): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === '') return null;

  // ---- an explicit suffix, whatever the picker says ------------------------
  const suffixed = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|"|''|in|inch(?:es)?|'|ft|feet)$/,
  );
  if (suffixed) {
    const value = Number(suffixed[1]);
    if (!Number.isFinite(value)) return null;
    switch (suffixed[2]) {
      case 'mm':
        return value / 1000;
      case 'cm':
        return value / 100;
      case 'm':
        return value;
      case "'":
      case 'ft':
      case 'feet':
        return feetToMetres(value);
      default:
        return inchesToMetres(value);
    }
  }

  // ---- feet and inches together -------------------------------------------
  // `7' 8"`, `7'8`, `7ft 8in`. The foot mark is what makes this unambiguous, so
  // it is honoured in ANY unit — the same rule as a single suffix, and a member
  // reading `7'8"` off a plan should not have to change a picker to enter it.
  // The separating space is optional: `7'8` is how most people type it.
  const marked = text.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?$/,
  );
  if (marked) {
    const feet = Number(marked[1]);
    const inches = Number(marked[2]);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    return feetToMetres(feet) + inchesToMetres(inches);
  }

  // A bare pair — `7 8` — carries no marks at all, so it is only a measurement
  // when the picker already says feet. In centimetres `240 3` is a typo, and
  // reading it as anything would invent a number nobody entered.
  if (unit === 'ft') {
    const pair = text.match(/^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    if (pair) {
      const feet = Number(pair[1]);
      const inches = Number(pair[2]);
      if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
      return feetToMetres(feet) + inchesToMetres(inches);
    }
  }

  // ---- a bare number, in the selected unit --------------------------------
  const bare = text.match(/^(-?\d+(?:\.\d+)?)$/);
  if (!bare) return null;
  const value = Number(bare[1]);
  if (!Number.isFinite(value)) return null;
  switch (unit) {
    case 'm':
      return value;
    case 'cm':
      return value / 100;
    case 'in':
      return inchesToMetres(value);
    case 'ft':
    default:
      return feetToMetres(value);
  }
}

/**
 * What a numeric input should be prefilled with, in the display unit.
 *
 * Unsuffixed for the units whose keyboard is numeric (`m`, `cm`), because a
 * member editing "2.40" should not have to delete a trailing "m" first. The
 * imperial forms keep their marks, since `7' 8"` is unreadable without them.
 */
export function lengthInputValue(metres: number, unit: LengthUnit): string {
  switch (unit) {
    case 'm':
      return metres.toFixed(2);
    case 'cm':
      return String(Math.round(metres * 100));
    case 'in':
      return `${Math.round(metresToInches(metres))}"`;
    case 'ft':
    default:
      return formatFeetInches(metres);
  }
}

/**
 * The keyboard a length field should raise.
 *
 * Metric units get the decimal pad — a metric length is a plain decimal and
 * nothing else has to be typeable.
 *
 * The imperial ones cannot use it: `parseLength` reads `7' 8"` and a decimal pad
 * has no foot or inch mark, so a member who cannot type the mark ends up
 * entering `7.67` for `7' 8"`, which is a different wall. They used to get
 * `'default'` — the FULL QWERTY keyboard, with every letter one tap away from a
 * measurement. `numbers-and-punctuation` is the narrowest keypad that still
 * carries `'` and `"`: digits and punctuation up front, letters only behind the
 * `ABC` key. That is the documented exception in `@utils/keyboard` (a genuinely
 * mixed string), not the currency-field mistake it warns about — an imperial
 * length IS `7' 8"`, and `parseLength` also accepts the `ft` / `in` / `m` / `cm`
 * suffixes a member may type, so letters cannot be filtered out of these fields
 * either. Do NOT wrap an imperial length field in `numericTextHandler`.
 */
export function lengthKeyboardType(
  unit: LengthUnit,
): 'decimal-pad' | 'numbers-and-punctuation' {
  return isMetricUnit(unit) ? 'decimal-pad' : 'numbers-and-punctuation';
}

/** A placeholder in the right shape for the unit — `2.40`, `240`, `7' 8"`. */
export function lengthPlaceholder(unit: LengthUnit): string {
  switch (unit) {
    case 'm':
      return '2.40';
    case 'cm':
      return '240';
    case 'in':
      return '94"';
    case 'ft':
    default:
      return `7' 10"`;
  }
}

export function lengthUnitLabel(unit: LengthUnit): string {
  return (
    LENGTH_UNIT_OPTIONS.find(option => option.unit === unit)?.label ?? unit
  );
}
