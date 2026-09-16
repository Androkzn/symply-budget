import { palette } from '@theme/colors';

import { gradients } from '../../brand/tokens.generated';
import { getButtonGradientColors } from '../buttonGradients';

describe('getButtonGradientColors', () => {
  it('resolves primary and teal to the brand CTA ramp', () => {
    const cta = gradients.cta.colors;
    expect(getButtonGradientColors('primary')).toEqual(cta);
    expect(getButtonGradientColors('teal')).toEqual(getButtonGradientColors('primary'));
    // CTA must be a visible hue shift (not primary → primaryDark only).
    expect(cta[0]).not.toBe(palette.button.tealDark);
  });

  it('returns a flat disabled fill when disabled', () => {
    expect(
      getButtonGradientColors('primary', { disabled: true, disabledColor: '#ccc' })
    ).toEqual(['#ccc', '#ccc']);
  });

  it('keeps blue and orange as accent variants', () => {
    expect(getButtonGradientColors('blue')).toEqual([
      palette.button.blue,
      palette.button.blueMid,
      palette.button.blueDark,
    ]);
    expect(getButtonGradientColors('orange')).toEqual([
      palette.button.orange,
      palette.button.orangeDark,
    ]);
  });

  it('gives blue a hue-spanning ramp as rich as the brand CTA', () => {
    const blue = getButtonGradientColors('blue');
    // Multi-stop and a genuine start→end hue shift (not a near-flat fill).
    expect(blue.length).toBeGreaterThanOrEqual(3);
    expect(blue[0]).not.toBe(blue[blue.length - 1]);
  });

  it('resolves secondary to the brand-owned secondary ramp, distinct from cta', () => {
    const secondary = getButtonGradientColors('secondary');
    const brandSecondary = (gradients as unknown as {
      secondary?: { colors: string[] };
    }).secondary;
    if (brandSecondary?.colors && brandSecondary.colors.length >= 2) {
      expect(secondary).toEqual(brandSecondary.colors);
    }
    // Secondary must not collapse onto the main CTA ramp.
    expect(secondary).not.toEqual(getButtonGradientColors('primary'));
    // Rich, hue-spanning ramp (not a flat single-hue fill).
    expect(secondary.length).toBeGreaterThanOrEqual(2);
    expect(secondary[0]).not.toBe(secondary[secondary.length - 1]);
  });
});
