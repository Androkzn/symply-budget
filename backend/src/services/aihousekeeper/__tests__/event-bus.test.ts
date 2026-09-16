/**
 * event-bus.ts — plan §B6
 *
 * Subscribe/emit happy path, error containment, sha256Hex stability.
 */

import { describe, it, expect, vi } from 'vitest';

import { AihousekeeperEventBus, sha256Hex } from '../event-bus';
import type { AihousekeeperEvent } from '../event-bus';

function fixtureEvent(): AihousekeeperEvent {
  return {
    kind: 'memory_written',
    householdId: 'hh_evt_00000001',
    eventIdempotencyKey: 'idem-1',
    memoryId: 'mem_00000001',
    memoryType: 'fact',
    summary: 'Remembered: boiler serviced annually.',
  };
}

describe('AihousekeeperEventBus', () => {
  it('invokes all subscribed handlers concurrently', async () => {
    const bus = new AihousekeeperEventBus();
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    bus.subscribe(a);
    bus.subscribe(b);
    await bus.emit(fixtureEvent());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('contains a throwing subscriber — other subscribers still run', async () => {
    const bus = new AihousekeeperEventBus();
    const ok = vi.fn(async () => {});
    const boom = vi.fn(async () => {
      throw new Error('subscriber blew up');
    });
    bus.subscribe(boom);
    bus.subscribe(ok);
    await expect(bus.emit(fixtureEvent())).resolves.toBeUndefined();
    expect(boom).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
  });

  it('emits to zero subscribers without error', async () => {
    const bus = new AihousekeeperEventBus();
    await expect(bus.emit(fixtureEvent())).resolves.toBeUndefined();
  });
});

describe('sha256Hex', () => {
  it('produces a stable 64-char hex digest', async () => {
    const h = await sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const a = await sha256Hex('abc');
    const b = await sha256Hex('abc');
    expect(a).toBe(b);
  });

  it('differs for different inputs', async () => {
    const a = await sha256Hex('abc');
    const b = await sha256Hex('abcd');
    expect(a).not.toBe(b);
  });
});
