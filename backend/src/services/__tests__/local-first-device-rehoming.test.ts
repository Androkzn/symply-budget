import { describe, expect, it } from 'vitest';

import { LF_DEVICE_UPSERT_SQL } from '../local-first-control-service';

/**
 * One device, many households.
 *
 * History, because the two halves of this are easy to re-break:
 *
 * 1. `lf_devices` PK was `id` alone, so a device row was globally unique. A
 *    device joining a second household conflicted on `id`, and the upsert left
 *    the stale `household_id`. Every `(id, household_id, user_id)` authz lookup
 *    then missed — `deviceBelongsToUser` false, `GET /mailbox` 403 — so a
 *    joining member could never fetch its wrapped-HDK envelope and enrolment
 *    hung on "Waiting for approval…" forever.
 *    Two-device run `20260812-215155`, `FAIL [B] mm-05-member-enrol-sync`.
 *
 * 2. The interim fix re-homed the row (moved household_id/user_id on conflict).
 *    Correct for Budget — one household per device — and **wrong for House V2
 *    multi-property**, where activating property B would evict the device from
 *    property A and start 403ing A's mailbox.
 *
 * 3. Migration 0156 made the PK `(household_id, id)`. A device now gets one row
 *    PER household, so there is no cross-household conflict to resolve and the
 *    upsert must leave household_id/user_id alone.
 *
 * Regressing to either earlier state reintroduces a silent, hard-to-diagnose
 * 403. The behavioural proof is the two-device suite; this suite's D1 doubles
 * do not execute SQL.
 */
describe('LF_DEVICE_UPSERT_SQL', () => {
  it('keys the conflict on (household_id, id), so one device can hold many households', () => {
    expect(LF_DEVICE_UPSERT_SQL).toMatch(/ON CONFLICT\(household_id,\s*id\)/);
  });

  it('never re-homes: household_id is not reassigned on conflict', () => {
    // Re-homing would evict a House user from property A when they open B.
    expect(LF_DEVICE_UPSERT_SQL).not.toMatch(/household_id\s*=\s*excluded\.household_id/);
  });

  it('never reassigns user_id on conflict', () => {
    expect(LF_DEVICE_UPSERT_SQL).not.toMatch(/user_id\s*=\s*excluded\.user_id/);
  });

  it('refreshes the keys a joining device registered at claim time', () => {
    expect(LF_DEVICE_UPSERT_SQL).toMatch(/signing_public_key\s*=\s*excluded\.signing_public_key/);
    expect(LF_DEVICE_UPSERT_SQL).toMatch(
      /agreement_public_key\s*=\s*excluded\.agreement_public_key/,
    );
  });

  it('reactivates a previously revoked device', () => {
    expect(LF_DEVICE_UPSERT_SQL).toMatch(/status\s*=\s*'active'/);
    expect(LF_DEVICE_UPSERT_SQL).toMatch(/revoked_at\s*=\s*NULL/);
  });

  it('does not blank a label when the caller has none (approval binds null)', () => {
    expect(LF_DEVICE_UPSERT_SQL).toMatch(
      /device_label\s*=\s*COALESCE\(excluded\.device_label,\s*lf_devices\.device_label\)/,
    );
  });

  it('takes exactly the 8 binds all three call sites supply', () => {
    const values = LF_DEVICE_UPSERT_SQL.slice(
      LF_DEVICE_UPSERT_SQL.indexOf('VALUES'),
      LF_DEVICE_UPSERT_SQL.indexOf('ON CONFLICT'),
    );
    expect((values.match(/\?/g) ?? []).length).toBe(8);
  });
});
