/**
 * Appendix A — pin the relay-side caps so they cannot drift from the client
 * (`MAX_MAILBOX_CIPHERTEXT_B64` in mailbox-engine.ts).
 */
import { describe, expect, it } from 'vitest';

import { MAILBOX_MAX_CIPHERTEXT_B64, SYNC_WAKE_COALESCE_MS } from '../local-first-v2';

describe('Appendix A Worker contracts', () => {
  it('pins the frozen relay constants', () => {
    expect(MAILBOX_MAX_CIPHERTEXT_B64).toBe(512_000);
    expect(SYNC_WAKE_COALESCE_MS).toBe(10_000);
  });
});
