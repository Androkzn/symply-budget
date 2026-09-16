/**
 * The actionable half of the property-assessment gate.
 *
 * `getPropertyAssessmentGateMessage` has always known which field was missing.
 * What it could not say is whether the member could do anything about it — and
 * on screen "Add your province or state to your property address…" and
 * "Assessment and tax tracking isn't available in WA yet" read as the same kind
 * of closed door. They are not: one is fixed by typing an address, the other is
 * fixed by us seeding a jurisdiction, and offering "Add your address" for the
 * second sends a homeowner round a loop that cannot end.
 *
 * These tests exist because of a live defect: House local-first auto-mints a
 * household on a device with no local ledger, seeding `country: 'CA'` and
 * leaving province, city and every address line null. A member who reinstalls is
 * already onboarded at the ACCOUNT level, so no onboarding step ever runs again
 * and the only address form in the app is never shown. Seventeen homes on
 * staging are stuck that way. `householdNeedsAddressCapture` is the predicate
 * `RootNavigator` uses to spot exactly that home and route to the form, so the
 * cases it must and must NOT match are load-bearing, not cosmetic.
 */

import type { Household } from '@api/households';
import { allUsStateJurisdictions } from '@symply/contracts';

import {
  getPropertyAssessmentGate,
  getPropertyAssessmentGateMessage,
  householdNeedsAddressCapture,
  isHouseholdInGreaterVancouver,
  isPropertyAssessmentSupported,
} from '../region-gating';

const household = (over: Partial<Household> = {}): Household =>
  ({
    id: 'hh-1',
    name: 'Test property',
    country: 'CA',
    state_province: 'BC',
    city: 'Vancouver',
    ...over,
  }) as Household;

/** The home the local-first engine mints behind a reinstalling member's back. */
const autoMinted = () =>
  household({
    country: 'CA',
    state_province: null,
    city: null,
    address_line1: null,
  });

describe('gate reasons', () => {
  it('calls a country with no province `no-region`, and names the missing field', () => {
    // This is the auto-minted home, exactly as it exists on staging. If the
    // reason came back as anything else the navigator would not route to the
    // address form and the member would stay jurisdiction-less forever.
    const gate = getPropertyAssessmentGate(autoMinted());

    expect(gate.supported).toBe(false);
    expect(gate.reason).toBe('no-region');
    expect(gate.fixableByAddress).toBe(true);
    expect(gate.message).toMatch(/province or state/i);
  });

  it('calls a home with no country at all `no-country`, still fixable', () => {
    // A partially seeded mint (or a hand-created home) is the same defect one
    // field earlier — an address form closes it just as well.
    const gate = getPropertyAssessmentGate(
      household({ country: null, state_province: null, city: null })
    );

    expect(gate.reason).toBe('no-country');
    expect(gate.fixableByAddress).toBe(true);
    expect(gate.message).toMatch(/address/i);
  });

  it('separates `no-household` from a home that merely lacks fields', () => {
    // A null household is not a home missing an address — it is the household
    // store not loaded yet, or a brand (Health, Kaizen, Language) that has no
    // household domain at all. Collapsing the two is how you flash an address
    // form at every member on every cold start.
    const gate = getPropertyAssessmentGate(null);

    expect(gate.reason).toBe('no-household');
    expect(gate.supported).toBe(false);
  });

  it('calls an unseeded US state `unsupported-region`, and NOT fixable', () => {
    // The distinction the whole result type exists for. No address a homeowner
    // in Washington types will seed a jurisdiction we have not modelled, so the
    // caller must render plain text here — never an "Add your address" action.
    const gate = getPropertyAssessmentGate(
      household({ country: 'US', state_province: 'WA', city: 'Seattle' })
    );

    expect(gate.reason).toBe('unsupported-region');
    expect(gate.fixableByAddress).toBe(false);
    expect(gate.message).toContain('WA');
    expect(gate.message).toContain(String(allUsStateJurisdictions().length));
  });

  it('calls a nonsense Canadian region `unsupported-region` too', () => {
    // All thirteen Canadian regions are seeded, so an unmatched code is a bad
    // code rather than a gap in coverage. Either way an address form cannot fix
    // it, which is what `fixableByAddress` is asserting.
    const gate = getPropertyAssessmentGate(household({ state_province: 'ZZ' }));

    expect(gate.reason).toBe('unsupported-region');
    expect(gate.fixableByAddress).toBe(false);
    expect(gate.message).not.toMatch(/US states/i);
  });
});

describe('a fully addressed home is not gated at all', () => {
  it('reports no reason and no message for a Canadian home', () => {
    const gate = getPropertyAssessmentGate(household({ state_province: 'ON', city: 'Toronto' }));

    expect(gate.supported).toBe(true);
    expect(gate.reason).toBeNull();
    expect(gate.message).toBeNull();
    expect(gate.fixableByAddress).toBe(false);
  });

  it('reports no reason and no message for every seeded US state', () => {
    // Regression against the US registry work: that landed by teaching
    // `isPropertyAssessmentSupported` to consult a second registry, and this
    // result type is derived from it. A seeded state that reappeared as a gate
    // reason here would re-close a surface that was just opened.
    const seeded = allUsStateJurisdictions();
    expect(seeded.length).toBeGreaterThan(0);

    for (const state of seeded) {
      const gate = getPropertyAssessmentGate(
        household({ country: 'US', state_province: state.regionCode, city: 'Somewhere' })
      );
      expect(gate.supported).toBe(true);
      expect(gate.reason).toBeNull();
      expect(gate.message).toBeNull();
    }
  });
});

describe('householdNeedsAddressCapture — what RootNavigator routes on', () => {
  it('matches the auto-minted home the reinstall bug produces', () => {
    // The one case the whole re-gate exists to catch.
    expect(householdNeedsAddressCapture(autoMinted())).toBe(true);
  });

  it('matches a home with no country either', () => {
    // Same defect one field earlier. The navigator must catch this shape too,
    // or a home minted before `country` was seeded stays unreachable.
    expect(
      householdNeedsAddressCapture(household({ country: null, state_province: null }))
    ).toBe(true);
  });

  it('leaves a home that already has an address completely alone', () => {
    // The hard requirement on the navigator change: a healthy member must see
    // no extra screen and no flash of onboarding. If this ever returns true for
    // an addressed home, every member gets thrown into a create-home form on
    // launch.
    expect(householdNeedsAddressCapture(household())).toBe(false);
    expect(householdNeedsAddressCapture(household({ state_province: 'ON', city: 'Toronto' }))).toBe(
      false
    );
    expect(
      householdNeedsAddressCapture(household({ country: 'US', state_province: 'TX', city: 'Houston' }))
    ).toBe(false);
  });

  it('does not fire on a null household', () => {
    // `currentHousehold` is null on every cold start until the store loads, and
    // permanently null on the brands with no household domain. Routing on that
    // would take over the app for members who have nothing wrong with them.
    expect(householdNeedsAddressCapture(null)).toBe(false);
  });

  it('does not fire for a region we simply do not cover', () => {
    // Washington and a bogus Canadian code are both closed surfaces, but
    // neither is closed because the member typed too little — sending them to an
    // address form would be a round trip back to the same message.
    expect(
      householdNeedsAddressCapture(household({ country: 'US', state_province: 'WA' }))
    ).toBe(false);
    expect(householdNeedsAddressCapture(household({ state_province: 'ZZ' }))).toBe(false);
  });
});

describe('the existing exports are untouched', () => {
  it('still answers the supported question exactly as before', () => {
    // Other screens and `propertyJurisdiction.test.ts` depend on these two
    // signatures. The new result type is derived from them, never a second
    // implementation, so any drift shows up as a disagreement here.
    const cases: Array<Household | null> = [
      null,
      household(),
      autoMinted(),
      household({ country: null, state_province: null }),
      household({ state_province: 'ZZ' }),
      household({ country: 'US', state_province: 'TX' }),
      household({ country: 'US', state_province: 'WA' }),
      household({ country: 'CA', state_province: 'CA' }),
    ];

    for (const subject of cases) {
      const gate = getPropertyAssessmentGate(subject);
      expect(gate.supported).toBe(isPropertyAssessmentSupported(subject));
      if (!gate.supported) {
        expect(gate.message).toBe(getPropertyAssessmentGateMessage(subject));
      }
    }
  });

  it('leaves the Greater Vancouver utilities gate alone', () => {
    // A different gate for a different feature that happens to live in the same
    // file — it must not have acquired any of this address logic.
    expect(isHouseholdInGreaterVancouver(household())).toBe(true);
    expect(isHouseholdInGreaterVancouver(autoMinted())).toBe(false);
    expect(
      isHouseholdInGreaterVancouver(household({ country: 'US', state_province: 'CA', city: 'Vancouver' }))
    ).toBe(false);
  });
});
