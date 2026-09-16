import { describe, it, expect } from 'vitest';

import { now, nowIso } from '../id';

describe('now / nowIso', () => {
  it('emits ISO-8601 UTC with Z suffix', () => {
    const ts = now();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('nowIso is an alias for now', () => {
    expect(nowIso()).toBe(now());
  });
});
