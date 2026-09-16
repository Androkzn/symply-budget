import { brandIconAssets } from '../../../brand/icons.generated';
import { aliasToBrandIcon, IONICON_TO_BRAND } from '../ioniconAliases';

/**
 * `IONICON_TO_BRAND` is a GLOBAL map — an entry added for one screen's
 * semantics repaints that glyph everywhere the Ionicon name is used. Two real
 * regressions came out of that and these tests pin both.
 */
describe('ioniconAliases', () => {
  // NOTE: deliberately NOT asserting that every alias target exists in
  // `brandIconAssets`. That map is generated for whichever brand was last
  // built — House in the Jest baseline, but any of the five after a local
  // `icons:build` — so targets owned by other brands' kits (telescope,
  // heart-rate, speaking, inspection) are legitimately absent and fall back to
  // Ionicons by design. Which is why nothing here asserts a glyph is PRESENT:
  // that only ever measured which brand Jest last generated for.

  describe('generic UI affordances must not be captured by domain glyphs', () => {
    // `close-circle` is the app's clear-field / remove-attachment / dismiss X in
    // 18+ screens, several tinted `colors.error`. It was aliased to the House
    // task-status glyph `skipped`, so every one of them rendered a clock-and-
    // warning instead of an X. The status glyph stays reachable by its own name.
    it('leaves close-circle unaliased so it renders a real X', () => {
      expect(IONICON_TO_BRAND['close-circle']).toBeUndefined();
      expect(aliasToBrandIcon('close-circle')).toBeUndefined();
      expect(aliasToBrandIcon('close-circle-outline')).toBeUndefined();
      // The brand glyph is still available deliberately, via its own slug.
      expect(brandIconAssets.skipped).toBeDefined();
    });

    // The kit has exactly ONE glyph for this family (`document-scan`), so
    // aliasing the whole family to it made every picker look identical — the
    // receipt screen's Camera and Gallery tiles were pixel-for-pixel the same.
    it.each(['camera', 'gallery', 'images', 'image'])(
      'leaves %s unaliased so pickers stay visually distinct',
      (name) => {
        expect(IONICON_TO_BRAND[name]).toBeUndefined();
        expect(aliasToBrandIcon(name)).toBeUndefined();
        expect(aliasToBrandIcon(`${name}-outline`)).toBeUndefined();
      }
    );

    /**
     * Reachability, not presence.
     *
     * `document-scan` ships in Budget's kit and no other. The assertion here
     * used to be that `brandIconAssets` held it, which made this case pass or
     * fail on whichever brand was last generated for — it went red on the House
     * baseline without a line of icon code changing.
     *
     * The invariant that holds in EVERY kit is the one this block exists for:
     * the slug is never aliased away, so a caller that really means scanning
     * reaches the brand glyph wherever the kit has one and falls back to
     * Ionicons where it does not.
     */
    it('never aliases document-scan away from callers that really mean scanning', () => {
      expect(IONICON_TO_BRAND['document-scan']).toBeUndefined();
      expect(aliasToBrandIcon('document-scan')).toBeUndefined();
    });
  });

  describe('aliasToBrandIcon', () => {
    it('strips -outline / -sharp before lookup', () => {
      expect(aliasToBrandIcon('wallet-outline')).toBe(IONICON_TO_BRAND.wallet);
      expect(aliasToBrandIcon('wallet-sharp')).toBe(IONICON_TO_BRAND.wallet);
      expect(aliasToBrandIcon('wallet')).toBe(IONICON_TO_BRAND.wallet);
    });

    it('returns undefined for names with no brand equivalent', () => {
      expect(aliasToBrandIcon('definitely-not-an-icon')).toBeUndefined();
    });
  });
});
