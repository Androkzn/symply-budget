import {
  closeLocalBudgetSession,
  getLocalLedger,
  openLocalBudgetSessionForTests,
} from '../../engine';
import { resolveLocalByokProvider } from '../localByokClient';
import {
  runAiDetectItemsLadder,
  runMortgageStatementExtractLadder,
  runReceiptImportLadder,
  runRegisteredStatementExtractLadder,
  runSavingsImportLadder,
} from '../localImportLadder';

jest.mock('../localByokClient', () => ({
  resolveLocalByokProvider: jest.fn(async () => null),
  generateStructuredByok: jest.fn(),
  byokLog: jest.fn(),
}));

jest.mock('../localTextExtract', () => ({
  readAttachmentAsText: jest.fn(async () => null),
  readAttachmentAsBase64: jest.fn(async () => ({ base64: 'abc', mime: 'image/jpeg' })),
  isTextImportMime: jest.fn(() => false),
}));

describe('localImportLadder', () => {
  beforeEach(async () => {
    await openLocalBudgetSessionForTests({ userId: 'user-test-1' });
    jest.mocked(resolveLocalByokProvider).mockResolvedValue(null);
  });

  afterEach(async () => {
    await closeLocalBudgetSession();
  });

  it('returns a receipt draft from pasted text without BYOK', async () => {
    const householdId = getLocalLedger().household.id;
    const draft = await runReceiptImportLadder({
      householdId,
      files: [],
      pastedText: 'Store\nMilk 4.49\nBread 3.99',
    });
    expect(draft.items.length).toBeGreaterThan(0);
    expect(draft.items[0]?.amount).toBeGreaterThan(0);
  });

  it('throws unsupported for image-only when BYOK is unavailable', async () => {
    const householdId = getLocalLedger().household.id;
    await expect(
      runReceiptImportLadder({
        householdId,
        files: [{ uri: 'file:///r.jpg', type: 'image/jpeg', name: 'r.jpg' }],
      }),
    ).rejects.toMatchObject({ name: 'BudgetLocalUnsupportedError' });
  });

  it('returns a savings draft from pasted CSV text', async () => {
    const householdId = getLocalLedger().household.id;
    const draft = await runSavingsImportLadder({
      householdId,
      text: 'label,amount,type\nSalary,2500,income',
      scope: 'income',
    });
    expect(draft.income[0]?.amount_cents).toBe(250_000);
  });

  it('returns aiDetect suggestions from text without BYOK', async () => {
    const householdId = getLocalLedger().household.id;
    const { suggestions } = await runAiDetectItemsLadder({
      householdId,
      text: 'Netflix $16/mo',
    });
    expect(suggestions[0]?.title).toMatch(/netflix/i);
  });

  it('throws for mortgage extract without BYOK', async () => {
    await expect(
      runMortgageStatementExtractLadder({
        text: 'Closing balance 400000 interest rate 4.09',
      }),
    ).rejects.toMatchObject({ name: 'BudgetLocalUnsupportedError' });
  });

  it('returns registered accounts from text without BYOK', async () => {
    const { draft } = await runRegisteredStatementExtractLadder({
      text: 'TFSA balance $5,000.00',
    });
    expect(draft.accounts[0]?.account_type).toBe('tfsa');
  });
});
