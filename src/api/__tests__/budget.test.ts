/**
 * budgetApi client — the full @api/budget Worker surface (categories, items,
 * expenses, monthly goals, transfers, AI detect/insights, receipt scan). Each
 * method is a thin wrapper over @api/client, so these tests pin the exact
 * household-scoped path, HTTP verb, params/body, and that `res.data` is
 * unwrapped (or the raw promise returned for the bare deletes).
 *
 * Mirrors the home-budget.test.ts contract style. Mocking @api/client also
 * intercepts budget.ts's relative `./client` import (same resolved module).
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();

jest.mock('@api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  api: {
    upload: (...args: unknown[]) => mockUpload(...args),
  },
}));

import { budgetApi } from '@api/budget';

const HH = 'hh-1';

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockPut.mockReset();
  mockDelete.mockReset();
  mockUpload.mockReset();
});

/** Reads all [name, value] entries out of a FormData instance regardless of env polyfill. */
function formEntries(fd: FormData): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  // RN + jsdom FormData both expose forEach / entries in the jest-expo env.
  if (typeof (fd as unknown as { forEach?: unknown }).forEach === 'function') {
    (fd as unknown as { forEach: (cb: (v: unknown, k: string) => void) => void }).forEach((v, k) =>
      out.push([k, v]),
    );
  }
  return out;
}

describe('budgetApi — categories', () => {
  it('getCategories omits params by default', async () => {
    mockGet.mockResolvedValue({ data: { categories: [] } });
    const res = await budgetApi.getCategories(HH);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/categories', {
      params: undefined,
    });
    expect(res).toEqual({ categories: [] });
  });

  it('getCategories sends include_hidden when requested', async () => {
    mockGet.mockResolvedValue({ data: { categories: [] } });
    await budgetApi.getCategories(HH, { includeHidden: true });
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/categories', {
      params: { include_hidden: 1 },
    });
  });

  it('getCategoryProductTrends uses the default 6-month window', async () => {
    mockGet.mockResolvedValue({ data: { products: [] } });
    await budgetApi.getCategoryProductTrends(HH, 'cat-9', 2026, 7);
    expect(mockGet).toHaveBeenCalledWith(
      '/households/hh-1/budget/categories/cat-9/products',
      { params: { year: 2026, month: 7, months: 6 } },
    );
  });

  it('getCategoryProductTrends honors an explicit window and "uncategorized"', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await budgetApi.getCategoryProductTrends(HH, 'uncategorized', 2026, 7, 12);
    expect(mockGet).toHaveBeenCalledWith(
      '/households/hh-1/budget/categories/uncategorized/products',
      { params: { year: 2026, month: 7, months: 12 } },
    );
  });

  it('createCategory POSTs the payload and unwraps category', async () => {
    const category = { id: 'c1' };
    mockPost.mockResolvedValue({ data: { category } });
    const res = await budgetApi.createCategory(HH, { name: 'Groceries', icon: 'cart' });
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/categories', {
      name: 'Groceries',
      icon: 'cart',
    });
    expect(res).toEqual({ category });
  });

  it('updateCategory PATCHes a single category', async () => {
    mockPatch.mockResolvedValue({ data: { category: { id: 'c1', hidden: true } } });
    await budgetApi.updateCategory(HH, 'c1', { hidden: true });
    expect(mockPatch).toHaveBeenCalledWith('/households/hh-1/budget/categories/c1', {
      hidden: true,
    });
  });

  it('deleteCategory DELETEs and returns the raw promise', async () => {
    mockDelete.mockResolvedValue({ status: 204 });
    const res = await budgetApi.deleteCategory(HH, 'c1');
    expect(mockDelete).toHaveBeenCalledWith('/households/hh-1/budget/categories/c1');
    expect(res).toEqual({ status: 204 });
  });
});

describe('budgetApi — items', () => {
  it('getTimeline GETs the overview', async () => {
    mockGet.mockResolvedValue({ data: { timeline: [] } });
    const res = await budgetApi.getTimeline(HH);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/timeline');
    expect(res).toEqual({ timeline: [] });
  });

  it('createItem POSTs the request body', async () => {
    const item = { id: 'i1' };
    mockPost.mockResolvedValue({ data: { item } });
    const res = await budgetApi.createItem(HH, {
      title: 'Roof',
      timeframe: 'year',
      priority: 'high',
    });
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/items', {
      title: 'Roof',
      timeframe: 'year',
      priority: 'high',
    });
    expect(res).toEqual({ item });
  });

  it('getItem GETs one item', async () => {
    mockGet.mockResolvedValue({ data: { item: { id: 'i1' } } });
    await budgetApi.getItem(HH, 'i1');
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/items/i1');
  });

  it('updateItem PATCHes an item', async () => {
    mockPatch.mockResolvedValue({ data: { item: { id: 'i1', status: 'completed' } } });
    await budgetApi.updateItem(HH, 'i1', { status: 'completed', target_date: null });
    expect(mockPatch).toHaveBeenCalledWith('/households/hh-1/budget/items/i1', {
      status: 'completed',
      target_date: null,
    });
  });

  it('deleteItem DELETEs an item', async () => {
    mockDelete.mockResolvedValue({ status: 204 });
    await budgetApi.deleteItem(HH, 'i1');
    expect(mockDelete).toHaveBeenCalledWith('/households/hh-1/budget/items/i1');
  });

  it('recordPlannedSpending defaults to an empty body', async () => {
    mockPost.mockResolvedValue({ data: { expense: {}, item: {} } });
    await budgetApi.recordPlannedSpending(HH, 'i1');
    expect(mockPost).toHaveBeenCalledWith(
      '/households/hh-1/budget/items/i1/record-spending',
      {},
    );
  });

  it('recordPlannedSpending forwards an override amount/date', async () => {
    mockPost.mockResolvedValue({ data: { expense: {}, item: {} } });
    await budgetApi.recordPlannedSpending(HH, 'i1', { amount: 4200, expense_date: '2026-07-14' });
    expect(mockPost).toHaveBeenCalledWith(
      '/households/hh-1/budget/items/i1/record-spending',
      { amount: 4200, expense_date: '2026-07-14' },
    );
  });

  it('syncFromTasks POSTs the sync action', async () => {
    mockPost.mockResolvedValue({ data: { created: 3, message: 'ok' } });
    const res = await budgetApi.syncFromTasks(HH);
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/sync-action-items');
    expect(res).toEqual({ created: 3, message: 'ok' });
  });
});

describe('budgetApi — AI detect + receipt scan', () => {
  it('aiDetectItems POSTs the text payload', async () => {
    mockPost.mockResolvedValue({ data: { suggestions: [] } });
    await budgetApi.aiDetectItems(HH, { text: 'buy paint', year: 2026, month: 7 });
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/items/ai-detect', {
      text: 'buy paint',
      year: 2026,
      month: 7,
    });
  });

  it('aiDetectItemsWithFile uploads text + file + year/month', async () => {
    mockUpload.mockResolvedValue({ suggestions: [] });
    await budgetApi.aiDetectItemsWithFile(HH, {
      text: '  receipt  ',
      file: { uri: 'file://a.jpg', type: 'image/jpeg', name: 'a.jpg' },
      year: 2026,
      month: 7,
    });
    const [url, fd] = mockUpload.mock.calls[0];
    expect(url).toBe('/households/hh-1/budget/items/ai-detect-upload');
    const keys = formEntries(fd as FormData).map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(['text', 'file', 'year', 'month']));
  });

  it('aiDetectItemsWithFile omits blank text and absent year/month', async () => {
    mockUpload.mockResolvedValue({ suggestions: [] });
    await budgetApi.aiDetectItemsWithFile(HH, {
      text: '   ',
      file: { uri: 'file://a.jpg', type: 'image/jpeg', name: 'a.jpg' },
    });
    const [, fd] = mockUpload.mock.calls[0];
    const keys = formEntries(fd as FormData).map(([k]) => k);
    expect(keys).toContain('file');
    expect(keys).not.toContain('text');
    expect(keys).not.toContain('year');
    expect(keys).not.toContain('month');
  });

  it('scanReceipt uploads the receipt file', async () => {
    mockUpload.mockResolvedValue({ items: [] });
    await budgetApi.scanReceipt(HH, { uri: 'file://r.jpg', type: 'image/jpeg', name: 'r.jpg' });
    const [url, fd] = mockUpload.mock.calls[0];
    expect(url).toBe('/households/hh-1/budget/receipts/scan');
    expect(formEntries(fd as FormData).map(([k]) => k)).toContain('file');
  });
});

describe('budgetApi — expenses', () => {
  it('addExpense POSTs one expense', async () => {
    mockPost.mockResolvedValue({ data: { expense: { id: 'e1' } } });
    await budgetApi.addExpense(HH, { title: 'Milk', amount: 500, expense_date: '2026-07-14' });
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/expenses', {
      title: 'Milk',
      amount: 500,
      expense_date: '2026-07-14',
    });
  });

  it('addExpensesBulk wraps items under `expenses`', async () => {
    mockPost.mockResolvedValue({ data: { expenses: [] } });
    const items = [{ title: 'Milk', amount: 500, expense_date: '2026-07-14' }];
    await budgetApi.addExpensesBulk(HH, items);
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/expenses/bulk', {
      expenses: items,
    });
  });

  it('getExpenses forwards filters as params', async () => {
    mockGet.mockResolvedValue({ data: { expenses: [] } });
    await budgetApi.getExpenses(HH, { category_id: 'c1', limit: 20 });
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/expenses', {
      params: { category_id: 'c1', limit: 20 },
    });
  });

  it('getExpenses with no filters still passes params: undefined', async () => {
    mockGet.mockResolvedValue({ data: { expenses: [] } });
    await budgetApi.getExpenses(HH);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/expenses', {
      params: undefined,
    });
  });

  it('getExpense GETs one expense', async () => {
    mockGet.mockResolvedValue({ data: { expense: { id: 'e1' } } });
    await budgetApi.getExpense(HH, 'e1');
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/expenses/e1');
  });

  it('updateExpense PATCHes an expense', async () => {
    mockPatch.mockResolvedValue({ data: { expense: { id: 'e1' } } });
    await budgetApi.updateExpense(HH, 'e1', { amount: 750 });
    expect(mockPatch).toHaveBeenCalledWith('/households/hh-1/budget/expenses/e1', {
      amount: 750,
    });
  });

  it('deleteExpense DELETEs an expense', async () => {
    mockDelete.mockResolvedValue({ status: 204 });
    await budgetApi.deleteExpense(HH, 'e1');
    expect(mockDelete).toHaveBeenCalledWith('/households/hh-1/budget/expenses/e1');
  });
});

describe('budgetApi — monthly goals + overview', () => {
  it('getMonthlyGoal GETs the year/month goal', async () => {
    mockGet.mockResolvedValue({ data: { goal: {} } });
    await budgetApi.getMonthlyGoal(HH, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/goals/2026/7');
  });

  it('setMonthlyGoal PUTs the planned budget', async () => {
    mockPut.mockResolvedValue({ data: { goal: {}, isFirstForYear: true } });
    const res = await budgetApi.setMonthlyGoal(HH, 2026, 7, { planned_budget: 250000 });
    expect(mockPut).toHaveBeenCalledWith('/households/hh-1/budget/goals/2026/7', {
      planned_budget: 250000,
    });
    expect(res).toEqual({ goal: {}, isFirstForYear: true });
  });

  it('applyGoalToYear POSTs planned_budget to apply-to-year', async () => {
    mockPost.mockResolvedValue({ data: { updatedMonths: [8, 9] } });
    const res = await budgetApi.applyGoalToYear(HH, 2026, 7, 250000);
    expect(mockPost).toHaveBeenCalledWith(
      '/households/hh-1/budget/goals/2026/7/apply-to-year',
      { planned_budget: 250000 },
    );
    expect(res).toEqual({ updatedMonths: [8, 9] });
  });

  it('scheduleNextMonthBudgetReminder POSTs the reminder', async () => {
    mockPost.mockResolvedValue({ data: { scheduledFor: '2026-08-01' } });
    await budgetApi.scheduleNextMonthBudgetReminder(HH, 2026, 7);
    expect(mockPost).toHaveBeenCalledWith(
      '/households/hh-1/budget/goals/2026/7/schedule-reminder',
    );
  });

  it('getMonthlyOverview GETs with year/month params', async () => {
    mockGet.mockResolvedValue({ data: { plannedBudget: 1000 } });
    await budgetApi.getMonthlyOverview(HH, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/monthly-overview', {
      params: { year: 2026, month: 7 },
    });
  });

  it('getQuickAddSuggestions GETs with the kind param', async () => {
    mockGet.mockResolvedValue({ data: { recent: [], popular: [] } });
    await budgetApi.getQuickAddSuggestions(HH, 'spent');
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/quick-add', {
      params: { kind: 'spent' },
    });
  });
});

describe('budgetApi — transfers', () => {
  it('getTransferContext GETs with year/month', async () => {
    mockGet.mockResolvedValue({ data: { leftoverCents: 0 } });
    await budgetApi.getTransferContext(HH, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/transfers', {
      params: { year: 2026, month: 7 },
    });
  });

  it('createTransfer POSTs the transfer request', async () => {
    mockPost.mockResolvedValue({ data: { history: [] } });
    const body = {
      source_year: 2026,
      source_month: 7,
      amount_cents: 5000,
      destination_type: 'next_month' as const,
    };
    await budgetApi.createTransfer(HH, body);
    expect(mockPost).toHaveBeenCalledWith('/households/hh-1/budget/transfers', body);
  });

  it('deleteTransfer DELETEs and unwraps the refreshed context', async () => {
    mockDelete.mockResolvedValue({ data: { history: [] } });
    const res = await budgetApi.deleteTransfer(HH, 't1');
    expect(mockDelete).toHaveBeenCalledWith('/households/hh-1/budget/transfers/t1');
    expect(res).toEqual({ history: [] });
  });
});

describe('budgetApi — sub-budgets', () => {
  it('getSubBudgets GETs with year/month params', async () => {
    mockGet.mockResolvedValue({ data: { subBudgets: [], totals: {}, rows: [] } });
    const res = await budgetApi.getSubBudgets(HH, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/sub-budgets', {
      params: { year: 2026, month: 7 },
    });
    expect(res).toEqual({ subBudgets: [], totals: {}, rows: [] });
  });

  it('upsertSubBudget PUTs the cap and unwraps subBudget', async () => {
    const subBudget = { id: 's1' };
    mockPut.mockResolvedValue({ data: { subBudget } });
    const body = {
      category_id: 'c1',
      year: 2026,
      month: null,
      limit_type: 'amount' as const,
      amount_cents: 10000,
      percent_bps: null,
    };
    const res = await budgetApi.upsertSubBudget(HH, body);
    expect(mockPut).toHaveBeenCalledWith('/households/hh-1/budget/sub-budgets', body);
    expect(res).toEqual({ subBudget });
  });

  it('deleteSubBudget DELETEs with the scope key in the body', async () => {
    mockDelete.mockResolvedValue({ status: 200 });
    const scope = { category_id: 'c1', year: 2026, month: 7 };
    await budgetApi.deleteSubBudget(HH, scope);
    expect(mockDelete).toHaveBeenCalledWith('/households/hh-1/budget/sub-budgets', {
      data: scope,
    });
  });
});

describe('budgetApi — insights + encouragement', () => {
  it('getInsights defaults force_refresh to false', async () => {
    mockGet.mockResolvedValue({ data: { summary: '', cached: true } });
    await budgetApi.getInsights(HH, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/insights', {
      params: { year: 2026, month: 7, force_refresh: false },
    });
  });

  it('getInsights forwards force_refresh=true', async () => {
    mockGet.mockResolvedValue({ data: { summary: '', cached: false } });
    await budgetApi.getInsights(HH, 2026, 7, true);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/insights', {
      params: { year: 2026, month: 7, force_refresh: true },
    });
  });

  it('getEncouragement GETs with year/month', async () => {
    mockGet.mockResolvedValue({ data: { tone: 'celebrate' } });
    const res = await budgetApi.getEncouragement(HH, 2026, 7);
    expect(mockGet).toHaveBeenCalledWith('/households/hh-1/budget/encouragement', {
      params: { year: 2026, month: 7 },
    });
    expect(res).toEqual({ tone: 'celebrate' });
  });

  it('propagates a rejected request', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    await expect(budgetApi.getTimeline(HH)).rejects.toThrow('network');
  });
});
