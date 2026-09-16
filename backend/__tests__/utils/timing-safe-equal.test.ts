/**
 * Length-safe timing-safe secret comparison (B6).
 */
import { describe, expect, it } from 'vitest';

import { timingSafeEqualStrings, verifySharedSecret } from '../../src/utils/timing-safe-equal';

describe('timingSafeEqualStrings', () => {
  it('returns true for equal strings', async () => {
    expect(await timingSafeEqualStrings('lambda-secret', 'lambda-secret')).toBe(true);
  });

  it('returns false for mismatched strings of equal length', async () => {
    expect(await timingSafeEqualStrings('lambda-secret-a', 'lambda-secret-b')).toBe(false);
  });

  it('returns false for length mismatch without throwing', async () => {
    expect(await timingSafeEqualStrings('short', 'much-longer-secret')).toBe(false);
  });
});

describe('verifySharedSecret', () => {
  it('fails closed when expected secret is unset', async () => {
    expect(await verifySharedSecret('anything', undefined)).toBe('unconfigured');
  });

  it('rejects missing provided secret', async () => {
    expect(await verifySharedSecret(undefined, 'expected')).toBe('unauthorized');
  });

  it('accepts matching secret', async () => {
    expect(await verifySharedSecret('expected', 'expected')).toBe('ok');
  });

  it('rejects wrong secret', async () => {
    expect(await verifySharedSecret('wrong', 'expected')).toBe('unauthorized');
  });
});
