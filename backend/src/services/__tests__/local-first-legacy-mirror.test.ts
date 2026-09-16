import { describe, expect, it, beforeEach } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstControlService } from '../local-first-control-service';

/**
 * V2 local-first rebinds the app's active household to the local ledger id
 * (`hh_local_…`), which lives only in `lf_households`. Household chat — and every
 * other `/households/:householdId/...` feature — authorises against the LEGACY
 * `households` / `household_members` tables, so without a mirror row a V2 user is
 * "not a member" of their own household and chat 403s on list/create/send.
 *
 * These tests pin the mirror: which statements are issued, that it is idempotent,
 * that V2 roles collapse to the legacy two-role vocabulary, and — most
 * importantly — that a mirror failure can never take down the ledger operation
 * that triggered it.
 */

interface Stmt {
  sql: string;
  args: unknown[];
}

function fakeDb(options?: { failOn?: RegExp; first?: Record<string, unknown> | null }) {
  const statements: Stmt[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              statements.push({ sql, args });
              if (options?.failOn?.test(sql)) throw new Error('D1_ERROR: forced');
              return { success: true };
            },
            async first<T>() {
              statements.push({ sql, args });
              return (options?.first ?? null) as T | null;
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Env['DB'], statements };
}

const find = (statements: Stmt[], re: RegExp) => statements.filter((s) => re.test(s.sql));

describe('LocalFirstControlService.ensureLegacyMirror', () => {
  let warned: unknown[][];
  beforeEach(() => {
    warned = [];
     
    console.error = (...a: unknown[]) => warned.push(a);
  });

  it('mirrors an active V2 member into households + household_members', async () => {
    const { db, statements } = fakeDb({
      first: { display_name: 'Andrei', role: 'OWNER' },
    });
    const service = new LocalFirstControlService({ DB: db } as unknown as Env);

    await service.ensureLegacyMirror('hh_local_abc', 'user_1');

    const households = find(statements, /INSERT INTO households/);
    expect(households).toHaveLength(1);
    expect(households[0].args[0]).toBe('hh_local_abc');
    expect(households[0].args[1]).toBe('Andrei');
    // Upsert, not a blind insert — the client re-registers on every session open.
    expect(households[0].sql).toMatch(/ON CONFLICT\(id\) DO UPDATE/);

    const members = find(statements, /INSERT INTO household_members/);
    expect(members).toHaveLength(1);
    expect(members[0].args[1]).toBe('hh_local_abc');
    expect(members[0].args[2]).toBe('user_1');
    expect(members[0].args[3]).toBe('owner');
    expect(members[0].sql).toMatch(/ON CONFLICT\(household_id, user_id\) DO UPDATE/);
    // Re-joining must undo a previous soft delete, or the row stays invisible.
    expect(members[0].sql).toMatch(/deleted_at = NULL/);
  });

  it('undoes a soft delete on the HOUSEHOLD row, not just the membership', async () => {
    // The two rows used to heal apart, and the in-between state is worse than
    // either end of it. Observed on a real device: the household row was
    // soft-deleted while the V2 membership survived, so this mirror restored
    // the member and left the household deleted. Every `/households/:id/...`
    // endpoint moved from 403 (not a member) to 404 (no such household) and
    // stayed there — authorised for a household the legacy tier denies exists.
    //
    // Nothing could escape it: the re-post on every session open only ever
    // touched the row that was already correct. The sibling assertion for
    // `household_members` has existed since this file was written, which is
    // exactly why the missing half went unnoticed.
    const { db, statements } = fakeDb({
      first: { display_name: 'Andrei', role: 'OWNER' },
    });
    const service = new LocalFirstControlService({ DB: db } as unknown as Env);

    await service.ensureLegacyMirror('hh_local_abc', 'user_1');

    const households = find(statements, /INSERT INTO households/);
    expect(households).toHaveLength(1);
    expect(households[0].sql).toMatch(/deleted_at = NULL/);
  });

  it('collapses non-owner V2 roles to the legacy "member" role', async () => {
    for (const v2Role of ['ADULT', 'TEEN', 'adult']) {
      const { db, statements } = fakeDb({ first: { display_name: 'HH', role: v2Role } });
      const service = new LocalFirstControlService({ DB: db } as unknown as Env);
      await service.ensureLegacyMirror('hh_local_abc', 'user_2');
      expect(find(statements, /INSERT INTO household_members/)[0].args[3]).toBe('member');
    }
  });

  it('writes nothing when the caller is not an active V2 member', async () => {
    // A revoked/never-joined user must NOT gain chat access to the household.
    const { db, statements } = fakeDb({ first: null });
    const service = new LocalFirstControlService({ DB: db } as unknown as Env);

    await service.ensureLegacyMirror('hh_local_abc', 'stranger');

    expect(find(statements, /INSERT INTO households/)).toHaveLength(0);
    expect(find(statements, /INSERT INTO household_members/)).toHaveLength(0);
  });

  it('swallows mirror failures — chat may degrade, the ledger must not', async () => {
    const { db } = fakeDb({
      first: { display_name: 'Andrei', role: 'OWNER' },
      failOn: /INSERT INTO households/,
    });
    const service = new LocalFirstControlService({ DB: db } as unknown as Env);

    await expect(service.ensureLegacyMirror('hh_local_abc', 'user_1')).resolves.toBeUndefined();
    expect(warned.length).toBeGreaterThan(0);
  });

  it('mirrors only identity/ACL columns — no financial data reaches the mirror', async () => {
    const { db, statements } = fakeDb({ first: { display_name: 'Andrei', role: 'OWNER' } });
    const service = new LocalFirstControlService({ DB: db } as unknown as Env);

    await service.ensureLegacyMirror('hh_local_abc', 'user_1');

    const mirrored = find(statements, /INSERT INTO (households|household_members)/);
    for (const stmt of mirrored) {
      for (const forbidden of [
        'amount',
        'balance',
        'purchase_price',
        'currency',
        'category',
        'transaction',
      ]) {
        expect(stmt.sql.toLowerCase()).not.toContain(forbidden);
      }
    }
  });
});
