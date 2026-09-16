/**
 * isLocalFirstApiEnabled — `/v2` control plane gate (House + Budget Workers).
 */
import { describe, it, expect } from 'vitest';

import type { Env } from '../../types';
import { isLocalFirstApiEnabled } from '../local-first-api';

const mkEnv = (brand: string, flag?: string): Env =>
  ({ APP_BRAND: brand, LOCAL_FIRST_API_ENABLED: flag } as unknown as Env);

describe('isLocalFirstApiEnabled', () => {
  // INVERTED per Health V2 plan §1.7a. This assertion used to pin
  // `unset → true` (the fail-OPEN contract of `!== 'false'`). The gate is now
  // fail-CLOSED, so an absent var is OFF and House must declare it explicitly
  // in all three `wrangler.toml` var blocks — which it does.
  it('is on for House only when LOCAL_FIRST_API_ENABLED is the literal true', () => {
    expect(isLocalFirstApiEnabled(mkEnv('symply-house', 'true'))).toBe(true);
    expect(isLocalFirstApiEnabled(mkEnv('symply-house'))).toBe(false);
  });

  // INVERTED per Health V2 plan §1.7a — same reason as House above, and this is
  // the assertion with teeth: Budget set the var NOWHERE until the config-only
  // commit that preceded this flip, so `unset → true` was the *only* thing
  // keeping Budget's certified two-device `/v2` (and its cron mailbox /
  // checkpoint TTL sweeps) alive. Both now depend on the explicit
  // `wrangler.budget.toml` declaration, not on a permissive default.
  it('is on for Budget Worker only when the flag is the literal true', () => {
    expect(isLocalFirstApiEnabled(mkEnv('symply-budget', 'true'))).toBe(true);
    expect(isLocalFirstApiEnabled(mkEnv('symply-budget'))).toBe(false);
  });

  it('is off on Kaizen even when flag is true', () => {
    // Kaizen has no household model at all, so the /v2 control plane is
    // meaningless there — this is the isolation that keeps a relay change
    // from reaching a brand that cannot use it.
    expect(isLocalFirstApiEnabled(mkEnv('symply-kaizen', 'true'))).toBe(false);
  });

  // Second half INVERTED per §1.7a with the two above — `unset → true` was the
  // fail-OPEN default, not a Health opt-in. Health's opt-in is the explicit
  // `LOCAL_FIRST_API_ENABLED = "true"` in `wrangler.health.toml`.
  it('is on for Health, which opted in 2026-08-13, only with the literal true', () => {
    expect(isLocalFirstApiEnabled(mkEnv('symply-health', 'true'))).toBe(true);
    expect(isLocalFirstApiEnabled(mkEnv('symply-health'))).toBe(false);
  });

  it("treats explicit 'false' as off on Health too", () => {
    expect(isLocalFirstApiEnabled(mkEnv('symply-health', 'false'))).toBe(false);
  });

  it("treats explicit 'false' as off on House and Budget Workers", () => {
    expect(isLocalFirstApiEnabled(mkEnv('symply-house', 'false'))).toBe(false);
    expect(isLocalFirstApiEnabled(mkEnv('symply-budget', 'false'))).toBe(false);
  });

  // §1.7a: the values the OLD `!== 'false'` gate left `/v2` fully enabled on.
  // A typo, a shell-quoting accident, a half-written value and a
  // truthy-looking numeric must ALL mean OFF, on every local-first brand.
  it.each(['False', 'FALSE', '0', 'off', '', ' true', 'True', '1', 'yes'])(
    "treats %o as off — only the literal 'true' enables (§1.7a)",
    (flag) => {
      for (const brand of ['symply-house', 'symply-budget', 'symply-health']) {
        expect(isLocalFirstApiEnabled(mkEnv(brand, flag))).toBe(false);
      }
    },
  );
});
