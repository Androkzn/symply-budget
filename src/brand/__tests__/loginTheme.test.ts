/**
 * Per-brand login identity (src/brand/loginTheme.ts).
 *
 * The auth screens are shared across every app and read their wordmark/slogan
 * colours from this map. A missing entry silently falls back to Kaizen, so the
 * Language app would show mint/teal on its orange brand. Asserts the Symply
 * Language entry exists, is its own object, and keeps the light/dark stop
 * structure the gradient components index into.
 */

import { getBrandLoginTheme, getBrandWordmarkGradient } from '@brand/loginTheme';

describe('getBrandLoginTheme — Symply Language', () => {
  const theme = getBrandLoginTheme('symply-language');

  it('is not the Kaizen fallback', () => {
    expect(theme).not.toBe(getBrandLoginTheme('symply-kaizen'));
  });

  it('uses the Language slogan and subtitle', () => {
    expect(theme.slogan).toBe('Fluency, Faster');
    expect(theme.subtitle).toBe('Learn. Speak. Master.');
  });

  it('ships a 3-stop wordmark gradient in both themes', () => {
    expect(theme.wordmark.light).toHaveLength(3);
    expect(theme.wordmark.dark).toHaveLength(3);
    expect(theme.wordmark.light[0]).toBe('#A8501E');
    expect(theme.wordmark.dark[0]).toBe('#FFE2BA');
  });

  it('ships a 2-stop slogan gradient in both themes', () => {
    expect(theme.sloganGradient.light).toHaveLength(2);
    expect(theme.sloganGradient.dark).toHaveLength(2);
    expect(theme.sloganGradient.light[0]).toBe('#C2662E');
  });

  it('falls back to Kaizen for an unknown brand id', () => {
    expect(getBrandLoginTheme('symply-nope')).toBe(getBrandLoginTheme('symply-kaizen'));
  });
});

/**
 * Symply Health ships the shared LoginScreen; only these strings and stops make
 * it read as Health. `login-screen-controls.yaml` asserts the same copy on the
 * simulator, so drift here breaks the Health auth E2E rather than any type check.
 */
describe('getBrandLoginTheme — Symply Health', () => {
  const theme = getBrandLoginTheme('symply-health');

  it('HEALTH-AUTH-020: is not the Kaizen fallback', () => {
    expect(theme).not.toBe(getBrandLoginTheme('symply-kaizen'));
  });

  it('HEALTH-AUTH-021: uses the Health slogan and subtitle asserted by the E2E flow', () => {
    expect(theme.slogan).toBe('Health, Simplified');
    expect(theme.subtitle).toBe('Track. Move. Thrive.');
  });

  it('HEALTH-AUTH-022: ships a 3-stop wordmark gradient in both themes', () => {
    expect(theme.wordmark.light).toHaveLength(3);
    expect(theme.wordmark.dark).toHaveLength(3);
    expect(theme.wordmark.light[0]).toBe('#A02830');
    expect(theme.wordmark.dark[0]).toBe('#FFD0C6');
  });

  it('HEALTH-AUTH-023: ships a 2-stop slogan gradient in the Health red family', () => {
    expect(theme.sloganGradient.light).toHaveLength(2);
    expect(theme.sloganGradient.dark).toHaveLength(2);
    expect(theme.sloganGradient.light[0]).toBe('#C1383C');
  });

  it('HEALTH-AUTH-024: the wordmark gradient anchors the wordmark and sweeps into the accent', () => {
    const light = getBrandWordmarkGradient('symply-health', false);
    const dark = getBrandWordmarkGradient('symply-health', true);
    expect(light).toEqual(['#A02830', '#C1383C', '#CE4A62']);
    expect(dark).toEqual(['#FFD0C6', '#FF9A8A', '#FF8AA8']);
  });
});

/**
 * Every shipping brand must own an entry — a missing one silently renders the
 * Kaizen mint/teal identity on someone else's login screen.
 */
describe('getBrandLoginTheme — fleet coverage', () => {
  const FLEET = [
    'symply-house',
    'symply-budget',
    'symply-kaizen',
    'symply-language',
    'symply-health',
  ];

  // Kaizen deliberately ships an empty slogan (hidden by the LoginScreen tagline
  // guard); every other brand must carry copy.
  it.each(FLEET)('%s owns a full 3+2 stop gradient pair in both themes', (id) => {
    const theme = getBrandLoginTheme(id);
    expect(theme.subtitle.length).toBeGreaterThan(0);
    expect(theme.wordmark.light).toHaveLength(3);
    expect(theme.wordmark.dark).toHaveLength(3);
    expect(theme.sloganGradient.light).toHaveLength(2);
    expect(theme.sloganGradient.dark).toHaveLength(2);
    if (id !== 'symply-kaizen') {
      // A missing entry silently resolves to the Kaizen fallback object.
      expect(theme).not.toBe(getBrandLoginTheme('symply-kaizen'));
      expect(theme.slogan.length).toBeGreaterThan(0);
    }
  });

  it('no two brands share a subtitle', () => {
    const subtitles = FLEET.map((id) => getBrandLoginTheme(id).subtitle);
    expect(new Set(subtitles).size).toBe(FLEET.length);
  });
});
