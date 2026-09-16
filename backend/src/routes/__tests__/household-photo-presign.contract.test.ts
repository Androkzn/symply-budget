/**
 * BUDGET-CORNER-020 — household photo presign is intentionally unused (null).
 */
import { describe, expect, it } from 'vitest';

import householdsSource from '../households.ts?raw';

describe('household photo upload-url contract (BUDGET-CORNER-020)', () => {
  it('returns upload_url: null from the presign handler', () => {
    expect(householdsSource).toContain('/:id/photo/upload-url');
    expect(householdsSource).toMatch(/upload_url:\s*null/);
  });
});
