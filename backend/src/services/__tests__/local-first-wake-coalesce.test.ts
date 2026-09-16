import { describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstMailboxService } from '../local-first-mailbox-service';

/**
 * Wake coalescing.
 *
 * `enqueueBudgetSyncWake` used to fire on EVERY deposit, so once pushes became
 * chunked a 31-chunk catch-up would fan out 31 push notifications to every
 * device in the household.
 *
 * The window is now claimed per (household, recipient) when a wake is actually
 * emitted. Deriving it from `lf_mailbox_blobs.created_at` instead was
 * self-defeating: the wake-less chunks of the very push being decided are rows
 * to that recipient inside the window, so they cancelled their own push's wake —
 * see local-first-wake-emission.test.ts for the composition that proves it.
 */

const HH = 'hh_local_test';
const WINDOW_MS = 10_000;

function fakeEnv(seed?: Record<string, string>) {
  const kv = new Map<string, string>(Object.entries(seed ?? {}));
  const CONFIG_KV = {
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.set(key, value);
    },
  };
  return { CONFIG_KV } as unknown as Env;
}

function wakeKey(recipient: string | null): string {
  return `lf-wake:${HH}:${recipient ?? '*'}`;
}

function agoMs(ms: number): string {
  return String(Date.now() - ms);
}

describe('LocalFirstMailboxService.claimWake', () => {
  it('suppresses a second wake to the same recipient inside the window', async () => {
    const svc = new LocalFirstMailboxService(fakeEnv({ [wakeKey('dev_a')]: agoMs(2_000) }));
    expect(await svc.claimWake(HH, 'dev_a', WINDOW_MS)).toBe(false);
  });

  it('allows one once the window has passed', async () => {
    const svc = new LocalFirstMailboxService(fakeEnv({ [wakeKey('dev_a')]: agoMs(60_000) }));
    expect(await svc.claimWake(HH, 'dev_a', WINDOW_MS)).toBe(true);
  });

  it('does not let a wake for device X suppress one for device Y', async () => {
    const svc = new LocalFirstMailboxService(fakeEnv({ [wakeKey('dev_x')]: agoMs(1_000) }));
    expect(await svc.claimWake(HH, 'dev_y', WINDOW_MS)).toBe(true);
  });

  it('does not coalesce a broadcast against an addressed wake, or the reverse', async () => {
    const addressedOnly = new LocalFirstMailboxService(
      fakeEnv({ [wakeKey('dev_a')]: agoMs(1_000) }),
    );
    expect(await addressedOnly.claimWake(HH, null, WINDOW_MS)).toBe(true);

    const broadcastOnly = new LocalFirstMailboxService(fakeEnv({ [wakeKey(null)]: agoMs(1_000) }));
    expect(await broadcastOnly.claimWake(HH, 'dev_a', WINDOW_MS)).toBe(true);
    expect(await broadcastOnly.claimWake(HH, null, WINDOW_MS)).toBe(false);
  });

  it('claims the window so the next deposit in the same push stays silent', async () => {
    const svc = new LocalFirstMailboxService(fakeEnv());
    expect(await svc.claimWake(HH, 'dev_a', WINDOW_MS)).toBe(true);
    expect(await svc.claimWake(HH, 'dev_a', WINDOW_MS)).toBe(false);
  });

  it('ignores another household entirely', async () => {
    const svc = new LocalFirstMailboxService(
      fakeEnv({ [`lf-wake:hh_other:dev_a`]: agoMs(10) }),
    );
    expect(await svc.claimWake(HH, 'dev_a', WINDOW_MS)).toBe(true);
  });
});
