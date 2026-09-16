/**
 * Appendix A — pin the Stage 1 wire/sync constants. A silent drift here is a
 * 413 or a stuck catch-up, not a lint warning.
 */
import { describe, expect, it } from 'vitest';

import { MAILBOX_BATCH_VERSION } from '../src/sync/batch';
import {
  CHUNK_FILL_RATIO,
  CHUNK_START_OPS,
  MAX_MAILBOX_CIPHERTEXT_B64,
  MAX_PULL_PAGES,
  MIN_PUSH_INTERVAL_MS,
  SENT_VV_TTL_MS,
} from '../src/sync/mailbox-engine';

describe('Appendix A sync contracts', () => {
  it('pins the frozen Stage 1 constants', () => {
    expect(MAILBOX_BATCH_VERSION).toBe(2);
    expect(MAX_MAILBOX_CIPHERTEXT_B64).toBe(512_000);
    expect(CHUNK_FILL_RATIO).toBe(0.98);
    expect(CHUNK_START_OPS).toBe(256);
    expect(MIN_PUSH_INTERVAL_MS).toBe(5_000);
    expect(MAX_PULL_PAGES).toBe(8);
    expect(SENT_VV_TTL_MS).toBe(12 * 24 * 3600_000);
  });
});
