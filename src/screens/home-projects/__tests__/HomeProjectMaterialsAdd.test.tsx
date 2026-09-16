/**
 * The "Add material" menu on the project hub.
 *
 * This menu is now the ONLY way to add a material. The inline form it replaced
 * — name / price / URL, permanently open under the list, with its own
 * "Add selection", "Add with photo" and "Add from link" buttons — is gone, so
 * every route into the feature runs through `MATERIAL_ADD_OPTIONS`. An entry
 * that silently stops being built is a way of adding materials that silently
 * stops existing, and neither a type error nor a lint rule would say so.
 *
 * The same argument the "…" menu suite makes (`HomeProjectHubMenu.test.tsx`),
 * for the same reason, one screen over.
 *
 * The five are deliberately FLAT rather than three with a "Add with photo →"
 * submenu over the last three: reaching the camera is two taps, not three, and
 * the member picks where the material comes from in one decision instead of
 * being asked to classify it first.
 */
import { MATERIAL_ADD_OPTIONS } from '../HomeProjectHubScreen';

describe('the Add material menu', () => {
  it('offers all six ways in, in the order the member reads them', () => {
    // Order is product intent, not incidental: typing it yourself and pasting a
    // link are what most members do, so they sit above the four photo sources.
    expect(MATERIAL_ADD_OPTIONS.map((o) => o.id)).toEqual([
      'manual',
      'link',
      'library',
      'files',
      'camera',
      'drive',
    ]);
  });

  it('gives every option a label and an icon', () => {
    // A row with no label is a blank tappable strip; a missing icon is the kind
    // of thing that only shows up on someone's screen.
    for (const option of MATERIAL_ADD_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.icon).toMatch(/-outline$/);
    }
  });

  it('names each option by what it does, not by where the data lands', () => {
    // The member is choosing a source. "Add selection" — the old button — named
    // an internal concept and told them nothing about what would happen next.
    const labels = MATERIAL_ADD_OPTIONS.map((o) => o.label);
    expect(labels).toEqual([
      'Add manually',
      'Add from link',
      'Add from library',
      'Add from Files',
      'Add from camera',
      'Add from Drive',
    ]);
  });

  it('keeps every option id distinct, because the testID is derived from it', () => {
    // Rows render as `materials-add-${id}`. Two options sharing an id would
    // collide silently and make one of them unreachable from an E2E flow.
    const ids = MATERIAL_ADD_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The fleet-wide list, and the reason this menu is checked against it.
   *
   * Camera · Gallery · File · Drive is now ONE list, defined by
   * `useAttachmentSources` and offered by every upload surface in the app.
   * This menu spells its four out as rows rather than tiles, which is exactly
   * how a source goes missing from one screen and nowhere else — the picker
   * still works, so nothing fails, and only the member who keeps their photos
   * in the fourth place ever finds out.
   */
  it('offers all four photo sources, not the three it shipped with', () => {
    const photoSources = MATERIAL_ADD_OPTIONS.filter(
      (o) =>
        o.id === 'library' ||
        o.id === 'files' ||
        o.id === 'camera' ||
        o.id === 'drive'
    );
    expect(photoSources).toHaveLength(4);
  });
});
