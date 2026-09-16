import { normalizeMortgageDraftLocal } from '../normalizeMortgageDraftLocal';
import { parseRegisteredStatementText } from '../normalizeRegisteredDraftLocal';
import { parseBudgetItemsText } from '../parseBudgetItemsText';

describe('parseBudgetItemsText', () => {
  it('extracts titled amounts and monthly recurrence', () => {
    const items = parseBudgetItemsText('Netflix $16/mo\nreplace water heater ~$2000');
    expect(items.length).toBeGreaterThanOrEqual(2);
    const netflix = items.find((i) => /netflix/i.test(i.title));
    expect(netflix?.estimated_cost_min).toBe(1600);
    expect(netflix?.is_recurring).toBe(true);
    expect(netflix?.recurrence_frequency).toBe('monthly');
  });
});

describe('normalizeMortgageDraftLocal', () => {
  it('keeps only last-4 and allowlisted fields', () => {
    const draft = normalizeMortgageDraftLocal({
      lender: 'TD',
      borrower_name: 'SHOULD DROP',
      account_number: '9104-4099855',
      closing_balance: 412345.67,
      interest_rate: 4.09,
      confidence: 0.9,
    });
    expect(draft.lender).toBe('TD');
    expect(draft.mortgageNumberLast4).toBe('9855');
    expect(draft.closingBalance).toBe(412345.67);
    expect((draft as unknown as { borrower_name?: string }).borrower_name).toBeUndefined();
  });
});

describe('parseRegisteredStatementText', () => {
  it('finds TFSA/RRSP lines with balances', () => {
    const draft = parseRegisteredStatementText('TFSA balance $12,500.00\nRRSP $80,000');
    expect(draft.accounts.map((a) => a.account_type).sort()).toEqual(['rrsp', 'tfsa']);
    expect(draft.accounts.find((a) => a.account_type === 'tfsa')?.balance).toBe(12500);
  });
});
