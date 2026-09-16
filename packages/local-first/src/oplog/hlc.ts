/**
 * Hybrid logical clock: `${wallMs.toString().padStart(15,'0')}-${counter.toString(16).padStart(4,'0')}-${deviceSuffix}`
 * Lexicographically sortable.
 */
export class HybridLogicalClock {
  private wallMs: number;
  private counter: number;
  private readonly deviceSuffix: string;

  constructor(deviceId: string, wallMs = 0, counter = 0) {
    this.deviceSuffix = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'device';
    this.wallMs = wallMs;
    this.counter = counter;
  }

  tick(nowMs: number): string {
    if (nowMs > this.wallMs) {
      this.wallMs = nowMs;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return this.format();
  }

  observe(remoteHlc: string, nowMs: number): void {
    const parsed = parseHlc(remoteHlc);
    const maxWall = Math.max(nowMs, this.wallMs, parsed.wallMs);
    if (maxWall === this.wallMs && maxWall === parsed.wallMs) {
      this.counter = Math.max(this.counter, parsed.counter) + 1;
      this.wallMs = maxWall;
    } else if (maxWall === this.wallMs) {
      this.counter += 1;
    } else if (maxWall === parsed.wallMs) {
      this.wallMs = parsed.wallMs;
      this.counter = parsed.counter + 1;
    } else {
      this.wallMs = maxWall;
      this.counter = 0;
    }
  }

  format(): string {
    if (this.counter > 0xffff) {
      throw new Error(
        `HybridLogicalClock: counter overflow (${this.counter}) in one wall-clock ms`,
      );
    }
    return `${String(this.wallMs).padStart(15, '0')}-${this.counter
      .toString(16)
      .padStart(4, '0')}-${this.deviceSuffix}`;
  }
}

export function parseHlc(hlc: string): { wallMs: number; counter: number; deviceSuffix: string } {
  const parts = hlc.split('-');
  if (parts.length < 3) {
    throw new Error(`parseHlc: invalid ${hlc}`);
  }
  return {
    wallMs: Number(parts[0]),
    counter: Number.parseInt(parts[1]!, 16),
    deviceSuffix: parts.slice(2).join('-'),
  };
}

/** Hostile / mis-set clocks: reject ops whose wall is this far ahead of now. */
export const HLC_MAX_DRIFT_MS = 60_000;

/** True when `hlc` claims a wall clock more than `maxDriftMs` in the future. */
export function isHlcTooFarInFuture(
  hlc: string,
  nowMs: number,
  maxDriftMs: number = HLC_MAX_DRIFT_MS,
): boolean {
  try {
    return parseHlc(hlc).wallMs > nowMs + maxDriftMs;
  } catch {
    return true;
  }
}
