/**
 * Appendix A — pin Stage 3 projection budgets. These are independent of the
 * mailbox wire cap on purpose; changing them is a product call, not a drive-by.
 */
import { LEDGER_INDEX_THRESHOLD, MAX_OP_DELTA_BYTES, MAX_OP_DELTA_ROWS, MAX_PARKED_ROWS } from '../projection';

describe('Appendix A projection contracts', () => {
  it('pins the frozen Stage 3 constants', () => {
    expect(MAX_PARKED_ROWS).toBe(2000);
    expect(LEDGER_INDEX_THRESHOLD).toBe(16);
    expect(MAX_OP_DELTA_BYTES).toBe(64_000);
    expect(MAX_OP_DELTA_ROWS).toBe(250);
  });
});
