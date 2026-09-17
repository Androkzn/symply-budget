import { brandWordmarkFontFamily } from '../BrandWordmark';

describe('brandWordmarkFontFamily', () => {
  it('uses the native system face on iOS', () => {
    expect(brandWordmarkFontFamily('ios')).toBe('System');
  });

  it('uses an explicit system sans stack on Web instead of SVG serif fallback', () => {
    expect(brandWordmarkFontFamily('web')).toContain('system-ui');
    expect(brandWordmarkFontFamily('web')).toContain('sans-serif');
  });
});
