/**
 * UtilityService — every household-scoped method must enforce membership.
 *
 * WHY THIS EXISTS
 * ---------------
 * `cancelBillReminders(householdId, billId)` was the only public method on this
 * service that never called `checkHouseholdAccess`. Its route
 * (`DELETE /households/:householdId/utilities/bills/:billId/reminders`) called
 * `getUserId(c)` and threw the result away, so there was no membership check at
 * any layer: any authenticated caller could delete another household's reminder
 * rows just by putting that household's id in the URL. It shipped to staging
 * and production before being caught.
 *
 * A single behavioural test would only have pinned that one method. This walks
 * the prototype instead, so the NEXT household-scoped method someone adds
 * without a check fails here too.
 *
 * Implementation note: this reads method bodies via `Function.prototype
 * .toString()` rather than `readFileSync`. The workerd test runtime's fs shim
 * cannot open a path containing a space, and this repo lives under
 * "~/Desktop/Symply Ecosystem/" — every fs-based variant fails with
 * `readAll '.../Symply%20Ecosystem/...'` regardless of decodeURIComponent.
 * Reading the live prototype is also strictly better: it tests the code that
 * actually runs, not a file that merely sits next to it.
 *
 * If a method legitimately does not need the check, add it to
 * `INTENTIONALLY_UNSCOPED` with a reason — that is the deliberate, reviewable
 * escape hatch.
 */
import { describe, it, expect } from 'vitest';

import { UtilityService } from '../utility-service';

/**
 * Methods that take a householdId but genuinely must not gate on membership.
 * Keep this list short and justified.
 */
const INTENTIONALLY_UNSCOPED: Record<string, string> = {
  checkHouseholdAccess: 'it IS the check',

  detectMunicipalityForHousehold:
    'resolves a static municipality config from the household address row; ' +
    'callers gate before invoking it',

  // findDuplicateBill was exempt here and is no longer: it now takes a userId
  // and checks it, because it RETURNS another household's bill row. Removing
  // an entry from this list is the intended direction of travel.

  // `private` is erased at runtime, so these cannot be filtered automatically.
  // Listing them by name keeps the exemption an explicit, reviewable inventory:
  // each is a task-lifecycle helper invoked only from a public method that has
  // already called checkHouseholdAccess.
  createPayBillTask: 'private; called from createUtilityBill/updateUtilityBill after their check',
  deletePayBillTask: 'private; called from updateUtilityBill/deleteUtilityBill after their check',
  createPropertyTaxPayTask: 'private; called from createPropertyTax after its check',
  createHomeownerGrantTask: 'private; called from createPropertyTax after its check',
  deletePropertyTaxTask: 'private; called from updatePropertyTax after its check',

  checkGrantAppliedElsewhere:
    'safe by construction rather than by gate: it selects householdMembers WHERE ' +
    'user_id = the caller, then reads only households the caller belongs to ' +
    '(excluding the current one). It cannot reach a household the caller is not ' +
    'a member of, so checkHouseholdAccess would be redundant.',
};

type Method = { name: string; source: string };

function methods(): Method[] {
  const proto = UtilityService.prototype as object;
  return Object.getOwnPropertyNames(proto)
    .filter(name => name !== 'constructor')
    .map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(proto, name) }))
    // Read `descriptor.value`, never `proto[name]`. The class exposes lazy
    // getters (e.g. `taskService`) that construct real services on access —
    // reading one here instantiates NotificationService and blows up on a
    // missing EXPO_ACCESS_TOKEN before a single test runs.
    .filter(m => typeof m.descriptor?.value === 'function')
    .map(m => ({ name: m.name, source: String(m.descriptor!.value) }));
}

describe('UtilityService — household access enforcement', () => {
  const all = methods();

  it('finds the class methods at all (guards against a vacuous pass)', () => {
    expect(all.length).toBeGreaterThan(20);
    expect(all.map(m => m.name)).toContain('cancelBillReminders');
    expect(all.map(m => m.name)).toContain('getReminders');
  });

  it('gives every householdId-scoped method a membership check', () => {
    const offenders = all
      .filter(m => !(m.name in INTENTIONALLY_UNSCOPED))
      .filter(m => /\bhouseholdId\b/.test(m.source))
      .filter(m => !m.source.includes('checkHouseholdAccess'))
      .map(m => m.name);

    expect(offenders).toEqual([]);
  });

  it('cancelBillReminders takes a userId and checks it', () => {
    // The exact regression, pinned by name so a rename cannot quietly drop it.
    const method = all.find(m => m.name === 'cancelBillReminders');
    expect(method).toBeDefined();
    expect(method!.source).toMatch(/\buserId\b/);
    expect(method!.source).toContain('checkHouseholdAccess');
  });

  it('every intentionally-unscoped entry still exists on the class', () => {
    // Stops the escape hatch from rotting into a list of stale names that
    // silently exempt nothing — or worse, exempt a future method by collision.
    const names = all.map(m => m.name);
    Object.keys(INTENTIONALLY_UNSCOPED).forEach(name => {
      expect(names).toContain(name);
    });
  });
});
