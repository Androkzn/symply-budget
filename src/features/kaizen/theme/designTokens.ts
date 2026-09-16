/**
 * Symply Life (brand `symply-kaizen`) — design-token barrel.
 *
 * Re-exports the ecosystem design tokens (Spacing / Typography / CornerRadius / Layout / …)
 * unchanged and adds `GlassRadius`, the one token family the donor Kaizen screens use that
 * the ecosystem `@theme/designTokens` does not define. Values match the donor 1:1.
 */
export * from '@theme/designTokens';

export const GlassRadius = {
  button: 18,
  card: 24,
  cardTight: 20,
  sheet: 28,
  tabBar: 28,
  pill: 999,
} as const;
