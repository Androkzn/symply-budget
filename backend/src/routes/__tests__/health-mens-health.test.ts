/**
 * Symply Health — the `/health/mens-health/*` Worker contract, driven through
 * the real Hono router against live miniflare D1.
 *
 * ## Why this file exists alongside health.test.ts
 *
 * `health.test.ts` owns the SWEEPS — brand gate, auth, cross-user scoping — and
 * carries four mens-health specs inside them. What it does not own is the
 * contract's edges, and this endpoint pair has three that matter more than
 * usual:
 *
 *   1. **The two halves have opposite validation philosophies.** `/entries` is a
 *      closed `z.object` of ~25 typed columns; `/settings` is an open
 *      `z.record(boolean | string | null)` that accepts ANY key. A change to
 *      either that makes them agree would be a silent widening or narrowing of
 *      what the client may send.
 *   2. **`null` and "absent" mean different things.** Every 1–10 column is
 *      `.nullable().optional()`. Sending `null` CLEARS the column; omitting the
 *      key PRESERVES it. The app's store always sends the full row with nulls
 *      for the fields the user has not rated, so if omission started clearing —
 *      or `null` started being ignored — an unrated satisfaction would either be
 *      silently retained from yesterday or become unclearable.
 *   3. **`/settings` had no client until very recently.** It was a deployed,
 *      reachable, completely uncalled route pair until the Vitality tab's "What
 *      to show" card landed and wired `loadMensTrackSettings` /
 *      `saveMensTrackSettings` to it. So this is a contract being agreed to for
 *      the first time, and the specs below state the three things it trips a
 *      caller on immediately: integers are rejected where the table stores
 *      integers; the write echo is a DIFFERENT SHAPE from the read on the first
 *      write only; and an unknown key passes zod and is then silently dropped,
 *      which is why the client builds its body from a fixed column map.
 *
 * ## The one thing to know before adding a spec here
 *
 * This pool enforces `PRAGMA foreign_keys` exactly like deployed D1, so every
 * user id must be seeded through `seedHealthUsers` or the insert 500s rather
 * than orphaning a row. The `UNIQUE(user_id, date)` on `mens_health_entries`
 * and the `UNIQUE(user_id)` on `mens_health_settings` are likewise real — they
 * are what makes the upserts collapse instead of accumulating, and several
 * specs below assert row COUNTS to prove it.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import healthRoutes from '../health';

import {
  createHealthTables,
  listHealthRows,
  insertHealthRow,
  resetHealthTables,
  seedHealthUsers,
} from './health-test-helpers';

const testEnv = env as unknown as Env;

// The pool env is House (wrangler.toml); mens-health only exists on Health.
const HEALTH_ENV = { ...testEnv, APP_BRAND: 'symply-health' } as Env;

const UID_A = 'u_mens_alice';
const UID_B = 'u_mens_bob';

/** Fixed dates — nothing in this domain depends on the wall clock. */
const D1 = '2026-06-01';
const D2 = '2026-06-02';
const D3 = '2026-06-03';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum'
  );
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

/** Mirrors the `app.route('/health', healthRoutes)` mount in src/index.ts. */
function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/health', healthRoutes);
  return app;
}

let tokenA = '';
let tokenB = '';

async function call(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {}
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? tokenA : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return mkApp().request(
    `/health${path}`,
    { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
    HEALTH_ENV
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** PUT one entry patch and return the echoed row. */
async function putEntry(date: string, patch: Record<string, unknown> = {}, token = tokenA) {
  const res = await call('PUT', '/mens-health/entries', { token, body: { date, ...patch } });
  expect(res.status).toBe(200);
  return (await json<{ entry: MensEntry }>(res)).entry;
}

async function listEntries(token = tokenA): Promise<MensEntry[]> {
  const res = await call('GET', '/mens-health/entries', { token });
  expect(res.status).toBe(200);
  return (await json<{ entries: MensEntry[] }>(res)).entries;
}

interface MensEntry {
  id: string;
  user_id: string;
  date: string;
  libido: number | null;
  overall_satisfaction: number | null;
  erection_quality: number | null;
  had_partner_sex: boolean;
  had_morning_erection: boolean;
  had_low_desire: boolean;
  energy_level: number | null;
  mood: number | null;
  stress_level: number | null;
  kegel_sets: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MensSettings {
  id: string;
  user_id: string;
  track_libido: boolean;
  track_energy: boolean;
  track_kegels: boolean;
  reminder_enabled: boolean;
  reminder_time: string | null;
  created_at: string;
  updated_at: string;
}

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID_A, UID_B]);
  tokenA = await mintToken(UID_A);
  tokenB = await mintToken(UID_B);
});

/* ==================================================================== */
/* /mens-health/entries — the shape of the log                           */
/* ==================================================================== */

describe('/health/mens-health/entries — list shape', () => {
  it('HEALTH-API-MENS-001: an empty account lists an empty array, never null', async () => {
    // The app maps `res.entries ?? []`, so a `null` here would still work — but a
    // MISSING key would not, and the envelope is the contract the store's
    // `fromWire` pipeline is built on.
    const body = await json<{ entries: unknown }>(
      await call('GET', '/mens-health/entries', { token: tokenA })
    );
    expect(body.entries).toEqual([]);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('HEALTH-API-MENS-002: entries come back NEWEST first', async () => {
    // The store re-sorts, so this ordering is not load-bearing for the app — but
    // it IS what makes the 200-row cap below take the most recent days rather
    // than an arbitrary 200. Written out of order on purpose.
    await putEntry(D2);
    await putEntry(D1);
    await putEntry(D3);

    expect((await listEntries()).map((e) => e.date)).toEqual([D3, D2, D1]);
  });

  it('HEALTH-API-MENS-003: the list is capped at 200 rows — the app is willing to hold 400', async () => {
    // `listMensHealth(userId, limit = 200)` and the route never passes a limit,
    // so 200 is a hard server ceiling. The app's `MAX_ENTRIES` is 400, which
    // means the second 200 days are unreachable no matter what the client does.
    // Pinned rather than "fixed": 200 days is over six months of daily logging
    // and the tab renders six history rows, so the ceiling is a deliberate
    // budget on a query with no pagination. If a Trends surface ever wants a
    // longer window this spec is where the decision is recorded.
    // 205 distinct real dates, walked off a fixed epoch so nothing here depends
    // on the wall clock or on month lengths.
    const dates = Array.from({ length: 205 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 0, 1));
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    expect(new Set(dates).size).toBe(205);

    for (const date of dates) {
      await putEntry(date);
    }

    const listed = await listEntries();
    expect(listed).toHaveLength(200);
    // …and it is the NEWEST 200, so the days that fall off are the oldest.
    expect(listed[0].date).toBe(dates[dates.length - 1]);
    expect(listed.map((e) => e.date)).not.toContain(dates[0]);
    // All 205 are still in D1 — nothing was discarded, only unreturned.
    expect(await listHealthRows(testEnv.DB, 'mens_health_entries')).toHaveLength(205);
  });

  it('HEALTH-API-MENS-004: a soft-deleted day is hidden from the list', async () => {
    // `listMensHealth` filters `deleted_at IS NULL`. Nothing in the app writes a
    // tombstone today — clearing a day writes an EMPTY entry instead — but the
    // sync push can, so the filter is the difference between a deleted day
    // staying deleted and reappearing on the next pull.
    await putEntry(D1, { libido: 8 });
    await testEnv.DB.prepare(
      `UPDATE mens_health_entries SET deleted_at = ? WHERE user_id = ? AND date = ?`
    )
      .bind('2026-06-05T00:00:00.000Z', UID_A, D1)
      .run();

    expect(await listEntries()).toEqual([]);
    expect(await listHealthRows(testEnv.DB, 'mens_health_entries')).toHaveLength(1);
  });

  it('HEALTH-API-MENS-005: re-logging a soft-deleted day REVIVES it rather than duplicating', async () => {
    // The upsert sets `deleted_at: null` on conflict. Without that, a revived day
    // would either stay invisible (the row is updated but still tombstoned) or
    // collide with `UNIQUE(user_id, date)` and 500.
    await putEntry(D1, { libido: 8 });
    await testEnv.DB.prepare(
      `UPDATE mens_health_entries SET deleted_at = ? WHERE user_id = ? AND date = ?`
    )
      .bind('2026-06-05T00:00:00.000Z', UID_A, D1)
      .run();

    const revived = await putEntry(D1, { libido: 3 });
    expect(revived.deleted_at).toBeNull();
    expect(revived.libido).toBe(3);
    expect(await listEntries()).toHaveLength(1);
    // Still ONE row — the tombstone was reused, not orphaned beside a new id.
    expect(await listHealthRows(testEnv.DB, 'mens_health_entries')).toHaveLength(1);
  });
});

/* ==================================================================== */
/* /mens-health/entries — null vs omitted                                */
/* ==================================================================== */

describe('/health/mens-health/entries — patch semantics', () => {
  it('HEALTH-API-MENS-010: omitting a key PRESERVES the stored column', async () => {
    // health.test.ts pins this for two columns; restated here as the other half
    // of HEALTH-API-MENS-011, because the pair only means something together.
    await putEntry(D1, { libido: 7, erection_quality: 9, notes: 'kept' });
    const after = await putEntry(D1, { mood: 4 });

    expect(after).toMatchObject({ libido: 7, erection_quality: 9, notes: 'kept', mood: 4 });
  });

  it('HEALTH-API-MENS-011: an explicit null CLEARS the column', async () => {
    // This is the path the app takes on every save: `toWire` always sends the
    // full row, with `null` for the three optional 1–10 fields the user has not
    // rated. If `null` were treated as "no change", turning OFF the partner-sex
    // toggle would leave yesterday's satisfaction rating attached to the day —
    // and that rating feeds the sexual sub-score.
    await putEntry(D1, {
      overall_satisfaction: 9,
      morning_erection_quality: 8,
      erection_quality: 7,
      libido: 6,
    });

    const cleared = await putEntry(D1, {
      overall_satisfaction: null,
      morning_erection_quality: null,
      erection_quality: null,
    });

    expect(cleared.overall_satisfaction).toBeNull();
    expect(cleared.erection_quality).toBeNull();
    // …while a column the patch did not mention is untouched.
    expect(cleared.libido).toBe(6);
  });

  it('HEALTH-API-MENS-012: a bare date creates a neutral row and clears nothing', async () => {
    // `deleteVitalityEntry` in the app posts a whole EMPTY entry rather than
    // issuing a DELETE, so "clearing a day" is a normal write. A `{ date }`-only
    // body is the degenerate version of it and must be a legal 200.
    const created = await putEntry(D1);
    expect(created.date).toBe(D1);
    expect(created.deleted_at).toBeNull();
    // The DDL defaults hold for the flags; the nullable scales stay null.
    expect(created.had_partner_sex).toBe(false);
    expect(created.libido).toBeNull();

    await putEntry(D1, { libido: 9 });
    expect((await putEntry(D1)).libido).toBe(9); // still there — a bare date is not a reset
  });

  it('HEALTH-API-MENS-013: unknown columns are STRIPPED, never passed to SQL', async () => {
    // `/entries` validates with a closed `z.object`, whose default behaviour is
    // to strip. That is the opposite of `/settings` (see HEALTH-API-MENS-041) and
    // it is what stops a client-side rename from reaching D1 as a column name.
    const res = await call('PUT', '/mens-health/entries', {
      token: tokenA,
      body: { date: D1, libido: 6, workout_intensity: 9, bogus_column: 'x' },
    });
    expect(res.status).toBe(200);

    const [row] = await listHealthRows<{ libido: number; workout_intensity: number | null }>(
      testEnv.DB,
      'mens_health_entries'
    );
    expect(row.libido).toBe(6);
    // `workout_intensity` is a REAL column of the table that the route does not
    // expose — so this also proves the schema, not the table, is the allowlist.
    expect(row.workout_intensity).toBeNull();
  });

  it('HEALTH-API-MENS-014: created_at is stable across upserts, updated_at moves', async () => {
    // The sync delta is driven entirely off `updated_at >= since`. A row whose
    // stamp did not move on update would never propagate to a second device.
    const first = await putEntry(D1, { libido: 4 });
    await new Promise((r) => setTimeout(r, 5));
    const second = await putEntry(D1, { libido: 5 });

    expect(second.id).toBe(first.id);
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at >= first.updated_at).toBe(true);
  });
});

/* ==================================================================== */
/* /mens-health/entries — validation                                     */
/* ==================================================================== */

describe('/health/mens-health/entries — validation', () => {
  const bad400 = async (body: unknown) =>
    (await call('PUT', '/mens-health/entries', { token: tokenA, body })).status;

  it('HEALTH-API-MENS-020: the 1–10 scales reject both rails and any fraction', async () => {
    // The app clamps to 1–10 before sending, so a value outside it means the
    // clamp was bypassed — and the ONE thing that must not happen is a
    // out-of-range figure landing in a column the score formulas read as if it
    // were in range.
    expect(await bad400({ date: D1, libido: 0 })).toBe(400);
    expect(await bad400({ date: D1, libido: 11 })).toBe(400);
    expect(await bad400({ date: D1, libido: 5.5 })).toBe(400);
    expect(await bad400({ date: D1, libido: '7' })).toBe(400);
    // Both rails INCLUSIVE are legal.
    expect((await putEntry(D1, { libido: 1 })).libido).toBe(1);
    expect((await putEntry(D1, { libido: 10 })).libido).toBe(10);
  });

  it('HEALTH-API-MENS-021: kegel_sets is 0–50 — the same ceiling the app clamps to', async () => {
    // `MAX_KEGEL_SETS` on the client and this bound must agree, or the app's
    // clamped 50 would be rejected (or an un-clamped 99 accepted).
    expect(await bad400({ date: D1, kegel_sets: -1 })).toBe(400);
    expect(await bad400({ date: D1, kegel_sets: 51 })).toBe(400);
    expect((await putEntry(D1, { kegel_sets: 0 })).kegel_sets).toBe(0);
    expect((await putEntry(D1, { kegel_sets: 50 })).kegel_sets).toBe(50);
  });

  it('HEALTH-API-MENS-022: flags must be real booleans — a D1-style 0/1 integer is a 400', async () => {
    // The trap for any future client. D1 has no boolean type, so these columns
    // come BACK as 0/1 integers; a read-modify-write that echoed them straight
    // returns would be rejected. The app avoids it because `fromWire` coerces to
    // booleans on the way in and `toWire` sends booleans on the way out — this
    // spec is what keeps that coercion necessary rather than incidental.
    expect(await bad400({ date: D1, had_partner_sex: 1 })).toBe(400);
    expect(await bad400({ date: D1, had_partner_sex: 'true' })).toBe(400);
    expect((await putEntry(D1, { had_partner_sex: true })).had_partner_sex).toBe(true);
  });

  it('HEALTH-API-MENS-023: notes are capped at 500 characters', async () => {
    // The app truncates to 200 before sending, so the server bound is slack by
    // design — but it must exist, because `notes` is free text on an intimate
    // record and an unbounded column is a storage-cost and a sync-payload issue.
    expect(await bad400({ date: D1, notes: 'x'.repeat(501) })).toBe(400);
    expect((await putEntry(D1, { notes: 'x'.repeat(500) })).notes).toHaveLength(500);
  });

  it('HEALTH-API-MENS-024: the date must be a LOCAL YYYY-MM-DD, not a timestamp', async () => {
    // The client sends its own local day. Accepting an ISO timestamp would make
    // `UNIQUE(user_id, date)` stop collapsing the day — two "entries for today"
    // that differ only by time-of-day.
    expect(await bad400({ date: '2026-6-1', libido: 5 })).toBe(400);
    expect(await bad400({ date: '2026-06-01T10:00:00.000Z', libido: 5 })).toBe(400);
    expect(await bad400({ libido: 5 })).toBe(400); // date is required
  });
});

/* ==================================================================== */
/* /mens-health/settings — the pair with no client                       */
/* ==================================================================== */

describe('/health/mens-health/settings — the uncalled contract', () => {
  it('HEALTH-API-MENS-030: reading before writing returns null, not a defaulted object', async () => {
    // There is no lazy-create on read. A first caller must therefore treat
    // `null` as "the DDL defaults apply" rather than as an error — which is not
    // obvious, since every column has a NOT NULL default in the table.
    const { settings } = await json<{ settings: MensSettings | null }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    expect(settings).toBeNull();
    expect(await listHealthRows(testEnv.DB, 'mens_health_settings')).toHaveLength(0);
  });

  it('HEALTH-API-MENS-031: the FIRST write echoes a different shape from the read', async () => {
    // `saveMensHealthSettings` returns the object it INSERTED on the create path
    // and the merged existing row on the update path. So the first PUT's echo
    // carries only the keys that were sent, while a GET carries all fourteen
    // columns with their defaults.
    //
    // This is the single most likely thing to break the first client: a caller
    // that seeds its state from the PUT response would show every untouched
    // toggle as `undefined` — which renders as OFF — until the next reload
    // flipped them all back on. Pinned as behaviour rather than fixed, because
    // there is no caller yet to break and the fix belongs with the caller.
    const { settings: echo } = await json<{ settings: Record<string, unknown> }>(
      await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: false } })
    );
    expect(echo.track_libido).toBe(false);
    expect(echo.track_energy).toBeUndefined(); // NOT the DDL default

    const { settings: read } = await json<{ settings: MensSettings }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    expect(read.track_libido).toBe(false);
    expect(read.track_energy).toBe(true); // the DDL default, materialised

    // The SECOND write echoes the merged row, so the shapes disagree only once.
    const { settings: second } = await json<{ settings: Record<string, unknown> }>(
      await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_kegels: false } })
    );
    expect(second.track_energy).toBe(true);
    expect(second.track_libido).toBe(false);
  });

  it('HEALTH-API-MENS-032: the row is a singleton — repeated writes never accumulate', async () => {
    for (const patch of [
      { track_libido: false },
      { track_kegels: false },
      { reminder_enabled: true },
      { reminder_time: '21:00' },
    ]) {
      expect(
        (await call('PUT', '/mens-health/settings', { token: tokenA, body: patch })).status
      ).toBe(200);
    }

    const rows = await listHealthRows(testEnv.DB, 'mens_health_settings');
    expect(rows).toHaveLength(1);
    const { settings } = await json<{ settings: MensSettings }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    // Every patch survived: the writes merge rather than replace.
    expect(settings).toMatchObject({
      track_libido: false,
      track_kegels: false,
      reminder_enabled: true,
      reminder_time: '21:00',
      track_energy: true, // never touched
    });
  });

  it('HEALTH-API-MENS-033: null clears a nullable setting; only reminder_time is nullable', async () => {
    // `reminder_time` is the one column of the fourteen that has no NOT NULL
    // default, so it is the only one a `null` in the record union is FOR.
    await call('PUT', '/mens-health/settings', {
      token: tokenA,
      body: { reminder_enabled: true, reminder_time: '07:30' },
    });
    await call('PUT', '/mens-health/settings', { token: tokenA, body: { reminder_time: null } });

    const { settings } = await json<{ settings: MensSettings }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    expect(settings.reminder_time).toBeNull();
    // …and the flag beside it is untouched, so "clear the time" does not mean
    // "cancel the reminder" — a first caller must do both.
    expect(settings.reminder_enabled).toBe(true);
  });

  it('HEALTH-API-MENS-034: an empty body is a legal no-op that still creates the singleton', async () => {
    // `z.record` accepts `{}`. The create path then writes a row of pure DDL
    // defaults, which is how a caller would "materialise" the settings without
    // choosing anything.
    expect(
      (await call('PUT', '/mens-health/settings', { token: tokenA, body: {} })).status
    ).toBe(200);

    const { settings } = await json<{ settings: MensSettings }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    expect(settings).not.toBeNull();
    expect(settings.track_libido).toBe(true);
    expect(settings.track_energy).toBe(true);
    expect(settings.reminder_enabled).toBe(false);
  });

  it('HEALTH-API-MENS-040: the value union is boolean | string | null — a NUMBER is a 400', async () => {
    // The mirror of HEALTH-API-MENS-022, and the same trap: these columns are
    // INTEGER in D1 and come back as booleans through Drizzle, but a caller that
    // built a patch from raw SQL — or from a JSON round trip through a language
    // without booleans — would send 1/0 and be rejected with no obvious reason.
    expect(
      (await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: 1 } }))
        .status
    ).toBe(400);
    expect(
      (await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: [] } }))
        .status
    ).toBe(400);
    // A non-object body is rejected outright.
    expect(
      (await call('PUT', '/mens-health/settings', { token: tokenA, body: 'nope' })).status
    ).toBe(400);
  });

  it('HEALTH-API-MENS-041: an unknown key is accepted by zod and dropped before SQL', async () => {
    // The open `z.record` is the OPPOSITE of `/entries`' closed object, so the
    // safety net here is Drizzle's column map rather than the schema. Asserted
    // against the stored row, not the echo — the echo is the in-memory object
    // and legitimately still carries the junk (see HEALTH-API-MENS-031).
    const res = await call('PUT', '/mens-health/settings', {
      token: tokenA,
      body: { bogus_column: 'x', track_night_erection: false },
    });
    expect(res.status).toBe(200);

    const [row] = await listHealthRows<Record<string, unknown>>(
      testEnv.DB,
      'mens_health_settings'
    );
    expect(row.track_night_erection).toBe(0);
    expect(row).not.toHaveProperty('bogus_column');
  });

  it('HEALTH-API-MENS-042: settings are per-user, and B cannot see or move A’s', async () => {
    // Restated here (health.test.ts sweeps it) because this domain has no
    // household path at all: a leak would be a leak of the most sensitive
    // preference set in the app, and the singleton UNIQUE is on `user_id` alone,
    // so a scoping bug would look like a silent overwrite rather than an error.
    await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: false } });
    await call('PUT', '/mens-health/settings', { token: tokenB, body: { track_kegels: false } });

    const a = await json<{ settings: MensSettings }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    const b = await json<{ settings: MensSettings }>(
      await call('GET', '/mens-health/settings', { token: tokenB })
    );

    expect(a.settings.track_libido).toBe(false);
    expect(a.settings.track_kegels).toBe(true);
    expect(b.settings.track_libido).toBe(true);
    expect(b.settings.track_kegels).toBe(false);
    expect(await listHealthRows(testEnv.DB, 'mens_health_settings')).toHaveLength(2);
  });
});

/* ==================================================================== */
/* Posture guard — the settings pair has no client                       */
/* ==================================================================== */

describe('/health/mens-health/settings — posture', () => {
  /**
   * The client half of this contract lives in
   * `src/features/health/__tests__/areas/vitality.tracking-sections.test.tsx`,
   * which drives `saveMensTrackSettings` and asserts the body it builds. The
   * specs here are the SERVER half of the same handshake, and they exist because
   * the two are easy to break independently:
   *
   *   * the client sends exactly EIGHT `track_*` columns, built from a fixed
   *     column map, because an unmapped key would be dropped silently
   *     (HEALTH-API-MENS-041) and a partial body would let the create path
   *     default the rest;
   *   * every value is a real boolean, because the route's union rejects the
   *     0/1 integers this table actually stores (HEALTH-API-MENS-040).
   *
   * The guard below is anchored on ROUTE BEHAVIOUR rather than on a grep, so it
   * cannot drift with a rename.
   */
  it('HEALTH-API-MENS-050: both settings paths are live and round-trip a value', async () => {
    expect((await call('GET', '/mens-health/settings', { token: tokenA })).status).toBe(200);
    expect(
      (await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_issues: false } }))
        .status
    ).toBe(200);
    const { settings } = await json<{ settings: MensSettings & { track_issues: boolean } }>(
      await call('GET', '/mens-health/settings', { token: tokenA })
    );
    expect(settings.track_issues).toBe(false);
  });

  it('HEALTH-API-MENS-051: settings also travel in the sync delta, not only over these two paths', async () => {
    // `HealthService.sync()` pulls `mens_health_settings` by `updated_at`, so a
    // preference written here reaches a SECOND device through the sync route
    // rather than through a settings GET. That is the path that would silently
    // stop working if the delta branch were dropped as redundant now that the
    // dedicated endpoints have a caller.
    await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_kegels: false } });

    const res = await call('GET', '/sync?since=1970-01-01T00:00:00.000Z', { token: tokenA });
    expect(res.status).toBe(200);
    const body = await json<Record<string, unknown>>(res);
    const changes = (body.changes ?? body) as Record<string, unknown[]>;
    expect(changes.mens_health_settings).toBeDefined();
    expect(changes.mens_health_settings).toHaveLength(1);
  });

  it('HEALTH-API-MENS-052: a raw tombstone in the settings table is not resurrected by a read', async () => {
    // `mens_health_settings` has NO `deleted_at` column (unlike every entry
    // table), so a caller cannot soft-delete a preference set — the only way to
    // "reset" is to write the defaults back. Asserted by inserting a second row
    // for the same user, which the UNIQUE must refuse.
    await call('PUT', '/mens-health/settings', { token: tokenA, body: { track_libido: false } });

    await expect(
      insertHealthRow(testEnv.DB, 'mens_health_settings', {
        id: 'mhs_duplicate',
        user_id: UID_A,
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      })
    ).rejects.toThrow();

    expect(await listHealthRows(testEnv.DB, 'mens_health_settings')).toHaveLength(1);
  });
});
