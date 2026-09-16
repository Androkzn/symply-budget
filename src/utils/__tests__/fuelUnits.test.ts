/**
 * Gallons → litres, for a member who buys fuel by the litre.
 *
 * The constants are checked against their DEFINITIONS rather than copied from a
 * table: a transcription slip in a conversion factor is invisible in review and
 * wrong on every receipt forever after.
 */
import {
  IMPERIAL_GALLON_LITRES,
  US_GALLON_LITRES,
  formatLitres,
  formatPerLitre,
  normalizeVolumeUnit,
  pricePerLitre,
  toLitres,
} from '@utils/fuelUnits';

describe('conversion constants', () => {
  it('derives the US gallon from its legal definition', () => {
    // A US liquid gallon is exactly 231 cubic inches, and an inch is exactly
    // 2.54 cm — so the litre value is exact, not measured.
    const cubicInchInCubicCm = 2.54 ** 3;
    const litres = (231 * cubicInchInCubicCm) / 1000;
    expect(litres).toBeCloseTo(US_GALLON_LITRES, 9);
    expect(US_GALLON_LITRES).toBe(3.785411784);
  });

  it('keeps the imperial gallon distinct — it is 20% larger', () => {
    expect(IMPERIAL_GALLON_LITRES).toBe(4.54609);
    const ratio = IMPERIAL_GALLON_LITRES / US_GALLON_LITRES;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.21);
  });
});

describe('normalizeVolumeUnit', () => {
  it('recognises the ways a pump prints gallons', () => {
    expect(normalizeVolumeUnit('G')).toBe('gal');
    expect(normalizeVolumeUnit('gal')).toBe('gal');
    expect(normalizeVolumeUnit('GALLONS')).toBe('gal');
    expect(normalizeVolumeUnit('gal.')).toBe('gal');
  });

  it('separates imperial gallons from US ones', () => {
    expect(normalizeVolumeUnit('imp gal')).toBe('imp_gal');
    expect(normalizeVolumeUnit('UK gal')).toBe('imp_gal');
  });

  it('recognises litres', () => {
    expect(normalizeVolumeUnit('L')).toBe('L');
    expect(normalizeVolumeUnit('litres')).toBe('L');
    expect(normalizeVolumeUnit('liter')).toBe('L');
  });

  it('returns null for units that are not volumes', () => {
    // Most receipt lines are counts or weights; only fuel is a volume.
    expect(normalizeVolumeUnit('ea')).toBeNull();
    expect(normalizeVolumeUnit('lb')).toBeNull();
    expect(normalizeVolumeUnit('kg')).toBeNull();
    expect(normalizeVolumeUnit('')).toBeNull();
    expect(normalizeVolumeUnit(null)).toBeNull();
  });
});

describe('toLitres', () => {
  it('converts the real Kendall Market fill-up', () => {
    // US-recept-1.HEIC: "Supreme-+  10.068G" -> 10.068 x 3.785411784
    expect(toLitres(10.068, 'gal')).toBeCloseTo(38.1115, 4);
  });

  it('leaves litres alone', () => {
    expect(toLitres(38.1, 'L')).toBe(38.1);
  });

  it('refuses nonsense quantities rather than inventing volume', () => {
    expect(toLitres(0, 'gal')).toBe(0);
    expect(toLitres(-5, 'gal')).toBe(0);
    expect(toLitres(Number.NaN, 'gal')).toBe(0);
  });
});

describe('pricePerLitre', () => {
  it('prices the real fill-up per litre in its own currency', () => {
    // $61.40 for 10.068 US gal = 38.109 L -> $1.611/L
    const perLitre = pricePerLitre(6140, 10.068, 'gal');
    expect(perLitre).not.toBeNull();
    expect(perLitre! / 100).toBeCloseTo(1.611, 3);
  });

  it('agrees with the printed price per gallon', () => {
    // The receipt prints PRICE/GAL $6.099; dividing that by the gallon should
    // give the same per-litre figure as dividing the total by the litres.
    const fromTotal = pricePerLitre(6140, 10.068, 'gal')!;
    const fromUnitPrice = 609.9 / US_GALLON_LITRES;
    expect(fromTotal).toBeCloseTo(fromUnitPrice, 1);
  });

  it('is null when it cannot be known, never zero', () => {
    // Zero would be a claim about the fuel's price. Null is the absence of one.
    expect(pricePerLitre(6140, 0, 'gal')).toBeNull();
    expect(pricePerLitre(0, 10, 'gal')).toBeNull();
    expect(pricePerLitre(6140, -1, 'gal')).toBeNull();
  });
});

describe('formatting', () => {
  it('keeps the tenth-of-a-cent pumps actually quote', () => {
    // formatMoney would clamp this to $1.61 and lose the digit the member is
    // comparing against their local station.
    expect(formatPerLitre(161.1, 'USD')).toBe('$1.611/L');
    expect(formatPerLitre(222.7, 'CAD')).toBe('CA$2.227/L');
  });

  it('drops sub-unit precision for a currency that has none', () => {
    expect(formatPerLitre(16110, 'JPY')).toBe('¥161.1/L');
  });

  it('reports litres at pump resolution', () => {
    expect(formatLitres(38.109)).toBe('38.1 L');
  });
});
