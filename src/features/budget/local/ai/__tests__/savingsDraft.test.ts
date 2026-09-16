import { normalizeSavingsImportDraft, savingsDraftHasRows } from '../buildSavingsDraft';
import { parseSavingsText } from '../parseSavingsText';

describe('parseSavingsText', () => {
  it('parses simple income lines', () => {
    const draft = parseSavingsText('Payroll deposit 4200.00\nRent monthly 1800', 'all');
    expect(draft.income[0]).toMatchObject({ label: 'Payroll deposit', amount_cents: 420_000 });
    expect(draft.recurringPayments[0]).toMatchObject({ label: 'Rent monthly', amount_cents: 180_000 });
  });

  it('parses CSV rows with headers', () => {
    const draft = parseSavingsText(
      'label,amount,type\nGroceries,45.67,spending\nSalary,3000,income',
      'all',
    );
    expect(draft.spending[0]?.label).toBe('Groceries');
    expect(draft.income[0]?.amount_cents).toBe(300_000);
  });
});

describe('normalizeSavingsImportDraft', () => {
  it('drops empty rows and rounds cents', () => {
    const draft = normalizeSavingsImportDraft({
      income: [{ member_name: null, source_type: 'other', label: ' ', amount_cents: 10.4, income_date: '2026-08-01', is_recurring: false, day_of_month: null }],
      spending: [],
      recurringPayments: [],
    });
    expect(draft.income).toHaveLength(0);
    expect(savingsDraftHasRows(draft)).toBe(false);
  });
});
